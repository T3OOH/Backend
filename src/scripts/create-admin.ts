import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import '../config/env';
import { prisma } from '../database/prisma';

const input = z.object({
    ADMIN_NAME: z.string().trim().min(2),
    ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
    ADMIN_PASSWORD: z.string().min(12),
}).parse(process.env);

async function main() {
    const existingUser = await prisma.user.findUnique({
        where: { email: input.ADMIN_EMAIL },
    });

    if (existingUser) {
        throw new Error('Já existe um usuário com este e-mail.');
    }

    await prisma.user.create({
        data: {
            name: input.ADMIN_NAME,
            email: input.ADMIN_EMAIL,
            password: await bcrypt.hash(input.ADMIN_PASSWORD, 12),
            role: Role.ADMIN,
        },
    });

    console.log('Administrador criado com sucesso.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
