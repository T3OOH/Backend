import { Request } from 'express';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../database/prisma';
import { env } from '../config/env';
import { newDeviceEmail, sendMailInBackground, siteUrl } from './mail.service';

/*
 * Sessões de login (ver docs/SEGURANCA.md).
 *  - Token de acesso: JWT curto (15 min) com o id da sessão ("sid").
 *  - Refresh token: "<sid>.<segredo aleatório>"; no banco fica só o SHA-256 do segredo.
 *    A cada renovação o segredo muda (rotação). Reuso de um segredo antigo = possível roubo:
 *    a sessão é encerrada.
 *  - "Manter conectado": 30 dias sem uso ou 90 dias no total. Sem a opção: 12 horas.
 */
export const ACCESS_TTL_SECONDS = 15 * 60;
const DAY = 24 * 3600 * 1000;
const IDLE = { persistent: 30 * DAY, temporary: 12 * 3600 * 1000 };
const ABSOLUTE = { persistent: 90 * DAY, temporary: 24 * 3600 * 1000 };
/** Abas que renovam ao mesmo tempo: o segredo anterior é aceito por este tempo. */
const ROTATION_GRACE_MS = 60 * 1000;

export type SecurityEventType =
    | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_LOCKED' | 'NEW_DEVICE'
    | 'LOGOUT' | 'SESSION_REVOKED' | 'SESSIONS_REVOKED_OTHERS' | 'TOKEN_REUSE'
    | 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'REPORTED_NOT_ME';

export class SessionError extends Error {
    constructor(public code: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'REUSED' | 'ROTATED', message: string) {
        super(message);
    }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

/** IP real do cliente (o Express confia no primeiro proxy: Render). */
export const clientIp = (req: Request) => (req.ip || '').replace(/^::ffff:/, '') || null;

/** Navegador e sistema em português, a partir do user-agent. */
export function describeDevice(ua: string | undefined) {
    const s = ua || '';
    const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
        : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Navegador';
    const os = /Android/.test(s) ? 'Android' : /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Windows/.test(s) ? 'Windows'
        : /Mac OS X/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'sistema desconhecido';
    const deviceType = /iPad|Tablet/i.test(s) || (/Android/.test(s) && !/Mobi/.test(s)) ? 'tablet' : /Mobi|iPhone|Android/.test(s) ? 'mobile' : 'desktop';
    return { browser, os, deviceType, label: `${browser} no ${os}` };
}

export async function logSecurityEvent(type: SecurityEventType, data: { userId?: string | null; req?: Request; sessionId?: string | null; detail?: string }) {
    try {
        await prisma.securityEvent.create({
            data: {
                type,
                userId: data.userId ?? null,
                sessionId: data.sessionId ?? null,
                ip: data.req ? clientIp(data.req) : null,
                userAgent: data.req?.get('user-agent')?.slice(0, 300) ?? null,
                detail: data.detail?.slice(0, 300) ?? null,
            },
        });
    } catch (error) {
        // O registro nunca derruba o fluxo de login
        console.error('[security] Falha ao gravar evento', type, error);
    }
}

export function signAccessToken(user: { id: string; role: Role }, sessionId: string) {
    return jwt.sign({ role: user.role, sid: sessionId }, env.JWT_SECRET, {
        algorithm: 'HS256',
        subject: user.id,
        expiresIn: ACCESS_TTL_SECONDS,
    });
}

const validDeviceId = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null);

/**
 * Abre a sessão depois de uma autenticação bem-sucedida (senha ou Google) e, se o aparelho
 * for novo para uma conta que já tinha sessões, manda o e-mail de alerta com "Não fui eu".
 */
export async function startSession(
    user: { id: string; role: Role; name: string; email: string; password: string },
    req: Request,
    opts: { deviceId?: unknown; remember?: unknown; method: 'password' | 'google' },
) {
    const deviceId = validDeviceId(opts.deviceId);
    const persistent = opts.remember !== false;
    const ua = req.get('user-agent')?.slice(0, 300);
    const device = describeDevice(ua);
    const ip = clientIp(req);
    const now = Date.now();

    const [previousSessions, knownDevice] = await Promise.all([
        prisma.userSession.count({ where: { userId: user.id } }),
        deviceId ? prisma.userSession.findFirst({ where: { userId: user.id, deviceId }, select: { id: true } }) : Promise.resolve(null),
    ]);

    const secret = newSecret();
    const session = await prisma.userSession.create({
        data: {
            userId: user.id,
            refreshHash: sha256(secret),
            deviceId,
            persistent,
            method: opts.method,
            userAgent: ua ?? null,
            browser: device.browser,
            os: device.os,
            deviceType: device.deviceType,
            ip,
            expiresAt: new Date(now + (persistent ? IDLE.persistent : IDLE.temporary)),
            absoluteExpiresAt: new Date(now + (persistent ? ABSOLUTE.persistent : ABSOLUTE.temporary)),
        },
    });

    await logSecurityEvent('LOGIN_SUCCESS', { userId: user.id, req, sessionId: session.id, detail: `${opts.method} · ${device.label}` });

    // Primeira sessão registrada da conta (cadastro ou primeiro login após esta versão): sem alerta
    const isNewDevice = previousSessions > 0 && !knownDevice;
    if (isNewDevice) {
        await logSecurityEvent('NEW_DEVICE', { userId: user.id, req, sessionId: session.id, detail: device.label });
        const reportToken = jwt.sign(
            { purpose: 'report-access', sid: session.id, pwd: passwordFingerprint(user.password) },
            env.JWT_SECRET,
            { algorithm: 'HS256', subject: user.id, expiresIn: '3d' },
        );
        const link = `${siteUrl()}/seguranca/nao-fui-eu?token=${encodeURIComponent(reportToken)}`;
        sendMailInBackground(
            user.email,
            'Novo acesso à sua conta · T3 OOH',
            newDeviceEmail(user.name, { when: new Date(now), device: device.label, ip, method: opts.method }, link),
            'novo aparelho',
        );
    }

    return {
        session,
        isNewDevice,
        accessToken: signAccessToken(user, session.id),
        refreshToken: `${session.id}.${secret}`,
    };
}

/** Troca o refresh token por um novo par (rotação). Detecta reuso de token antigo. */
export async function rotateSession(refreshToken: unknown, req: Request) {
    if (typeof refreshToken !== 'string' || !refreshToken.includes('.')) throw new SessionError('INVALID', 'Sessão inválida.');
    const [sid, secret] = refreshToken.split('.', 2);
    const session = await prisma.userSession.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || !secret) throw new SessionError('INVALID', 'Sessão inválida.');
    if (session.revokedAt) throw new SessionError('REVOKED', 'Sessão encerrada.');
    const now = Date.now();
    if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) throw new SessionError('EXPIRED', 'Sessão expirada.');

    const hash = sha256(secret);
    if (hash !== session.refreshHash) {
        // Outra aba acabou de renovar com o mesmo token: o cliente relê o token novo
        if (hash === session.previousHash && session.rotatedAt && now - session.rotatedAt.getTime() < ROTATION_GRACE_MS) {
            throw new SessionError('ROTATED', 'Sessão já renovada.');
        }
        // Token antigo reaparecendo fora da janela: pode ter sido copiado. Encerra a sessão.
        await revokeSession(session.id, 'token-reuse');
        await logSecurityEvent('TOKEN_REUSE', { userId: session.userId, req, sessionId: session.id });
        throw new SessionError('REUSED', 'Sessão encerrada por segurança. Entre de novo.');
    }

    const next = newSecret();
    const idle = session.persistent ? IDLE.persistent : IDLE.temporary;
    await prisma.userSession.update({
        where: { id: session.id },
        data: {
            refreshHash: sha256(next),
            previousHash: hash,
            rotatedAt: new Date(now),
            lastUsedAt: new Date(now),
            ip: clientIp(req),
            expiresAt: new Date(Math.min(now + idle, session.absoluteExpiresAt.getTime())),
        },
    });

    return {
        user: session.user,
        persistent: session.persistent,
        accessToken: signAccessToken(session.user, session.id),
        refreshToken: `${session.id}.${next}`,
    };
}

// ============================ ENCERRAMENTO ============================

/** Cache curto de sessões encerradas, para o middleware não ir ao banco em toda requisição. */
const activeCache = new Map<string, { active: boolean; at: number }>();
const CACHE_MS = 30 * 1000;

export async function isSessionActive(sid: string) {
    const hit = activeCache.get(sid);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.active;
    const s = await prisma.userSession.findUnique({ where: { id: sid }, select: { revokedAt: true, absoluteExpiresAt: true } });
    const active = Boolean(s && !s.revokedAt && s.absoluteExpiresAt.getTime() > Date.now());
    activeCache.set(sid, { active, at: Date.now() });
    if (activeCache.size > 5000) activeCache.clear();
    return active;
}

export async function revokeSession(sid: string, reason: string) {
    await prisma.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    activeCache.set(sid, { active: false, at: Date.now() });
}

/** Encerra todas as sessões da conta (menos, opcionalmente, a atual). */
export async function revokeUserSessions(userId: string, reason: string, exceptSid?: string | null) {
    const sessions = await prisma.userSession.findMany({
        where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
        select: { id: true },
    });
    if (!sessions.length) return 0;
    await prisma.userSession.updateMany({ where: { id: { in: sessions.map((s) => s.id) } }, data: { revokedAt: new Date(), revokeReason: reason } });
    for (const s of sessions) activeCache.set(s.id, { active: false, at: Date.now() });
    return sessions.length;
}

/** Impressão digital curta do hash da senha: links assinados deixam de valer quando a senha muda. */
export function passwordFingerprint(passwordHash: string) {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

/** Limpeza: sessões vencidas ou encerradas há mais de 30 dias (roda junto de logins). */
export async function pruneOldSessions() {
    const cutoff = new Date(Date.now() - 30 * DAY);
    await prisma.userSession.deleteMany({
        where: { OR: [{ absoluteExpiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    }).catch(() => {});
}

// ============================ BLOQUEIO POR TENTATIVAS ============================

/**
 * Senha errada repetida na mesma conta: 5 erros em 15 min bloqueiam novas tentativas por 15 min
 * (além do limite por IP). Fica em memória: vale por instância do servidor.
 */
const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();
const FAIL_WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;

export function loginLockedFor(email: string) {
    const f = failures.get(email);
    if (!f) return 0;
    const now = Date.now();
    if (f.lockedUntil > now) return Math.ceil((f.lockedUntil - now) / 60000);
    if (now - f.first > FAIL_WINDOW) failures.delete(email);
    return 0;
}

export function registerLoginFailure(email: string) {
    const now = Date.now();
    const f = failures.get(email);
    const entry = !f || now - f.first > FAIL_WINDOW ? { count: 0, first: now, lockedUntil: 0 } : f;
    entry.count += 1;
    if (entry.count >= MAX_FAILS) entry.lockedUntil = now + FAIL_WINDOW;
    failures.set(email, entry);
    if (failures.size > 10000) failures.clear();
    return entry.count >= MAX_FAILS;
}

export const clearLoginFailures = (email: string) => failures.delete(email);
