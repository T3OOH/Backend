"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePanelSchema = exports.createPanelSchema = void 0;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
exports.createPanelSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'O nome é obrigatório.').max(160),
    lat: zod_1.z.number().gte(-90).lte(90),
    lng: zod_1.z.number().gte(-180).lte(180),
    size: zod_1.z.string().trim().min(1, 'O tamanho é obrigatório.').max(80),
    px: zod_1.z.string().trim().min(1, 'A resolução é obrigatória.').max(80),
    impacts: zod_1.z.string().trim().min(1, 'Os impactos são obrigatórios.').max(80),
    price: zod_1.z.number().nonnegative('O valor não pode ser negativo').optional(),
    status: zod_1.z.nativeEnum(client_1.PanelStatus).default(client_1.PanelStatus.AVAILABLE),
    description: zod_1.z.string().trim().max(3000).optional(),
    address: zod_1.z.string().trim().max(250).optional(),
    city: zod_1.z.string().trim().max(100).optional(),
    state: zod_1.z.string().trim().max(100).optional(),
    categoryId: zod_1.z.string().uuid().optional(),
    images: zod_1.z.array(zod_1.z.string().url()).max(8).default([]),
}).strict();
exports.updatePanelSchema = exports.createPanelSchema
    .partial()
    .extend({
    status: zod_1.z.nativeEnum(client_1.PanelStatus).optional(),
})
    .strict();
