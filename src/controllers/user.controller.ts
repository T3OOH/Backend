import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../database/prisma';

export const userController = {
    async index(req: Request, res: Response) {
        try {
            const users = await prisma.user.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
                orderBy: {
                    name: 'asc',
                },
            });

            return res.status(200).json(users);
        } catch (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ error: 'Erro interno ao processar a requisição.' });
        }
    },

    async updateRole(req: Request<{ id: string }>, res: Response) {
        const { id } = req.params;
        const { role } = req.body;

        // Validacao estrita baseada no enum do Prisma
        if (!Object.values(Role).includes(role as Role)) {
            return res.status(400).json({ error: 'Nível de acesso inválido.' });
        }

        try {
            const updatedUser = await prisma.user.update({
                where: { id: String(id) },
                data: { role: role as Role },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
            });

            return res.status(200).json(updatedUser);
        } catch (error) {
            console.error('Error updating user role:', error);
            return res.status(500).json({ error: 'Erro interno ao atualizar nível de acesso.' });
        }
    },
};