import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { requestContext } from '../lib/requestContext';

/**
 * Registro de auditoria. Grava alterações feitas pelo sistema (com o autor), erros da API e do
 * navegador e o histórico do repositório. Alterações feitas direto no banco são gravadas por um
 * gatilho no próprio Postgres (migração 20261030010000_registro_auditoria).
 * Nunca deixa uma falha de registro derrubar a operação principal.
 */

export type AuditLevel = 'info' | 'warning' | 'error';
export type AuditSource = 'api' | 'database' | 'repository' | 'client';

export interface AuditEntry {
    level?: AuditLevel;
    source: AuditSource;
    action: string;
    entity?: string | null;
    entityId?: string | null;
    summary: string;
    changes?: unknown;
    actorId?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
    ip?: string | null;
    method?: string | null;
    path?: string | null;
    status?: number | null;
    requestId?: string | null;
    externalId?: string | null;
    createdAt?: Date;
}

/** Modelos fora do registro: o próprio registro, visitas, sessões (renovação a cada hora) e chat. */
export const AUDIT_SKIP_MODELS = new Set(['AuditLog', 'AnalyticsEvent', 'UserSession', 'CrmMessage']);

/** Tabela de cada modelo (a mesma que o gatilho do banco grava em "entity"). */
export const MODEL_TABLE: Record<string, string> = {
    Company: 'companies', User: 'users', Panel: 'panels', Institutional: 'institutional', Category: 'categories',
    Order: 'orders', OrderItem: 'order_items', CrmClient: 'crm_clients', CrmDeal: 'crm_deals', CrmDealItem: 'crm_deal_items',
    CrmActivity: 'crm_activities', CrmNote: 'crm_notes', CrmCoupon: 'crm_coupons', AgendaTask: 'agenda_tasks', Banner: 'banners',
    SolutionPortfolio: 'solution_portfolio', Contact: 'contacts', SystemSetting: 'system_settings', SecurityEvent: 'security_events',
};

/** Nome amigável de cada tabela. */
const ENTITY_LABEL: Record<string, string> = {
    companies: 'empresa', users: 'usuário', panels: 'painel', institutional: 'página Sobre', categories: 'categoria',
    orders: 'pedido', order_items: 'item de pedido', crm_clients: 'cliente', crm_deals: 'negócio', crm_deal_items: 'painel do negócio',
    crm_activities: 'atividade', crm_notes: 'anotação', crm_coupons: 'cupom', agenda_tasks: 'compromisso', banners: 'banner',
    solution_portfolio: 'projeto Solution', contacts: 'contato do site', system_settings: 'configuração', security_events: 'evento de segurança',
};

/** Campos que nunca entram no registro. */
const HIDDEN = new Set(['password', 'refreshHash', 'previousHash', 'googleId', 'token', 'secret']);

const VERB: Record<string, string> = { create: 'criou', update: 'alterou', delete: 'excluiu', upsert: 'salvou' };

const clip = (v: string | null | undefined, max: number) => (v == null ? v : v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** Copia o registro sem os campos sensíveis e com datas e decimais em texto. */
export function sanitize(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (HIDDEN.has(k)) continue;
        if (v instanceof Date) out[k] = v.toISOString();
        else if (v && typeof v === 'object' && !Array.isArray(v) && 'toFixed' in (v as object)) out[k] = String(v);
        else if (v && typeof v === 'object' && !Array.isArray(v)) continue; // relação incluída: fica fora
        else out[k] = v;
    }
    return out;
}

/** Só o que mudou: { campo: { from, to } }. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
    if (!before || !after) return null;
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(after)) {
        if (k === 'updatedAt') continue;
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) fields[k] = { from: before[k] ?? null, to: after[k] ?? null };
    }
    return fields;
}

/** Nome que identifica o registro na frase do resumo. */
function recordLabel(row: Record<string, unknown> | null) {
    if (!row) return '';
    const v = row.name ?? row.title ?? row.code ?? row.key ?? row.email ?? row.type;
    return typeof v === 'string' && v ? ` "${clip(v, 60)}"` : '';
}

// ============================ AUTOR ============================

let client: PrismaClient | null = null;
const names = new Map<string, { name: string; at: number }>();

async function actorName(id: string) {
    const hit = names.get(id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.name;
    const user = await client?.user.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
    const name = user?.name ?? 'Usuário removido';
    names.set(id, { name, at: Date.now() });
    return name;
}

// ============================ GRAVAÇÃO ============================

export const audit = {
    /** Liga o registro ao cliente do banco sem extensão (gravar o registro não gera outro registro). */
    init(base: PrismaClient) {
        client = base;
    },

    async write(entry: AuditEntry) {
        if (!client) return;
        try {
            const ctx = requestContext.get();
            const actorId = entry.actorId ?? ctx?.actor?.id ?? null;
            await client.auditLog.create({
                data: {
                    level: entry.level ?? 'info',
                    source: entry.source,
                    action: entry.action,
                    entity: entry.entity ?? null,
                    entityId: clip(entry.entityId, 120) ?? null,
                    summary: clip(entry.summary, 500)!,
                    changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
                    actorId,
                    actorName: entry.actorName ?? (actorId ? await actorName(actorId) : null),
                    actorRole: entry.actorRole ?? ctx?.actor?.role ?? null,
                    ip: entry.ip ?? ctx?.ip ?? null,
                    method: entry.method ?? ctx?.method ?? null,
                    path: clip(entry.path ?? ctx?.path, 300) ?? null,
                    status: entry.status ?? null,
                    requestId: entry.requestId ?? ctx?.requestId ?? null,
                    externalId: entry.externalId ?? null,
                    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
                },
            });
        } catch (error) {
            // Registro duplicado do repositório (externalId) é esperado; o resto só vai para o console
            if ((error as { code?: string }).code !== 'P2002') writeConsole('[Audit] Falha ao gravar registro:', error);
        }
    },

    /** Alteração feita pelo sistema (chamado pela extensão do Prisma). */
    async recordChange(model: string, operation: string, before: unknown, after: unknown, bulkCount?: number) {
        const table = MODEL_TABLE[model] ?? model;
        const label = ENTITY_LABEL[table] ?? table;
        const ctx = requestContext.get();
        const who = ctx?.actor ? await actorName(ctx.actor.id) : 'Sistema';
        const b = sanitize(before);
        const a = sanitize(after);
        const action = operation.replace(/Many$/, '').replace('createAndReturn', 'create') as keyof typeof VERB;
        const id = (a?.id ?? b?.id) as string | undefined;

        let summary: string;
        let changes: unknown;
        if (bulkCount != null) {
            summary = `${who} ${VERB[action] ?? operation} ${bulkCount} ${bulkCount === 1 ? label : `registros de ${label}`}`;
            changes = after ? { filter: after } : null;
        } else if (model === 'SecurityEvent') {
            summary = `Segurança: ${String(a?.type ?? '').toLowerCase().replace(/_/g, ' ')}${a?.detail ? ` (${clip(String(a.detail), 120)})` : ''}`;
            changes = { after: a };
        } else {
            summary = `${who} ${VERB[action] ?? operation} ${label}${recordLabel(a ?? b)}`;
            changes = action === 'create' ? { after: a } : action === 'delete' ? { before: b } : { fields: diff(b, a) };
            // Atualização que não mudou nada visível
            if (action === 'update' && changes && Object.keys((changes as { fields: object }).fields ?? {}).length === 0) return;
        }

        await this.write({ source: 'api', action, entity: table, entityId: id, summary, changes });
        // A API se identifica para o gatilho do banco; se a identificação se perder no pooler,
        // a cópia "direto no banco" da mesma alteração é apagada logo depois
        scheduleDuplicateCleanup(table, action, id);
    },
};

// ============================ DUPLICADOS DO GATILHO ============================

const pendingCleanup = new Map<string, { table: string; action: string; id?: string }>();
let cleanupTimer: NodeJS.Timeout | null = null;

function scheduleDuplicateCleanup(table: string, action: string, id?: string) {
    pendingCleanup.set(`${table}:${action}:${id ?? '*'}`, { table, action, id });
    if (cleanupTimer) return;
    // Espera transações em andamento terminarem
    cleanupTimer = setTimeout(async () => {
        cleanupTimer = null;
        const items = [...pendingCleanup.values()];
        pendingCleanup.clear();
        // Janela folgada: o id do registro já identifica a alteração
        const since = new Date(Date.now() - 10 * 60_000);
        for (const it of items) {
            await client?.auditLog.deleteMany({
                where: {
                    source: 'database', entity: it.table, action: it.action === 'upsert' ? undefined : it.action,
                    createdAt: { gte: since }, ...(it.id ? { entityId: it.id } : {}),
                },
            }).catch(() => {});
        }
    }, 4000);
    cleanupTimer.unref?.();
}

// ============================ ERROS ============================

const originalConsoleError = console.error.bind(console);
const writeConsole = (...args: unknown[]) => originalConsoleError(...args);
const recentErrors = new Map<string, number>();

const describe = (args: unknown[]) => {
    const err = args.find((a) => a instanceof Error) as Error | undefined;
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    return { message: clip(text, 1000)!, stack: clip(err?.stack, 4000) ?? undefined };
};

/**
 * Todo console.error vira registro: dentro de uma requisição, fica guardado e é gravado quando a
 * resposta sai com erro 5xx (com rota e autor); fora dela (tarefas, inicialização), é gravado na hora.
 */
export function captureConsoleErrors() {
    console.error = (...args: unknown[]) => {
        writeConsole(...args);
        const info = describe(args);
        if (info.message.startsWith('[Audit]')) return;
        const ctx = requestContext.get();
        if (ctx) {
            ctx.error = info;
            return;
        }
        // Mesmo erro repetido em menos de 1 min grava uma vez só
        const key = info.message.slice(0, 200);
        const last = recentErrors.get(key) ?? 0;
        if (Date.now() - last < 60_000) return;
        recentErrors.set(key, Date.now());
        void audit.write({ level: 'error', source: 'api', action: 'error', summary: `Erro interno: ${info.message}`, changes: { stack: info.stack } });
    };
}

/** Grava o erro de uma resposta 5xx com o que foi capturado durante a requisição. */
export function recordRequestError(status: number) {
    const ctx = requestContext.get();
    if (!ctx) return;
    const msg = ctx.error?.message ?? `Resposta ${status}`;
    void audit.write({
        level: 'error', source: 'api', action: 'error', status,
        summary: `Erro ${status} em ${ctx.method} ${ctx.path}: ${msg}`,
        changes: ctx.error?.stack ? { stack: ctx.error.stack } : null,
    });
}

// ============================ REPOSITÓRIO (GitHub) ============================

type GitCommit = { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null };
type GitPull = { number: number; title: string; html_url: string; merged_at: string | null; user?: { login?: string } | null; merged_by?: { login?: string } | null };

async function github<T>(path: string): Promise<T | null> {
    try {
        const res = await fetch(`https://api.github.com${path}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 't3-api-audit', ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
            signal: AbortSignal.timeout(15_000),
        });
        return res.ok ? ((await res.json()) as T) : null;
    } catch {
        return null;
    }
}

/** Traz commits e PRs mesclados dos repositórios para o registro (sem duplicar). */
export async function syncRepositories() {
    if (!client) return;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (const repo of env.AUDIT_REPOSITORIES.split(',').map((r) => r.trim()).filter(Boolean)) {
        const name = repo.split('/')[1] ?? repo;
        const [commits, pulls] = await Promise.all([
            github<GitCommit[]>(`/repos/${repo}/commits?since=${since}&per_page=100`),
            github<GitPull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
        ]);
        for (const c of commits ?? []) {
            const title = c.commit.message.split('\n')[0];
            await audit.write({
                source: 'repository', action: 'commit', entity: name, entityId: c.sha.slice(0, 7),
                summary: `${name}: ${title}`, actorName: c.commit.author?.name ?? c.author?.login ?? null,
                changes: { url: c.html_url, message: clip(c.commit.message, 2000) },
                externalId: `commit:${repo}:${c.sha}`, createdAt: c.commit.author?.date ? new Date(c.commit.author.date) : undefined,
                method: null, path: null, ip: null, requestId: null,
            });
        }
        for (const p of (pulls ?? []).filter((x) => x.merged_at)) {
            await audit.write({
                source: 'repository', action: 'merge', entity: name, entityId: `#${p.number}`,
                summary: `${name}: PR #${p.number} mesclado · ${p.title}`, actorName: p.merged_by?.login ?? p.user?.login ?? null,
                changes: { url: p.html_url }, externalId: `pr:${repo}:${p.number}`, createdAt: new Date(p.merged_at!),
                method: null, path: null, ip: null, requestId: null,
            });
        }
    }
}

/** Mantém o registro enxuto: informações por 180 dias, avisos e erros por 1 ano. */
export async function pruneAuditLogs() {
    if (!client) return;
    const day = 86_400_000;
    await client.auditLog.deleteMany({ where: { level: 'info', createdAt: { lt: new Date(Date.now() - 180 * day) } } }).catch(() => {});
    await client.auditLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * day) } } }).catch(() => {});
}
