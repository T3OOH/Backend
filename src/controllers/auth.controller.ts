import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { prisma } from '../database/prisma';
import { env } from '../config/env';
import { loginSchema, registerSchema } from '../validators/auth.validator';

function toPublicUser(user: {
    id: string;
    name: string;
    email: string;
    role: Role;
}) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
    };
}

export const authController = {
    async login(req: Request, res: Response) {
        const { email, password } = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            { role: user.role },
            env.JWT_SECRET,
            {
                algorithm: 'HS256',
                subject: user.id,
                expiresIn: '1h',
            },
        );

        return res.json({
            user: toPublicUser(user),
            token,
        });
    },

    async register(req: Request, res: Response) {
        const { name, email, password } = registerSchema.parse(req.body);

        try {
            const user = await prisma.user.create({
                data: {
                    name,
                    email,
                    password: await bcrypt.hash(password, 12),
                    role: Role.USER,
                },
            });

            return res.status(201).json({
                message: 'Conta criada com sucesso.',
                user: toPublicUser(user),
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                return res.status(409).json({ error: 'Este e-mail já está em uso.' });
            }

            throw error;
        }
    },
};