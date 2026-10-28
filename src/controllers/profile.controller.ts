import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';

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
    }
};
