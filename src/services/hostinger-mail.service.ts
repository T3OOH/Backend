import { randomInt } from 'node:crypto';
import { env } from '../config/env';

/*
 * Caixas de e-mail da equipe na Hostinger (@t3led.com.br).
 * API: https://developers.hostinger.com (Bearer token). Endpoints usados:
 *   GET  /api/mail/v1/orders                       → acha o pedido de e-mail do domínio
 *   GET  /api/mail/v1/orders/{orderId}/mailboxes   → lista as caixas
 *   POST /api/mail/v1/orders/{orderId}/mailboxes   → cria { local_part, password }
 */
const API = 'https://developers.hostinger.com/api/mail/v1';
const TIMEOUT_MS = 15_000;

export const hostingerMailEnabled = () => Boolean(env.HOSTINGER_API_TOKEN);

export class HostingerMailError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
    }
}

export interface Mailbox {
    id: string;
    address: string;
    status: 'active' | 'suspended';
    createdAt: string | null;
}

interface ApiError {
    message?: string;
    errors?: Record<string, string[]>;
    correlation_id?: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!env.HOSTINGER_API_TOKEN) throw new HostingerMailError('Criação de e-mails não configurada no servidor.', 503, 'MAIL_DISABLED');
    let res: Response;
    try {
        res = await fetch(`${API}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${env.HOSTINGER_API_TOKEN}`,
                Accept: 'application/json',
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        console.error('[hostinger-mail] Falha de rede:', error);
        throw new HostingerMailError('A Hostinger não respondeu. Tente de novo em instantes.', 502, 'MAIL_UPSTREAM');
    }
    if (res.ok) return (await res.json()) as T;

    const body = (await res.json().catch(() => ({}))) as ApiError;
    console.error(`[hostinger-mail] ${init.method ?? 'GET'} ${path} → ${res.status}`, body.message, body.correlation_id);
    if (res.status === 409) throw new HostingerMailError('Já existe uma caixa com esse endereço.', 409, 'MAILBOX_EXISTS');
    if (res.status === 422) {
        const first = Object.values(body.errors ?? {})[0]?.[0] ?? body.message ?? 'Dados recusados pela Hostinger.';
        throw new HostingerMailError(first, 422, 'MAIL_INVALID');
    }
    if (res.status === 429) throw new HostingerMailError('Muitas requisições à Hostinger. Aguarde um minuto.', 429, 'MAIL_RATE_LIMIT');
    if (res.status === 401) throw new HostingerMailError('Token da Hostinger inválido ou expirado.', 502, 'MAIL_TOKEN');
    throw new HostingerMailError('A Hostinger recusou o pedido. Tente de novo em instantes.', 502, 'MAIL_UPSTREAM');
}

let cachedOrderId: string | null = null;

/** ID do pedido de e-mail do domínio (variável de ambiente ou descoberto pela API e guardado em memória). */
async function orderId(): Promise<string> {
    if (env.HOSTINGER_MAIL_ORDER_ID) return env.HOSTINGER_MAIL_ORDER_ID;
    if (cachedOrderId) return cachedOrderId;
    const { data } = await call<{ data: { id: string; status: string; domain: { name: string } | null }[] }>('/orders?per_page=50');
    const order = data.find((o) => o.domain?.name === env.MAIL_DOMAIN && o.status === 'active')
        ?? data.find((o) => o.domain?.name === env.MAIL_DOMAIN);
    if (!order) throw new HostingerMailError(`Nenhum plano de e-mail da Hostinger para ${env.MAIL_DOMAIN}.`, 503, 'MAIL_NO_ORDER');
    cachedOrderId = order.id;
    return order.id;
}

interface RawMailbox { id: string; address: string; status: 'active' | 'suspended'; created_at?: string | null }
const toMailbox = (m: RawMailbox): Mailbox => ({ id: m.id, address: m.address, status: m.status, createdAt: m.created_at ?? null });

export async function listMailboxes(): Promise<Mailbox[]> {
    const id = await orderId();
    const all: Mailbox[] = [];
    for (let page = 1; page <= 20; page++) {
        const res = await call<{ data: RawMailbox[]; meta?: { last_page?: number; current_page?: number } }>(
            `/orders/${encodeURIComponent(id)}/mailboxes?per_page=100&page=${page}`,
        );
        all.push(...res.data.map(toMailbox));
        if (!res.meta?.last_page || page >= res.meta.last_page) break;
    }
    return all;
}

export async function createMailbox(localPart: string, password: string): Promise<Mailbox> {
    const id = await orderId();
    const res = await call<RawMailbox | { data: RawMailbox }>(`/orders/${encodeURIComponent(id)}/mailboxes`, {
        method: 'POST',
        body: JSON.stringify({ local_part: localPart, password }),
    });
    return toMailbox('data' in res ? res.data : res);
}

// ============================ REGRAS ============================

/** Mesma regra da Hostinger para a parte antes do @. */
export const LOCAL_PART_RE = /^(?=[a-z0-9])(?=.*[a-z0-9]$)[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/**
 * Nome da pessoa ou área → parte antes do @.
 * "João da Silva" → "joao.silva" (primeiro e último nome); "Financeiro" → "financeiro".
 */
export function localPartFromName(name: string): string {
    const words = name
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s._-]/g, ' ')
        .split(/[\s._-]+/)
        .filter((w) => w && !CONNECTORS.has(w));
    const parts = words.length > 2 ? [words[0], words[words.length - 1]] : words;
    return parts.join('.').slice(0, 50).replace(/[._-]+$/, '');
}

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Senha inicial aleatória e diferente para cada caixa, no formato "T3led@xxxxxxxx":
 * maiúscula, minúscula, número e símbolo garantidos pelo prefixo, mais 8 caracteres
 * aleatórios (sem 0/O, 1/l/I para não confundir quem digita).
 */
export function temporaryPassword(): string {
    let rest = '';
    for (let i = 0; i < 8; i++) rest += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
    return `T3led@${rest}`;
}
