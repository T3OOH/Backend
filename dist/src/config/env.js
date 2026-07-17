"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const source = {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY,
};
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3333),
    DATABASE_URL: zod_1.z.string().url(),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres.'),
    FRONTEND_URL: zod_1.z.string().url().default('http://localhost:3000'),
    SUPABASE_URL: zod_1.z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().min(1),
    SUPABASE_BUCKET: zod_1.z.string().min(1).default('panels'),
});
const result = envSchema.safeParse(source);
if (!result.success) {
    console.error('Variáveis de ambiente inválidas:', result.error.format());
    throw new Error('Configuração de ambiente inválida.');
}
exports.env = result.data;
