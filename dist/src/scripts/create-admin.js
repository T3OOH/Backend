"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
require("../config/env");
const prisma_1 = require("../database/prisma");
const input = zod_1.z.object({
    ADMIN_NAME: zod_1.z.string().trim().min(2),
    ADMIN_EMAIL: zod_1.z.string().trim().toLowerCase().email(),
    ADMIN_PASSWORD: zod_1.z.string().min(12),
}).parse(process.env);
async function main() {
    const existingUser = await prisma_1.prisma.user.findUnique({
        where: { email: input.ADMIN_EMAIL },
    });
    if (existingUser) {
        throw new Error('Já existe um usuário com este e-mail.');
    }
    await prisma_1.prisma.user.create({
        data: {
            name: input.ADMIN_NAME,
            email: input.ADMIN_EMAIL,
            password: await bcryptjs_1.default.hash(input.ADMIN_PASSWORD, 12),
            role: client_1.Role.ADMIN,
        },
    });
    console.log('Administrador criado com sucesso.');
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
