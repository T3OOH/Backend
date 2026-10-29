import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|monitor|curl|wget|python|axios/i;

const eventSchema = z.object({
    type: z.enum(['pageview', 'whatsapp_click']),
    path: z.string().trim().max(300),
    sessionId: z.string().trim().min(8).max(64),
    source: z.string().trim().max(80).optional().nullable(),
    medium: z.string().trim().max(80).optional().nullable(),
    campaign: z.string().trim().max(150).optional().nullable(),
    landingPage: z.string().trim().max(300).optional().nullable(),
    referrer: z.string().trim().max(300).optional().nullable(),
    device: z.enum(['mobile', 'tablet', 'desktop']).optional().nullable(),
    browser: z.string().trim().max(40).optional().nullable(),
    os: z.string().trim().max(40).optional().nullable(),
});

type Touch = { source?: string | null; medium?: string | null; campaign?: string | null; landingPage?: string | null; referrer?: string | null };
type LeadKind = 'CONTACT' | 'QUOTE' | 'SOLUTION' | 'ORDER' | 'SIGNUP';

const LEAD_LABEL: Record<LeadKind, string> = {
    CONTACT: 'Contato',
    QUOTE: 'Orçamento pelo mapa',
    SOLUTION: 'Orçamento T3 Solution',
    ORDER: 'Pedido pelo catálogo',
    SIGNUP: 'Cadastro',
};

const asTouch = (value: Prisma.JsonValue | null): Touch | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Touch) : null;

/** Dia no fuso de Goiânia (AAAA-MM-DD). */
const dayKey = (date: Date) => new Date(date.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

export const analyticsController = {
    /** Registro anônimo de visita (sem cookies de terceiros e sem IP). */
    async track(req: Request, res: Response) {
        if (BOT_UA.test(req.get('user-agent') ?? '')) return res.status(204).end();
        const parsed = eventSchema.safeParse(req.body);
        if (!parsed.success) return res.status(204).end();
        const e = parsed.data;
        // Áreas internas não entram na conta do tráfego do site
        if (/^\/(dashboard|crm)(\/|$)/.test(e.path)) return res.status(204).end();

        await prisma.analyticsEvent.create({
            data: {
                eventType: e.type,
                path: e.path,
                sessionId: e.sessionId,
                source: e.source?.toLowerCase() || 'direto',
                medium: e.medium?.toLowerCase() || null,
                campaign: e.campaign || null,
                landingPage: e.landingPage || null,
                referer: e.referrer || null,
                deviceModel: e.device || null,
                browser: e.browser || null,
                os: e.os || null,
            },
        });
        return res.status(204).end();
    },

    /** Painel de tráfego da gestão: visitas, origens, páginas e leads com origem. */
    async summary(req: Request, res: Response) {
        const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);

        const [totals, daily, sources, pages, devices, campaigns, landings] = await Promise.all([
            prisma.$queryRaw<{ pageviews: bigint; sessions: bigint; whatsapp: bigint }[]>`
                SELECT COUNT(*) FILTER (WHERE "eventType" = 'pageview') AS pageviews,
                       COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'pageview') AS sessions,
                       COUNT(*) FILTER (WHERE "eventType" = 'whatsapp_click') AS whatsapp
                FROM analytics_events WHERE "createdAt" >= ${since}`,
            prisma.$queryRaw<{ day: string; sessions: bigint; pageviews: bigint }[]>`
                SELECT to_char(("createdAt" - interval '3 hours')::date, 'YYYY-MM-DD') AS day,
                       COUNT(DISTINCT "sessionId") AS sessions, COUNT(*) AS pageviews
                FROM analytics_events WHERE "createdAt" >= ${since} AND "eventType" = 'pageview'
                GROUP BY 1 ORDER BY 1`,
            prisma.$queryRaw<{ source: string; medium: string | null; sessions: bigint; whatsapp: bigint }[]>`
                SELECT COALESCE(source, 'direto') AS source, medium,
                       COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'pageview') AS sessions,
                       COUNT(*) FILTER (WHERE "eventType" = 'whatsapp_click') AS whatsapp
                FROM analytics_events WHERE "createdAt" >= ${since}
                GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`,
            prisma.$queryRaw<{ path: string; views: bigint; sessions: bigint }[]>`
                SELECT path, COUNT(*) AS views, COUNT(DISTINCT "sessionId") AS sessions
                FROM analytics_events WHERE "createdAt" >= ${since} AND "eventType" = 'pageview'
                GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
            prisma.$queryRaw<{ device: string | null; sessions: bigint }[]>`
                SELECT "deviceModel" AS device, COUNT(DISTINCT "sessionId") AS sessions
                FROM analytics_events WHERE "createdAt" >= ${since} AND "eventType" = 'pageview'
                GROUP BY 1 ORDER BY 2 DESC`,
            prisma.$queryRaw<{ campaign: string; source: string; sessions: bigint }[]>`
                SELECT campaign, COALESCE(source, 'direto') AS source, COUNT(DISTINCT "sessionId") AS sessions
                FROM analytics_events WHERE "createdAt" >= ${since} AND "eventType" = 'pageview' AND campaign IS NOT NULL
                GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
            prisma.$queryRaw<{ path: string; sessions: bigint }[]>`
                SELECT "landingPage" AS path, COUNT(DISTINCT "sessionId") AS sessions
                FROM analytics_events WHERE "createdAt" >= ${since} AND "eventType" = 'pageview' AND "landingPage" IS NOT NULL
                GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        ]);

        // Leads dos quatro canais do site, com a origem gravada no envio
        const [contacts, quotes, orders, signups] = await Promise.all([
            prisma.contact.findMany({
                where: { createdAt: { gte: since } },
                select: { id: true, name: true, email: true, company: true, createdAt: true, attribution: true },
            }),
            prisma.crmDeal.findMany({
                where: { createdAt: { gte: since }, OR: [{ attribution: { not: Prisma.DbNull } }, { title: { startsWith: 'Cotação via' } }] },
                select: { id: true, createdAt: true, attribution: true, expectedValue: true, line: true, client: { select: { name: true, email: true, company: true } } },
            }),
            prisma.order.findMany({
                where: { createdAt: { gte: since } },
                select: { id: true, createdAt: true, attribution: true, totalValue: true, user: { select: { name: true, email: true, companyName: true } } },
            }),
            prisma.user.findMany({
                where: { createdAt: { gte: since }, role: { in: [Role.USER, Role.COMPANY] } },
                select: { id: true, name: true, email: true, companyName: true, createdAt: true, attribution: true },
            }),
        ]);

        const leads = [
            ...contacts.map((c) => ({ id: c.id, kind: 'CONTACT' as LeadKind, name: c.name, email: c.email, company: c.company, createdAt: c.createdAt, value: null as number | null, attribution: asTouch(c.attribution) })),
            ...quotes.map((d) => ({ id: d.id, kind: (d.line === 'SOLUTION' ? 'SOLUTION' : 'QUOTE') as LeadKind, name: d.client.name, email: d.client.email, company: d.client.company, createdAt: d.createdAt, value: d.expectedValue, attribution: asTouch(d.attribution) })),
            ...orders.map((o) => ({ id: o.id, kind: 'ORDER' as LeadKind, name: o.user.name, email: o.user.email, company: o.user.companyName, createdAt: o.createdAt, value: o.totalValue, attribution: asTouch(o.attribution) })),
            ...signups.map((u) => ({ id: u.id, kind: 'SIGNUP' as LeadKind, name: u.name, email: u.email, company: u.companyName, createdAt: u.createdAt, value: null, attribution: asTouch(u.attribution) })),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        // Leads sem origem são de antes do rastreamento (ou de navegador que bloqueou o envio)
        const sourceOf = (l: (typeof leads)[number]) => l.attribution?.source?.toLowerCase() || 'sem registro';

        const leadsBySource = new Map<string, number>();
        const leadsByDay = new Map<string, number>();
        const leadsByKind = new Map<LeadKind, number>();
        for (const l of leads) {
            leadsBySource.set(sourceOf(l), (leadsBySource.get(sourceOf(l)) ?? 0) + 1);
            leadsByDay.set(dayKey(l.createdAt), (leadsByDay.get(dayKey(l.createdAt)) ?? 0) + 1);
            leadsByKind.set(l.kind, (leadsByKind.get(l.kind) ?? 0) + 1);
        }

        // Série diária completa (dias sem visita entram com zero)
        const dailyMap = new Map(daily.map((d) => [d.day, d]));
        const series = Array.from({ length: days }, (_, i) => {
            const day = dayKey(new Date(Date.now() - (days - 1 - i) * 24 * 3600 * 1000));
            const d = dailyMap.get(day);
            return { day, sessions: num(d?.sessions), pageviews: num(d?.pageviews), leads: leadsByDay.get(day) ?? 0 };
        });

        // Origens: visitas do tráfego + leads com a mesma origem
        const bySource = new Map<string, { source: string; mediums: Set<string>; sessions: number; whatsapp: number; leads: number }>();
        for (const s of sources) {
            const row = bySource.get(s.source) ?? { source: s.source, mediums: new Set<string>(), sessions: 0, whatsapp: 0, leads: 0 };
            if (s.medium) row.mediums.add(s.medium);
            row.sessions += num(s.sessions);
            row.whatsapp += num(s.whatsapp);
            bySource.set(s.source, row);
        }
        for (const [source, count] of leadsBySource) {
            const row = bySource.get(source) ?? { source, mediums: new Set<string>(), sessions: 0, whatsapp: 0, leads: 0 };
            row.leads = count;
            bySource.set(source, row);
        }

        const t = totals[0];
        const sessions = num(t?.sessions);
        return res.json({
            days,
            totals: {
                sessions,
                pageviews: num(t?.pageviews),
                whatsappClicks: num(t?.whatsapp),
                leads: leads.length,
                conversion: sessions ? leads.length / sessions : 0,
                leadsByKind: Object.fromEntries((Object.keys(LEAD_LABEL) as LeadKind[]).map((k) => [k, leadsByKind.get(k) ?? 0])),
            },
            series,
            sources: [...bySource.values()]
                .map(({ mediums, ...r }) => ({ ...r, medium: [...mediums].join(', ') || null, conversion: r.sessions ? r.leads / r.sessions : null }))
                .sort((a, b) => b.sessions - a.sessions || b.leads - a.leads),
            pages: pages.map((p) => ({ path: p.path, views: num(p.views), sessions: num(p.sessions) })),
            landings: landings.map((p) => ({ path: p.path, sessions: num(p.sessions) })),
            devices: devices.map((d) => ({ device: d.device || 'desconhecido', sessions: num(d.sessions) })),
            campaigns: campaigns.map((c) => ({ campaign: c.campaign, source: c.source, sessions: num(c.sessions) })),
            leads: leads.slice(0, 100).map((l) => ({
                id: l.id,
                kind: l.kind,
                kindLabel: LEAD_LABEL[l.kind],
                name: l.name,
                email: l.email,
                company: l.company,
                value: l.value,
                createdAt: l.createdAt,
                source: sourceOf(l),
                medium: l.attribution?.medium ?? null,
                campaign: l.attribution?.campaign ?? null,
                landingPage: l.attribution?.landingPage ?? null,
                referrer: l.attribution?.referrer ?? null,
            })),
        });
    },
};
