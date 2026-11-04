import jwt from 'jsonwebtoken';
import { MeetingStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../database/prisma';
import { env } from '../config/env';

export const MEETING_TOKEN_TTL_SECONDS = 12 * 60 * 60;
export const MAX_MEETING_SOCKETS = 8;
export const MEETING_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.COMERCIAL];
export const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class MeetingError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const meetingInclude = {
    host: { select: { id: true, name: true } },
    participants: { select: { user: { select: { id: true, name: true, email: true, role: true } } } },
} satisfies Prisma.MeetingInclude;

type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

export type MeetingDto = {
    id: string;
    title: string;
    status: MeetingStatus;
    scheduledAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    createdAt: string;
    host: { id: string; name: string };
    participants: { id: string; name: string; email: string; role: string }[];
    isHost: boolean;
};

/** Formato do contrato; isHost é em relação a quem pediu. */
export function toMeetingDto(meeting: MeetingRow, viewerId: string): MeetingDto {
    return {
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        createdAt: meeting.createdAt.toISOString(),
        host: meeting.host,
        participants: meeting.participants.map((p) => p.user),
        isHost: meeting.hostId === viewerId,
    };
}

export async function findMeeting(id: string) {
    return prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
}

/** Reunião visível só para o anfitrião e os convidados (os demais veem 404). */
export async function findMeetingFor(userId: string, id: string) {
    const meeting = await findMeeting(id);
    if (!meeting) return null;
    const allowed = meeting.hostId === userId || meeting.participants.some((p) => p.user.id === userId);
    return allowed ? meeting : null;
}

export async function listMeetings(userId: string, scope: 'upcoming' | 'past') {
    const mine: Prisma.MeetingWhereInput = { OR: [{ hostId: userId }, { participants: { some: { userId } } }] };
    if (scope === 'past') {
        const rows = await prisma.meeting.findMany({
            where: { ...mine, status: { in: [MeetingStatus.ENDED, MeetingStatus.CANCELLED] } },
            include: meetingInclude,
            orderBy: { updatedAt: 'desc' },
            take: 50,
        });
        return rows.map((m) => toMeetingDto(m, userId));
    }
    const rows = await prisma.meeting.findMany({
        where: { ...mine, status: { in: [MeetingStatus.LIVE, MeetingStatus.SCHEDULED] } },
        include: meetingInclude,
        orderBy: { scheduledAt: 'asc' },
    });
    // Ao vivo primeiro, depois por data crescente (sort é estável)
    rows.sort((a, b) => Number(b.status === MeetingStatus.LIVE) - Number(a.status === MeetingStatus.LIVE));
    return rows.map((m) => toMeetingDto(m, userId));
}

/** Colegas da equipe (sem o próprio usuário) para o seletor de convidados. */
export async function listTeam(userId: string) {
    return prisma.user.findMany({
        where: { role: { in: MEETING_ROLES }, id: { not: userId } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
    });
}

export async function createMeeting(hostId: string, input: { title: string; scheduledAt?: string; participantIds: string[]; instant?: boolean }) {
    if (input.participantIds.includes(hostId)) throw new MeetingError(400, 'Você já é o anfitrião da reunião.');

    // Só usuários existentes da equipe podem ser convidados
    if (input.participantIds.length) {
        const found = await prisma.user.count({ where: { id: { in: input.participantIds }, role: { in: MEETING_ROLES } } });
        if (found !== input.participantIds.length) throw new MeetingError(400, 'Há convidados que não existem ou não são da equipe.');
    }

    const now = new Date();
    return prisma.meeting.create({
        data: {
            title: input.title,
            hostId,
            status: input.instant ? MeetingStatus.LIVE : MeetingStatus.SCHEDULED,
            scheduledAt: input.instant ? now : new Date(input.scheduledAt as string),
            startedAt: input.instant ? now : null,
            participants: { create: input.participantIds.map((userId) => ({ userId })) },
        },
        include: meetingInclude,
    });
}

export async function endMeeting(id: string) {
    return prisma.meeting.update({
        where: { id },
        data: { status: MeetingStatus.ENDED, endedAt: new Date() },
        include: meetingInclude,
    });
}

export async function cancelMeeting(id: string) {
    return prisma.meeting.update({ where: { id }, data: { status: MeetingStatus.CANCELLED }, include: meetingInclude });
}

/** Primeira entrada numa reunião agendada: ela passa a estar ao vivo. */
export async function startIfScheduled(id: string) {
    await prisma.meeting.updateMany({
        where: { id, status: MeetingStatus.SCHEDULED },
        data: { status: MeetingStatus.LIVE, startedAt: new Date() },
    });
}

function toMessageDto(row: { id: string; meetingId: string; content: string; createdAt: Date; sender: { id: string; name: string } }) {
    return { id: row.id, meetingId: row.meetingId, sender: row.sender, texto: row.content, createdAt: row.createdAt.toISOString() };
}

export async function listMessages(meetingId: string) {
    const rows = await prisma.meetingMessage.findMany({
        where: { meetingId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { sender: { select: { id: true, name: true } } },
    });
    return rows.reverse().map(toMessageDto);
}

export async function addMessage(meetingId: string, senderId: string, texto: string) {
    const row = await prisma.meetingMessage.create({
        data: { meetingId, senderId, content: texto },
        include: { sender: { select: { id: true, name: true } } },
    });
    return toMessageDto(row);
}

export function signMeetingToken(userId: string, meetingId: string) {
    return jwt.sign({ mid: meetingId, typ: 'meeting' }, env.JWT_SECRET, {
        algorithm: 'HS256',
        subject: userId,
        expiresIn: MEETING_TOKEN_TTL_SECONDS,
    });
}

/** Valida um token de reunião e devolve usuário e reunião; null se não for um. */
export function verifyMeetingToken(token: string): { userId: string; meetingId: string } | null {
    try {
        const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload & { typ?: string; mid?: string };
        if (payload.typ !== 'meeting' || !payload.sub || typeof payload.mid !== 'string') return null;
        return { userId: payload.sub, meetingId: payload.mid };
    } catch {
        return null;
    }
}

export function iceServers() {
    return env.MEETING_ICE_SERVERS ?? DEFAULT_ICE_SERVERS;
}

/** Usuário atual da equipe (null se apagado ou fora da equipe); checa token de reunião e socket. */
export async function findStaffUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true } });
    return user && MEETING_ROLES.includes(user.role) ? user : null;
}
