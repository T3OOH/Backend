"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const email = zod_1.z.string().trim().toLowerCase().email('E-mail inválido');
exports.loginSchema = zod_1.z.object({
    email,
    password: zod_1.z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
}).strict();
exports.registerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    email,
    password: zod_1.z.string().min(8).max(128),
}).strict();
