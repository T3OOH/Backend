import { Request, Response } from 'express';
import { MeetingStatus } from '@prisma/client';
import {
    cancelMeeting, createMeeting, endMeeting, findMeetingFor, iceServers, listMeetings, listMessages, listTeam,
    MEETING_TOKEN_TTL_SECONDS, MeetingError, signMeetingToken, toMeetingDto,
} from '../services/meeting.service';
import { closeMeetingRoom, emitToMeeting, emitToUser } from '../meetings.socket';
import { createMeetingSchema, listMeetingsSchema } from '../validators/meeting.validator';

const idOf = (req: Request) => String(req.params.id);

/** Reunião do usuário; com token de reunião, só a reunião do próprio token. */
async function loadMeeting(req: Request, res: Response) {
    const id = idOf(req);
    if (req.meetingId && req.meetingId !== id) {
        res.status(403).json({ error: 'Sem permissão para esta reunião.' });
        return null;
    }
    const meeting = await findMeetingFor(req.user!.id, id);
    if (!meeting) {
        res.status(404).json({ error: 'Reunião não encontrada.' });
        return null;
    }
    return meeting;
}

export const MeetingController = {
    async users(req: Request, res: Response) {
        return res.json(await listTeam(req.user!.id));
    },

    async list(req: Request, res: Response) {
        const parsed = listMeetingsSchema.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Filtro inválido.' });
        return res.json(await listMeetings(req.user!.id, parsed.data.scope));
    },

    async create(req: Request, res: Response) {
        const parsed = createMeetingSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.', details: parsed.error.issues });

        try {
            const meeting = await createMeeting(req.user!.id, parsed.data);
            // Convite em tempo real para quem estiver conectado
            for (const guest of meeting.participants) {
                emitToUser(guest.user.id, 'convite', { meeting: toMeetingDto(meeting, guest.user.id) });
            }
            return res.status(201).json(toMeetingDto(meeting, req.user!.id));
        } catch (error) {
            if (error instanceof MeetingError) return res.status(error.status).json({ error: error.message });
            throw error;
        }
    },

    async get(req: Request, res: Response) {
        const meeting = await loadMeeting(req, res);
        if (!meeting) return;
        return res.json(toMeetingDto(meeting, req.user!.id));
    },

    async end(req: Request, res: Response) {
        const meeting = await loadMeeting(req, res);
        if (!meeting) return;
        if (meeting.hostId !== req.user!.id) return res.status(403).json({ error: 'Só o anfitrião pode encerrar a reunião.' });
        if (meeting.status === MeetingStatus.CANCELLED) return res.status(409).json({ error: 'Esta reunião foi cancelada.' });
        if (meeting.status === MeetingStatus.ENDED) return res.json(toMeetingDto(meeting, req.user!.id));

        const ended = await endMeeting(meeting.id);
        emitToMeeting(meeting.id, 'encerrada', { meetingId: meeting.id });
        await closeMeetingRoom(meeting.id);
        return res.json(toMeetingDto(ended, req.user!.id));
    },

    async cancel(req: Request, res: Response) {
        const meeting = await loadMeeting(req, res);
        if (!meeting) return;
        if (meeting.hostId !== req.user!.id) return res.status(403).json({ error: 'Só o anfitrião pode cancelar a reunião.' });
        if (meeting.status !== MeetingStatus.SCHEDULED) return res.status(409).json({ error: 'Só reuniões agendadas podem ser canceladas.' });

        await cancelMeeting(meeting.id);
        for (const guest of meeting.participants) emitToUser(guest.user.id, 'cancelada', { meetingId: meeting.id });
        return res.status(204).send();
    },

    async messages(req: Request, res: Response) {
        const meeting = await loadMeeting(req, res);
        if (!meeting) return;
        return res.json(await listMessages(meeting.id));
    },

    async token(req: Request, res: Response) {
        const meeting = await loadMeeting(req, res);
        if (!meeting) return;
        if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.CANCELLED) {
            return res.status(409).json({ error: 'Esta reunião não está mais disponível.' });
        }
        return res.json({ token: signMeetingToken(req.user!.id, meeting.id), expiresIn: MEETING_TOKEN_TTL_SECONDS });
    },

    ice(_req: Request, res: Response) {
        return res.json({ iceServers: iceServers() });
    },
};
