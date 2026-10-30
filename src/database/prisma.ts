import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { audit, AUDIT_SKIP_MODELS } from '../services/audit.service';

const connectionString = env.DATABASE_URL;

// O SEGREDO ESTÁ AQUI 👇
// Adicionamos a configuração de SSL. Sem isso, o Supabase fecha a porta e dá ECONNREFUSED.
const pool = new Pool({
    connectionString,
    ssl: env.DATABASE_SSL === 'false' ? false : {
        rejectUnauthorized: false
    },
    // Mantém as conexões abertas entre visitas: abrir uma nova (TLS até o Supabase) custava segundos
    keepAlive: true,
    idleTimeoutMillis: 5 * 60_000,
    connectionTimeoutMillis: 10_000,
    // Identifica a API para o gatilho de auditoria do banco (ele só registra o que vem de fora)
    application_name: 't3-api',
});

const adapter = new PrismaPg(pool);
const globalForPrisma = global as unknown as { prismaBase: PrismaClient };

// Cliente sem extensão: usado pelo próprio registro de auditoria
const base = globalForPrisma.prismaBase || new PrismaClient({ adapter });
if (env.NODE_ENV !== 'production') globalForPrisma.prismaBase = base;
audit.init(base);

const SINGLE_WRITES = new Set(['create', 'update', 'upsert', 'delete']);
const BULK_WRITES = new Set(['createMany', 'createManyAndReturn', 'updateMany', 'updateManyAndReturn', 'deleteMany']);

const delegate = (model: string) => (base as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

/**
 * Toda alteração feita pelo sistema entra no registro de auditoria com autor, antes e depois.
 * A gravação do registro não bloqueia nem derruba a operação.
 */
export const prisma = base.$extends({
    name: 'audit',
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (AUDIT_SKIP_MODELS.has(model) || (!SINGLE_WRITES.has(operation) && !BULK_WRITES.has(operation))) {
                    return query(args);
                }

                const where = (args as { where?: unknown }).where;
                const before = where && (operation === 'update' || operation === 'delete' || operation === 'upsert')
                    ? await delegate(model)?.findUnique({ where }).catch(() => null)
                    : null;

                const result = await query(args);

                if (SINGLE_WRITES.has(operation)) {
                    const op = operation === 'upsert' ? (before ? 'update' : 'create') : operation;
                    void audit.recordChange(model, op, before, operation === 'delete' ? null : result);
                } else {
                    const count = Array.isArray(result) ? result.length : (result as { count?: number })?.count ?? 0;
                    if (count > 0) void audit.recordChange(model, operation, null, where ?? null, count);
                }
                return result;
            },
        },
    },
});

export type AppPrismaClient = typeof prisma;
