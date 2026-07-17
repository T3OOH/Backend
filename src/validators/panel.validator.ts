import { PanelStatus } from '@prisma/client';
import { z } from 'zod';

export const createPanelSchema = z.object({
    name: z.string().trim().min(1, 'O nome é obrigatório.').max(160),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    size: z.string().trim().min(1, 'O tamanho é obrigatório.').max(80),
    px: z.string().trim().min(1, 'A resolução é obrigatória.').max(80),
    impacts: z.string().trim().min(1, 'Os impactos são obrigatórios.').max(80),
    price: z.number().nonnegative('O valor não pode ser negativo').optional(),
    status: z.nativeEnum(PanelStatus).default(PanelStatus.AVAILABLE),
    description: z.string().trim().max(3000).optional(),
    address: z.string().trim().max(250).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    categoryId: z.string().uuid().optional(),
    images: z.array(z.string().url()).max(8).default([]),
}).strict();

export const updatePanelSchema = createPanelSchema
    .partial()
    .extend({
        status: z.nativeEnum(PanelStatus).optional(),
    })
    .strict();