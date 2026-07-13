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

    FRONTEND_URL: z.string().url().default('http://localhost:3000'),

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
