import 'dotenv/config';
import { z } from 'zod';

const source = {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY,
};

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),

    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres.'),

    // No servidor (Render define RENDER=true) o padrão é o site oficial: o link do e-mail de senha usa este endereço
    FRONTEND_URL: z.string().url().default(
        process.env.RENDER || process.env.NODE_ENV === 'production' ? 'https://t3ooh.com' : 'http://localhost:3000',
    ),
    CORS_ORIGINS: z.string().optional(),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_BUCKET: z.string().min(1).default('panels'),
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
