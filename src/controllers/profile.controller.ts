import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';

const profileSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    companyName: true,
    role: true,
    createdAt: true,
} as const;

const updateProfileSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).optional().nullable(),
    // Aceita "companyName" e o nome legado "company"
    companyName: z.string().trim().max(120).optional().nullable(),
    company: z.string().trim().max(120).optional().nullable(),
});

export const profileController = {
    async getProfile(req: Request, res: Response) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                select: profileSelect
            });
            return res.json(user);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar perfil' });
        }
    },

    async updateProfile(req: Request, res: Response) {
        const parsed = updateProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.issues });
        }
        const { name, phone, companyName, company } = parsed.data;

        try {
            const user = await prisma.user.update({
                where: { id: req.user!.id },
                data: { name, phone, companyName: companyName ?? company },
                select: profileSelect
            });

            return res.json(user);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao atualizar perfil' });
        }
    },

    async getMyOrders(req: Request, res: Response) {
        try {
            // O e-mail vem do banco: o token carrega apenas id e perfil
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                select: { email: true }
            });

            if (!user?.email) {
                return res.json([]);
            }

            // Busca os tickets de CRM (Orçamentos do Mapa) atrelados ao email deste usuário
            const deals = await prisma.crmDeal.findMany({
                where: {
                    client: { email: { equals: user.email, mode: 'insensitive' } }
                },
                include: {
                    items: { include: { panel: true } }
                },
                orderBy: { createdAt: 'desc' }
            });

            return res.json(deals);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar orçamentos' });
        }
    }
};
