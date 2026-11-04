import { Namespace, Server, Socket } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { MeetingStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { env } from './config/env';
import { isSessionActive } from './services/session.service';
import {
    addMessage, findMeetingFor, findStaffUser, MAX_MEETING_SOCKETS, startIfScheduled, toMeetingDto, verifyMeetingToken,
} from './services/meeting.service';
import { entrarSchema, estadoSchema, MAX_SIGNAL_BYTES, mensagemSchema, sinalSchema } from './validators/meeting.validator';

let ns: Namespace | null = null;

type Estado = z.infer<typeof estadoSchema>;

interface MeetingSocketData {
    user: { id: string; name: string; role: Role };
    /** Reunião a que o token de reunião dá acesso (ausente com token de acesso). */
    tokenMeetingId?: string;
    /** Reunião em que o socket está agora. */
    meetingId?: string;
    estado?: Estado;
    /** Instantes das últimas mensagens (limite de taxa do chat). */
    sent: number[];
}

type Ack = (resposta: unknown) => void;
const reply = (cb: unknown, payload: unknown) => { if (typeof cb === 'function') (cb as Ack)(payload); };

const roomOf = (meetingId: string) => `meeting:${meetingId}`;
export const userRoom = (userId: string) => `user:${userId}`;

const CHAT_LIMIT = 10;
const CHAT_WINDOW_MS = 10_000;

/** Avisa na sala da reunião (ex.: encerrada). */
export function emitToMeeting(meetingId: string, event: string, payload: unknown) {
    ns?.to(roomOf(meetingId)).emit(event, payload);
}

/** Avisa um usuário em todos os aparelhos conectados (convites e cancelamentos). */
export function emitToUser(userId: string, event: string, payload: unknown) {
    ns?.to(userRoom(userId)).emit(event, payload);
}

/** Tira todos da sala depois do encerramento. */
export async function closeMeetingRoom(meetingId: string) {
    if (!ns) return;
    const sockets = await ns.in(roomOf(meetingId)).fetchSockets();
    for (const s of sockets) {
        (s.data as MeetingSocketData).meetingId = undefined;
        s.leave(roomOf(meetingId));
    }
}

async function authenticate(token: string | undefined): Promise<Pick<MeetingSocketData, 'user' | 'tokenMeetingId'>> {
    if (!token) throw new Error('Não autenticado.');

    const meetingToken = verifyMeetingToken(token);
    if (meetingToken) {
        const user = await findStaffUser(meetingToken.userId);
        if (!user) throw new Error('Sem permissão.');
        return { user, tokenMeetingId: meetingToken.meetingId };
    }

    let payload: JwtPayload & { role?: Role; sid?: string; typ?: string; mid?: string };
    try {
        payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as typeof payload;
    } catch {
        throw new Error('Token inválido ou expirado.');
    }
    if (!payload.sub || !payload.role || payload.typ !== undefined || payload.mid !== undefined) throw new Error('Sem permissão.');
    if (payload.sid && !(await isSessionActive(payload.sid))) throw new Error('Sessão encerrada.');

    const user = await findStaffUser(payload.sub);
    if (!user) throw new Error('Sem permissão.');
    return { user };
}

export function initMeetingsNamespace(io: Server) {
    ns = io.of('/reunioes');
    const namespace = ns;

    namespace.use(async (socket, next) => {
        try {
            const auth = await authenticate(socket.handshake.auth?.token as string | undefined);
            socket.data = { ...auth, sent: [] } satisfies MeetingSocketData;
            return next();
        } catch (error) {
            return next(error instanceof Error && error.message ? error : new Error('Não autenticado.'));
        }
    });

    namespace.on('connection', (socket: Socket) => {
        const data = socket.data as MeetingSocketData;
        // Sala pessoal: recebe os convites e cancelamentos
        socket.join(userRoom(data.user.id));

        const leaveMeeting = () => {
            const meetingId = data.meetingId;
            if (!meetingId) return;
            data.meetingId = undefined;
            data.estado = undefined;
            socket.leave(roomOf(meetingId));
            namespace.to(roomOf(meetingId)).emit('saiu', { socketId: socket.id });
        };

        socket.on('entrar', async (raw: unknown, cb?: unknown) => {
            try {
                const parsed = entrarSchema.safeParse(raw);
                if (!parsed.success) return reply(cb, { ok: false, erro: 'Dados inválidos.' });
                const { meetingId, estado } = parsed.data;

                // Token de reunião vale só para a própria reunião
                if (data.tokenMeetingId && data.tokenMeetingId !== meetingId) return reply(cb, { ok: false, erro: 'Sem permissão para esta reunião.' });

                let meeting = await findMeetingFor(data.user.id, meetingId);
                if (!meeting) return reply(cb, { ok: false, erro: 'Reunião não encontrada.' });
                if (meeting.status === MeetingStatus.ENDED) return reply(cb, { ok: false, erro: 'Esta reunião já foi encerrada.' });
                if (meeting.status === MeetingStatus.CANCELLED) return reply(cb, { ok: false, erro: 'Esta reunião foi cancelada.' });

                if (data.meetingId && data.meetingId !== meetingId) leaveMeeting();

                const room = roomOf(meetingId);
                const inRoom = await namespace.in(room).fetchSockets();
                const already = data.meetingId === meetingId;
                if (!already && inRoom.length >= MAX_MEETING_SOCKETS) return reply(cb, { ok: false, erro: 'A reunião está cheia (máximo de 8 pessoas).' });

                // Sem await entre a contagem e a entrada na sala
                data.meetingId = meetingId;
                data.estado = estado;
                socket.join(room);

                if (meeting.status === MeetingStatus.SCHEDULED) {
                    await startIfScheduled(meetingId);
                    meeting = (await findMeetingFor(data.user.id, meetingId)) ?? meeting;
                }

                const participantes = inRoom
                    .filter((s) => s.id !== socket.id)
                    .map((s) => {
                        const d = s.data as MeetingSocketData;
                        return { socketId: s.id, user: { id: d.user.id, name: d.user.name }, estado: d.estado };
                    });

                if (!already) socket.to(room).emit('entrou', { socketId: socket.id, user: { id: data.user.id, name: data.user.name }, estado });
                return reply(cb, { ok: true, meeting: toMeetingDto(meeting, data.user.id), participantes });
            } catch (error) {
                console.error('[Reuniões] Erro ao entrar:', error);
                leaveMeeting();
                return reply(cb, { ok: false, erro: 'Não foi possível entrar na reunião.' });
            }
        });

        socket.on('sinal', async (raw: unknown, cb?: unknown) => {
            try {
                if (!data.meetingId) return reply(cb, { ok: false, erro: 'Entre na reunião primeiro.' });
                // Limite de tamanho antes de qualquer validação mais pesada
                let size = 0;
                try { size = Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8'); } catch { size = Infinity; }
                if (size > MAX_SIGNAL_BYTES) return reply(cb, { ok: false, erro: 'Sinal grande demais.' });

                const parsed = sinalSchema.safeParse(raw);
                if (!parsed.success) return reply(cb, { ok: false, erro: 'Dados inválidos.' });

                // Só repassa para um socket da mesma reunião
                const target = namespace.sockets.get(parsed.data.para);
                const targetData = target?.data as MeetingSocketData | undefined;
                if (!target || target.id === socket.id || targetData?.meetingId !== data.meetingId) {
                    return reply(cb, { ok: false, erro: 'Destino fora da reunião.' });
                }
                target.emit('sinal', { de: socket.id, dados: parsed.data.dados });
                return reply(cb, { ok: true });
            } catch (error) {
                console.error('[Reuniões] Erro no sinal:', error);
            }
        });

        socket.on('estado', (raw: unknown) => {
            if (!data.meetingId) return;
            const parsed = estadoSchema.safeParse(raw);
            if (!parsed.success) return;
            data.estado = parsed.data;
            socket.to(roomOf(data.meetingId)).emit('estado', { socketId: socket.id, estado: parsed.data });
        });

        socket.on('mensagem', async (raw: unknown, cb?: unknown) => {
            try {
                if (!data.meetingId) return reply(cb, { ok: false, erro: 'Entre na reunião primeiro.' });

                // Limite simples de taxa: 10 mensagens a cada 10 s por socket
                const now = Date.now();
                data.sent = data.sent.filter((t) => now - t < CHAT_WINDOW_MS);
                if (data.sent.length >= CHAT_LIMIT) return reply(cb, { ok: false, erro: 'Muitas mensagens seguidas. Aguarde alguns segundos.' });

                const parsed = mensagemSchema.safeParse(raw);
                if (!parsed.success) return reply(cb, { ok: false, erro: parsed.error.issues[0]?.message ?? 'Mensagem inválida.' });
                data.sent.push(now);

                const meetingId = data.meetingId;
                // O remetente é sempre o usuário autenticado
                const mensagem = await addMessage(meetingId, data.user.id, parsed.data.texto);
                namespace.to(roomOf(meetingId)).emit('mensagem', mensagem);
                return reply(cb, { ok: true, mensagem });
            } catch (error) {
                console.error('[Reuniões] Erro na mensagem:', error);
                return reply(cb, { ok: false, erro: 'Não foi possível enviar a mensagem.' });
            }
        });

        socket.on('sair', () => leaveMeeting());
        socket.on('disconnect', () => leaveMeeting());
    });
}
