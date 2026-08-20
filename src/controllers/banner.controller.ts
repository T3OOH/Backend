import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { z, ZodError } from 'zod';

const createBannerSchema = z.object({
    title: z.string().optional(),
    imageUrl: z.string().min(1, 'A URL da imagem é obrigatória.'),
    linkUrl: z.string().optional(),
    order: z.number().int().optional().default(0),
    isActive: z.boolean().optional().default(true),
});

export const bannerController = {
    async listActive(req: Request, res: Response) {
        try {
            const banners = await prisma.banner.findMany({
                where: { isActive: true },
                orderBy: { order: 'asc' }
            });
            return res.json(banners);
        } catch (error) {
            console.error('[Banner] Erro ao listar:', error);
            return res.status(500).json({ error: 'Erro interno ao listar banners.' });
        }
    },

    async listAll(req: Request, res: Response) {
        try {
            const banners = await prisma.banner.findMany({
                orderBy: { order: 'asc' }
            });
            return res.json(banners);
        } catch (error) {
            console.error('[Banner] Erro ao listar todos:', error);
            return res.status(500).json({ error: 'Erro interno.' });
        }
    },

    async create(req: Request, res: Response) {
        try {
            const data = createBannerSchema.parse(req.body);
            
            // Forçando explicitamente as tipagens para o Prisma
            const titleStr = data.title ? String(data.title) : null;
            const imageUrlStr = String(data.imageUrl);
            const linkUrlStr = data.linkUrl ? String(data.linkUrl) : null;
            const orderNum = Number(data.order) || 0;
            const isActiveBool = Boolean(data.isActive);

            const newBanner = await prisma.banner.create({
                data: {
                    title: titleStr,
                    imageUrl: imageUrlStr,
                    linkUrl: linkUrlStr,
                    order: orderNum,
                    isActive: isActiveBool
                }
            });
            
            return res.status(201).json(newBanner);
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json({ error: 'Dados inválidos.', details: error.issues });
            }
            return res.status(500).json({ error: 'Erro interno ao criar banner.' });
        }
    },

    async delete(req: Request, res: Response) {
        try {
            // Assegurando que o ID será uma string estrita para evitar o erro "string | string[]"
            const rawId = req.params.id;
            const id = Array.isArray(rawId) ? String(rawId[0]) : String(rawId);

            await prisma.banner.delete({ 
                where: { id } 
            });
            
            return res.status(204).send();
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao deletar banner.' });
        }
    }
};