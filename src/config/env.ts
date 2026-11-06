import 'dotenv/config';
import { z } from 'zod';

const source = {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY,
};

// Servidores STUN/TURN das reuniões: JSON com uma lista de RTCIceServer
const iceServersSchema = z.array(z.object({
    urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    username: z.string().optional(),
    credential: z.string().optional(),
}).strict()).min(1);

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),

    DATABASE_URL: z.string().url(),
    // Banco local sem SSL (desenvolvimento e testes); em produção fica ligado
    DATABASE_SSL: z.enum(['true', 'false']).default('true'),
    // Conexões simultâneas da API com o banco (o padrão do pg era 10)
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres.'),

    // No servidor (Render define RENDER=true) o padrão é o site oficial: o link do e-mail de senha usa este endereço
    FRONTEND_URL: z.string().url().default(
        process.env.RENDER || process.env.NODE_ENV === 'production' ? 'https://t3led.com.br' : 'http://localhost:3000',
    ),
    CORS_ORIGINS: z.string().optional(),

    // ID do cliente OAuth do Google (o mesmo do frontend); sem ele o login com Google fica desligado
    GOOGLE_CLIENT_ID: z.string().optional(),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_BUCKET: z.string().min(1).default('panels'),

    // Opcional: token do GitHub só aumenta o limite de consultas do registro do repositório
    GITHUB_TOKEN: z.string().optional(),
    // Repositórios acompanhados no registro (dono/nome, separados por vírgula)
    AUDIT_REPOSITORIES: z.string().default('T3OOH/Backend,T3OOH/Frontend'),
    // App desktop da equipe: releases (privadas) deste repositório; o download usa o GITHUB_TOKEN
    // Opcional: servidores ICE (STUN/TURN) das reuniões, em JSON. Sem ele usa o STUN público do Google
    MEETING_ICE_SERVERS: z.string().optional().transform((value, ctx) => {
        if (!value || !value.trim()) return undefined;
        try {
            const parsed = iceServersSchema.safeParse(JSON.parse(value));
            if (parsed.success) return parsed.data;
        } catch { /* cai no erro abaixo */ }
        ctx.addIssue({ code: 'custom', message: 'MEETING_ICE_SERVERS deve ser um JSON com a lista de servidores ICE (urls, username, credential).' });
        return z.NEVER;
    }),
    DESKTOP_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('T3OOH/AppT3'),
    // Caixas de e-mail da equipe (Hostinger). Sem o token, a criação de contas fica desligada.
    // Token: hPanel → Perfil → API. O pedido de e-mail é achado pelo domínio quando o ID não vem.
    HOSTINGER_API_TOKEN: z.string().min(10).optional(),
    HOSTINGER_MAIL_ORDER_ID: z.string().optional(),
    MAIL_DOMAIN: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).default('t3led.com.br'),
    // T3 Launcher: senha da área de download do site (só no servidor, nunca no frontend).
    // Sem ela, o download do launcher fica desligado
    LAUNCHER_DOWNLOAD_PASSWORD: z.string().min(6).optional(),
    // IA T3 (balão de dúvidas): sem a chave, o balão funciona só com respostas prontas e encaminhamento
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    // Pedidos técnicos do balão vão para este e-mail (sem ele, para os administradores)
    SUPORTE_TECNICO_EMAIL: z.string().email().optional(),
    // Release do GitHub (tag) com o zip do launcher, separada das versões do T3 Gestor
    LAUNCHER_RELEASE_TAG: z.string().regex(/^[\w.-]+$/).default('launcher'),
});

const result = envSchema.safeParse(source);

if (!result.success) {
    console.error('Variáveis de ambiente inválidas:', result.error.format());
    throw new Error('Configuração de ambiente inválida.');
}

export const env = result.data;

/**
 * Origens autorizadas para CORS (API e WebSocket).
 * Domínios extras podem ser informados em CORS_ORIGINS, separados por vírgula.
 */
const allowedOrigins = new Set(
    [
        env.FRONTEND_URL,
        'https://t3led.com.br',
        'https://www.t3led.com.br',
        'https://t3ooh.com',
        'https://www.t3ooh.com',
        ...(env.CORS_ORIGINS?.split(',') ?? []),
        ...(env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:5173'] : []),
    ]
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean),
);

export function isAllowedOrigin(origin: string) {
    return allowedOrigins.has(origin.replace(/\/$/, ''));
}
