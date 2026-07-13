"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const prisma_1 = require("../database/prisma");
class UserRepository {
    async findByEmail(email) {
        return prisma_1.prisma.user.findUnique({ where: { email } });
    }
    async create(data) {
        return prisma_1.prisma.user.create({ data });
    }
}
exports.UserRepository = UserRepository;
