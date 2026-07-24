import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export const profileController = {
    async getProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, email: true, phone: true, company: true, role: true, createdAt: true }
            });
            return res.json(user);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar perfil' });
        }
    },

    async updateProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { name, phone, company } = req.body;

            const user = await prisma.user.update({
                where: { id: userId },
                data: { name, phone, company },
                select: { id: true, name: true, email: true, phone: true, company: true, role: true }
            });

            return res.json(user);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao atualizar perfil' });
        }
    },

    async getMyOrders(req: Request, res: Response) {
        try {
            const userEmail = (req as any).user.email;
            
            // Busca os tickets de CRM (Orçamentos do Mapa) atrelados ao email deste usuário
            const deals = await prisma.crmDeal.findMany({
                where: { 
                    client: { email: userEmail } 
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