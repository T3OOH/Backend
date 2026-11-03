import { Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../database/prisma';
import { registerSchema } from '../validators/auth.validator';
import { passwordChangedEmail, sendMailInBackground, siteUrl } from '../services/mail.service';
import { clientIp, describeDevice, logSecurityEvent, revokeSession, revokeUserSessions } from '../services/session.service';

/** Eventos mostrados na "Atividade recente" (texto para o usuário). */
const EVENT_LABEL: Record<string, string> = {
    LOGIN_SUCCESS: 'Entrada na conta',
    LOGIN_FAILED: 'Tentativa de entrada com senha errada',
    LOGIN_LOCKED: 'Entrada bloqueada por muitas senhas erradas',
    NEW_DEVICE: 'Entrada em aparelho novo (e-mail enviado)',
    LOGOUT: 'Saída da conta',
    SESSION_REVOKED: 'Aparelho desconectado',
    SESSIONS_REVOKED_OTHERS: 'Outros aparelhos desconectados',
    TOKEN_REUSE: 'Sessão encerrada por uso suspeito',
    PASSWORD_CHANGED: 'Senha alterada no perfil',
    PASSWORD_RESET: 'Senha redefinida por e-mail',
    REPORTED_NOT_ME: '"Não fui eu": todos os aparelhos desconectados',
};

const profileSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    companyName: true,
    role: true,
    preferences: true,
    googleId: true,
    createdAt: true,
} as const;

/** Personalização visual do site. Só valores conhecidos são guardados. */
const preferencesSchema = z.object({
    theme: z.enum(['dark', 'light']).optional(),
    background: z.enum(['video', 'still']).optional(),
    motion: z.enum(['full', 'reduced']).optional(),
    textSize: z.enum(['default', 'large']).optional(),
    avatarColor: z.enum(['orange', 'white', 'emerald', 'sky', 'rose']).optional(),
    mapStyle: z.enum(['dark', 'light']).optional(),
}).strict();

/** O perfil não expõe o id do Google, só se a conta está ligada. */
function toProfile<T extends { googleId?: string | null }>(user: T | null) {
    if (!user) return user;
    const { googleId, ...rest } = user;
    return { ...rest, googleLinked: Boolean(googleId) };
}

const updateProfileSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).optional().nullable(),
    // Aceita "companyName" e o nome legado "company"
    companyName: z.string().trim().max(120).optional().nullable(),
    company: z.string().trim().max(120).optional().nullable(),
});

export const profileController = {
    async getProfile(req: Request, res: Response) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                select: profileSelect
            });
            return res.json(toProfile(user));
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar perfil' });
        }
    },

    async updateProfile(req: Request, res: Response) {
        const parsed = updateProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.issues });
        }
        const { name, phone, companyName, company } = parsed.data;

        try {
            const user = await prisma.user.update({
                where: { id: req.user!.id },
                data: { name, phone, companyName: companyName ?? company },
                select: profileSelect
            });

            return res.json(toProfile(user));
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao atualizar perfil' });
        }
    },

    async updatePreferences(req: Request, res: Response) {
        const parsed = preferencesSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Preferências inválidas.', details: parsed.error.issues });
        }

        const current = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { preferences: true } });
        const previous = current?.preferences && typeof current.preferences === 'object' && !Array.isArray(current.preferences)
            ? current.preferences
            : {};

        const user = await prisma.user.update({
            where: { id: req.user!.id },
            data: { preferences: { ...previous, ...parsed.data } },
            select: { preferences: true },
        });
        return res.json(user.preferences);
    },

    /**
     * Orçamentos do cliente em um só formato:
     * - do mapa (CrmDeal, ligado pelo e-mail do cliente);
     * - do catálogo (Order, ligado ao usuário). Antes estes não apareciam no perfil.
     */
    async getMyOrders(req: Request, res: Response) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                select: { email: true }
            });

            const panelSelect = { select: { name: true, city: true, state: true, images: true } } as const;
            const sellerSelect = { select: { name: true, phone: true } } as const;

            const [deals, orders] = await Promise.all([
                user?.email
                    ? prisma.crmDeal.findMany({
                        where: { client: { email: { equals: user.email, mode: 'insensitive' } } },
                        include: { items: { include: { panel: panelSelect } }, seller: sellerSelect },
                        orderBy: { createdAt: 'desc' }
                    })
                    : Promise.resolve([]),
                prisma.order.findMany({
                    where: { userId: req.user!.id },
                    include: { items: { include: { panel: panelSelect } }, seller: sellerSelect },
                    orderBy: { createdAt: 'desc' }
                }),
            ]);

            const DEAL_STATUS = { OPEN: 'IN_REVIEW', WON: 'APPROVED', LOST: 'CANCELLED' } as const;
            const ORDER_STATUS = { PENDING: 'IN_REVIEW', APPROVED: 'PROPOSAL_SENT', COMPLETED: 'APPROVED', REJECTED: 'CANCELLED' } as const;
            const monthsBetween = (a?: Date | null, b?: Date | null) =>
                a && b ? Math.max(1, Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000 / 30)) : 1;

            const list = [
                ...deals.map((d) => ({
                    id: d.id,
                    source: 'MAP' as const,
                    createdAt: d.createdAt,
                    status: DEAL_STATUS[d.status],
                    total: d.expectedValue,
                    months: d.contractMonths,
                    seller: d.seller,
                    items: d.items.map((i) => ({ id: i.id, priceSnapshot: i.priceSnapshot, panel: i.panel })),
                    // Pedidos da T3 Solution não têm painéis da rede: o perfil mostra o projeto
                    line: d.line,
                    solution: d.line === 'SOLUTION' ? d.solution : null,
                })),
                ...orders.map((o) => ({
                    id: o.id,
                    source: 'CATALOG' as const,
                    createdAt: o.createdAt,
                    status: ORDER_STATUS[o.status],
                    total: o.totalValue,
                    months: monthsBetween(o.startDate, o.endDate),
                    seller: o.seller,
                    items: o.items.map((i) => ({ id: i.id, priceSnapshot: i.priceSnapshot, panel: i.panel })),
                })),
            ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            return res.json(list);
        } catch (error) {
            console.error('[Profile] getMyOrders Error:', error);
            return res.status(500).json({ error: 'Erro ao buscar orçamentos' });
        }
    },

    // ============================ SEGURANÇA ============================

    /** Aparelhos conectados e atividade recente da conta. */
    async getSecurity(req: Request, res: Response) {
        const now = new Date();
        const [sessions, events, user] = await Promise.all([
            prisma.userSession.findMany({
                where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
                orderBy: { lastUsedAt: 'desc' },
                select: { id: true, browser: true, os: true, deviceType: true, ip: true, method: true, persistent: true, createdAt: true, lastUsedAt: true },
            }),
            prisma.securityEvent.findMany({
                where: { userId: req.user!.id },
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: { id: true, type: true, ip: true, userAgent: true, createdAt: true },
            }),
            prisma.user.findUnique({ where: { id: req.user!.id }, select: { googleId: true } }),
        ]);
        return res.json({
            sessions: sessions.map((s) => ({ ...s, current: s.id === req.user!.sessionId })),
            events: events.map((e) => ({ id: e.id, type: e.type, label: EVENT_LABEL[e.type] ?? e.type, ip: e.ip, device: describeDevice(e.userAgent ?? undefined).label, createdAt: e.createdAt })),
            googleLinked: Boolean(user?.googleId),
        });
    },

    /** Desconecta um aparelho da própria conta. */
    async revokeSession(req: Request, res: Response) {
        const id = String(req.params.id);
        const session = await prisma.userSession.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } });
        if (!session) return res.status(404).json({ error: 'Aparelho não encontrado.' });
        await revokeSession(id, 'user-revoked');
        await logSecurityEvent('SESSION_REVOKED', { userId: req.user!.id, req, sessionId: id });
        return res.status(204).end();
    },

    /** Desconecta todos os outros aparelhos (mantém este). */
    async revokeOtherSessions(req: Request, res: Response) {
        const closed = await revokeUserSessions(req.user!.id, 'user-revoked-others', req.user!.sessionId);
        await logSecurityEvent('SESSIONS_REVOKED_OTHERS', { userId: req.user!.id, req, sessionId: req.user!.sessionId, detail: `${closed} sessões` });
        return res.json({ closed });
    },

    /** Troca de senha com a senha atual. Os outros aparelhos saem e chega um e-mail de aviso. */
    async changePassword(req: Request, res: Response) {
        const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        const check = registerSchema.shape.password.safeParse(newPassword);
        if (!check.success) return res.status(400).json({ error: check.error.issues[0]?.message ?? 'Senha inválida.' });

        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });
        if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
            await logSecurityEvent('LOGIN_FAILED', { userId: user.id, req, detail: 'senha atual errada na troca de senha' });
            return res.status(400).json({ error: 'A senha atual não confere.' });
        }
        if (await bcrypt.compare(newPassword, user.password)) {
            return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
        }

        await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 12) } });
        const closed = await revokeUserSessions(user.id, 'password-changed', req.user!.sessionId);
        await logSecurityEvent('PASSWORD_CHANGED', { userId: user.id, req, sessionId: req.user!.sessionId, detail: `${closed} outras sessões encerradas` });

        sendMailInBackground(user.email, 'Sua senha foi alterada · T3 OOH', passwordChangedEmail(user.name,
            { when: new Date(), device: describeDevice(req.get('user-agent')).label, ip: clientIp(req) },
            `${siteUrl()}/recuperar-senha`), 'senha alterada');

        return res.json({ message: 'Senha alterada.', closedSessions: closed });
    },
};

