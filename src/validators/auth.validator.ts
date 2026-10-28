import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('E-mail inválido');

export const loginSchema = z.object({
    email,
    password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
}).strict();

export const registerSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email,
    password: z.string()
        .min(8, 'A senha deve ter ao menos 8 caracteres.')
        .max(128)
        .regex(/[A-Z]/, 'A senha deve ter ao menos uma letra maiúscula.')
        .regex(/\d/,'A senha deve ter ao menos um número.'),
    phone: z.string().trim().max(30).optional(),
    document: z.string().trim().max(30).optional(),
    personType: z.enum(['PF', 'PJ']).optional(),
    companyName: z.string().trim().max(120).optional(),
}).strict();