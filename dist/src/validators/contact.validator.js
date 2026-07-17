"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactSchema = void 0;
const zod_1 = require("zod");
exports.contactSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    company: zod_1.z.string().trim().max(120).optional(),
    phone: zod_1.z.string().trim().min(8).max(30),
    email: zod_1.z.string().trim().toLowerCase().email(),
    message: zod_1.z.string().trim().min(10).max(3000),
}).strict();
