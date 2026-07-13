"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Formato de e-mail inválido"),
    password: zod_1.z.string().min(6, "A senha deve ter no mínimo 6 caracteres")
});
exports.registerSchema = exports.loginSchema.extend({
    name: zod_1.z.string().min(2, "O nome deve ter no mínimo 2 caracteres")
});
