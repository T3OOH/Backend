"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePanelSchema = exports.createPanelSchema = void 0;
const zod_1 = require("zod");
exports.createPanelSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "O nome é obrigatório"),
    lat: zod_1.z.number(),
    lng: zod_1.z.number(),
    size: zod_1.z.string().min(1, "O tamanho é obrigatório"),
    px: zod_1.z.string().min(1, "A resolução é obrigatória"),
    impacts: zod_1.z.string().min(1, "Os impactos são obrigatórios"),
    status: zod_1.z.string().optional().default("Disponível"),
    description: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    categoryId: zod_1.z.string().optional(),
    images: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.updatePanelSchema = exports.createPanelSchema.partial();
