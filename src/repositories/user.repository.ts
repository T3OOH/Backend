import { prisma } from '../database/prisma';
import { Prisma, User } from '@prisma/client';

export class UserRepository {
    async findByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({ where: { email } });
    }

    async create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
        return prisma.user.create({ data });
    }
}