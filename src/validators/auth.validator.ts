import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('E-mail inválido');

export const loginSchema = z.object({
    email,
    password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
}).strict();

export const registerSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email,
    password: z.string().min(8).max(128),
}).strict();