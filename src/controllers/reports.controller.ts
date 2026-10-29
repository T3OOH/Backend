import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { addMonths, Booking, buildOccupancy, buildSummary } from '../services/reports.service';

const summaryQuery = z.object({ days: z.coerce.number().int().refine((v) => [30, 90, 180, 365].includes(v)).default(90) });
const occupancyQuery = z.object({ months: z.coerce.number().int().min(1).max(12).default(6) });

export const reportsController = {
    /** Vendas, funil, previsão, receita mensal e origem dos negócios. */
    async summary(req: Request, res: Response) {
        const parsed = summaryQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Período inválido.' });
        try {
            // Receita mensal cobre 12 meses, então a busca vai até 1 ano atrás (e todos os abertos)
            const yearAgo = new Date(Date.now() - 366 * 86_400_000);
            const [deals, orders] = await Promise.all([
                prisma.crmDeal.findMany({
                    where: { OR: [{ status: 'OPEN' }, { updatedAt: { gte: yearAgo } }, { createdAt: { gte: yearAgo } }] },
                    select: { stage: true, status: true, line: true, expectedValue: true, probability: true, createdAt: true, updatedAt: true, attribution: true },
                }),
                prisma.order.findMany({
                    where: { updatedAt: { gte: yearAgo } },
                    select: { status: true, totalValue: true, createdAt: true, updatedAt: true },
                }),
            ]);
            return res.json(buildSummary(deals, orders, new Date(), parsed.data.days));
        } catch (error) {
            console.error('[Reports] summary Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    /** Painéis x próximos meses: o que já está contratado e o que está livre para vender. */
    async occupancy(req: Request, res: Response) {
        const parsed = occupancyQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Período inválido.' });
        try {
            const now = new Date();
            const [panels, orders, deals] = await Promise.all([
                prisma.panel.findMany({ select: { id: true, name: true, city: true, state: true, status: true }, orderBy: [{ city: 'asc' }, { name: 'asc' }] }),
                prisma.order.findMany({
                    where: { status: { in: ['APPROVED', 'COMPLETED'] } },
                    select: {
                        startDate: true, endDate: true, createdAt: true,
                        user: { select: { name: true, companyName: true, company: { select: { tradeName: true, corporateName: true } } } },
                        items: { select: { panelId: true } },
                    },
                }),
                prisma.crmDeal.findMany({
                    where: { status: 'WON', items: { some: {} } },
                    select: { updatedAt: true, contractMonths: true, client: { select: { name: true, company: true } }, items: { select: { panelId: true } } },
                }),
            ]);

            const bookings: Booking[] = [
                ...orders.flatMap((o) => {
                    const start = o.startDate ?? o.createdAt;
                    const end = o.endDate ?? addMonths(start, 1);
                    const label = o.user.company?.tradeName || o.user.company?.corporateName || o.user.companyName || o.user.name;
                    return o.items.map((i) => ({ panelId: i.panelId, start, end, label }));
                }),
                // Negócio ganho: o contrato começa no fechamento e dura o prazo combinado
                ...deals.flatMap((d) => d.items.map((i) => ({
                    panelId: i.panelId, start: d.updatedAt, end: addMonths(d.updatedAt, d.contractMonths), label: d.client.company || d.client.name,
                }))),
            ];

            return res.json(buildOccupancy(panels, bookings, now, parsed.data.months));
        } catch (error) {
            console.error('[Reports] occupancy Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },
};
