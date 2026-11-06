import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { addMonths, Booking, buildOccupancy, buildSummary } from '../services/reports.service';
import { buildIndicators, lerSla, slaSchema } from '../services/indicators.service';

const summaryQuery = z.object({ days: z.coerce.number().int().refine((v) => [30, 90, 180, 365].includes(v)).default(90) });
const occupancyQuery = z.object({ months: z.coerce.number().int().min(1).max(12).default(6) });
const indicatorsQuery = z.object({ days: z.coerce.number().int().refine((v) => [7, 30, 90, 180, 365].includes(v)).default(30) });
const SLA_KEY = 'crm_sla';

export const reportsController = {
    /** KPIs, SLA dos processos, lead time, tempo por etapa e por comercial (Gestão → Indicadores). */
    async indicators(req: Request, res: Response) {
        const parsed = indicatorsQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Período inválido. Use days = 7, 30, 90, 180 ou 365.' });
        try {
            const agora = new Date();
            // Série semanal cobre 12 semanas: busca o que for maior entre o período e 84 dias
            const desde = new Date(agora.getTime() - Math.max(parsed.data.days, 84) * 86_400_000);
            const [deals, activities, orders, contacts, sellers, setting] = await Promise.all([
                prisma.crmDeal.findMany({
                    where: { OR: [{ status: 'OPEN' }, { updatedAt: { gte: desde } }, { createdAt: { gte: desde } }] },
                    select: {
                        id: true, title: true, stage: true, status: true, line: true, sellerId: true, expectedValue: true, probability: true,
                        createdAt: true, updatedAt: true, client: { select: { name: true } },
                        events: { select: { type: true, fromValue: true, toValue: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
                    },
                }),
                prisma.crmActivity.findMany({
                    where: { OR: [{ isCompleted: false }, { dueDate: { gte: desde } }] },
                    select: { sellerId: true, dueDate: true, isCompleted: true, updatedAt: true, title: true, client: { select: { name: true } } },
                }),
                prisma.order.findMany({ where: { OR: [{ status: 'PENDING' }, { createdAt: { gte: desde } }] }, select: { status: true, createdAt: true, updatedAt: true, totalValue: true } }),
                prisma.contact.findMany({ where: { OR: [{ status: { not: 'RESOLVED' } }, { createdAt: { gte: desde } }] }, select: { status: true, createdAt: true, updatedAt: true, name: true } }),
                prisma.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER', 'COMERCIAL'] } }, select: { id: true, name: true, role: true } }),
                prisma.systemSetting.findUnique({ where: { key: SLA_KEY } }),
            ]);
            return res.json(buildIndicators({
                deals: deals.map(({ client, ...d }) => ({ ...d, stage: String(d.stage), status: String(d.status), clientName: client.name })),
                activities: activities.map(({ client, ...a }) => ({ ...a, clientName: client.name })),
                orders: orders.map((o) => ({ ...o, status: String(o.status) })),
                contacts: contacts.map((c) => ({ ...c, status: String(c.status) })),
                sellers: sellers.map((u) => ({ ...u, role: String(u.role) })),
                sla: lerSla(setting?.value),
                agora,
                dias: parsed.data.days,
            }));
        } catch (error) {
            console.error('[Reports] indicators Error:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    },

    /** Metas de SLA dos processos. */
    async getSla(_req: Request, res: Response) {
        const setting = await prisma.systemSetting.findUnique({ where: { key: SLA_KEY } });
        return res.json(lerSla(setting?.value));
    },

    async updateSla(req: Request, res: Response) {
        const parsed = slaSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Metas inválidas.', details: parsed.error.issues });
        const value = JSON.stringify(parsed.data);
        await prisma.systemSetting.upsert({ where: { key: SLA_KEY }, update: { value }, create: { key: SLA_KEY, value, group: 'processos' } });
        return res.json(parsed.data);
    },

    /** Vendas, funil, previsão, receita mensal e origem dos negócios. */
    async summary(req: Request, res: Response) {
        const parsed = summaryQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Período inválido. Use days = 30, 90, 180 ou 365.' });
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
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    },

    /** Painéis x próximos meses: o que já está contratado e o que está livre para vender. */
    async occupancy(req: Request, res: Response) {
        const parsed = occupancyQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Período inválido. Use months entre 1 e 12.' });
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
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    },
};
