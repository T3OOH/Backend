import { z } from 'zod';

export const contactSchema = z.object({
    name: z.string().trim().min(2).max(120),
    company: z.string().trim().max(120).optional(),
    phone: z.string().trim().min(8).max(30),
    email: z.string().trim().toLowerCase().email(),
    message: z.string().trim().min(10).max(3000),
}).strict();
