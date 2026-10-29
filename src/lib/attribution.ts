import { Prisma } from '@prisma/client';
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max).optional().nullable();

/**
 * Origem do lead, montada no navegador (UTM, referência e página de entrada).
 * Vai junto dos formulários; nada aqui identifica a pessoa.
 */
const touchSchema = z.object({
    source: text(80),
    medium: text(80),
    campaign: text(150),
    term: text(150),
    content: text(150),
    referrer: text(300),
    landingPage: text(300),
    at: text(40),
});

const attributionSchema = touchSchema.extend({
    /** Primeiro contato do visitante com o site (pode ser diferente da visita do lead). */
    first: touchSchema.optional().nullable(),
});

export type Attribution = z.infer<typeof attributionSchema>;

/** Lê a origem enviada pelo site. Dado inválido é descartado em silêncio: nunca impede o lead. */
export function readAttribution(value: unknown): Prisma.InputJsonValue | undefined {
    const parsed = attributionSchema.safeParse(value);
    if (!parsed.success || !parsed.data.source) return undefined;
    return parsed.data as Prisma.InputJsonValue;
}

/** Separa a origem do resto do corpo (alguns validadores recusam campos desconhecidos). */
export function splitAttribution<T extends Record<string, unknown>>(body: T | undefined) {
    const { attribution, ...rest } = (body ?? {}) as T & { attribution?: unknown };
    return { attribution: readAttribution(attribution), body: rest };
}
