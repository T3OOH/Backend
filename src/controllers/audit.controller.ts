import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../database/prisma';

const listQuery = z.object({
    level: z.enum(['info', 'warning', 'error']).optional(),
    source: z.enum(['api', 'database', 'repository', 'client']).optional(),
    entity: z.string().trim().max(60).optional(),
    q: z.string().trim().max(120).optional(),
    days: z.coerce.number().int().min(1).max(365).default(7),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(2000).default(50),
});

const clientErrorSchema = z.object({
    message: z.string().trim().min(1).max(1000),
    stack: z.string().max(4000).optional().nullable(),
    url: z.string().max(300).optional().nullable(),
    userAgent: z.string().max(300).optional().nullable(),
    kind: z.enum(['exception', 'rejection', 'render', 'chunk']).default('exception'),
});

export const auditController = {
    /** Lista com filtros e busca (Gestão > Registros). */
    async list(req: Request, res: Response) {
        const parsed = listQuery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ error: 'Filtros inválidos.' });
        const { level, source, entity, q, days, page, pageSize } = parsed.data;

        const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
        const where: Prisma.AuditLogWhereInput = {
            createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
            ...(level ? { level } : {}),
            ...(source ? { source } : {}),
            ...(entity ? { entity } : {}),
            ...(q ? {
                OR: [
                    { summary: contains(q) }, { actorName: contains(q) }, { entityId: contains(q) },
                    { path: contains(q) }, { entity: contains(q) }, { requestId: contains(q) }, { id: q },
                ],
            } : {}),
        };

        try {
            const [items, total, byLevel] = await Promise.all([
                prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
                prisma.auditLog.count({ where }),
                // Contagem por nível com os mesmos filtros, menos o próprio nível (chips do topo)
                prisma.auditLog.groupBy({ by: ['level'], where: { ...where, level: undefined }, _count: { _all: true } }),
            ]);
            return res.json({
                items, total, page, pageSize,
                counts: Object.fromEntries(byLevel.map((r) => [r.level, r._count._all])),
            });
        } catch (error) {
            console.error('[Audit] list Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    /** Tabelas e repositórios que aparecem no registro (filtro "Onde"). */
    async facets(_req: Request, res: Response) {
        try {
            const entities = await prisma.auditLog.groupBy({
                by: ['entity'],
                where: { entity: { not: null }, createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
                _count: { _all: true },
                orderBy: { entity: 'asc' },
            });
            return res.json({ entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })) });
        } catch (error) {
            console.error('[Audit] facets Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    /** Público: erro que aconteceu no navegador. Devolve o código para o cliente mandar ao suporte. */
    async clientError(req: Request, res: Response) {
        const parsed = clientErrorSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Erro inválido.' });
        const { message, stack, url, userAgent, kind } = parsed.data;

        // Autor opcional: quem está logado aparece no registro
        let actor: { id: string; role: string } | undefined;
        const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
        if (scheme === 'Bearer' && token) {
            try {
                const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string; role?: string };
                if (p.sub && p.role) actor = { id: p.sub, role: p.role };
            } catch { /* token vencido: registra sem autor */ }
        }

        try {
            const row = await prisma.auditLog.create({
                data: {
                    level: 'error', source: 'client', action: 'error',
                    summary: `Erro no site${url ? ` em ${new URL(url, 'https://t3ooh.com').pathname}` : ''}: ${message}`.slice(0, 500),
                    changes: { kind, stack: stack ?? null, url: url ?? null, userAgent: userAgent ?? req.get('user-agent') ?? null },
                    actorId: actor?.id ?? null, actorRole: actor?.role ?? null,
                    actorName: actor ? (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? null : null,
                    ip: req.ip ?? null, path: url ? url.slice(0, 300) : null,
                },
                select: { id: true },
            });
            return res.status(201).json({ id: row.id });
        } catch (error) {
            console.error('[Audit] clientError Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },
};
