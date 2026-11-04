import { Request, Response } from 'express';

import { z } from 'zod';
import { prisma } from '../database/prisma';
import { isRecordNotFound } from '../lib/prismaErrors';

const portfolioImageSchema = z.object({
    url: z.string({ error: 'A URL da imagem é obrigatória.' }).trim().min(1, 'A URL da imagem é obrigatória.').url('A URL da imagem é inválida.').max(1000),
    alt: z.string().trim().max(200).optional().nullable(),
}).strict();

export const solutionController = {

    // Buscar todas as imagens ativas
    async getPortfolio(req: Request, res: Response) {
        try {
            const images = await prisma.solutionPortfolio.findMany({
                where: { isActive: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.status(200).json(images);
        } catch (error) {
            console.error('Erro ao buscar portfólio:', error);
            return res.status(500).json({ error: 'Erro interno ao buscar imagens.' });
        }
    },

    // Adicionar uma nova imagem ao portfólio
    async addPortfolioImage(req: Request, res: Response) {
        try {
            const parsed = portfolioImageSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.', details: parsed.error.issues });
            }
            const { url, alt } = parsed.data;

            const newImage = await prisma.solutionPortfolio.create({
                data: {
                    url,
                    alt: alt || 'T3 Solution'
                }
            });

            return res.status(201).json(newImage);
        } catch (error) {
            console.error('Erro ao salvar imagem no portfólio:', error);
            return res.status(500).json({ error: 'Erro interno ao salvar a imagem.' });
        }
    },

    // Remover uma imagem (deleta permanentemente do banco)
    async deletePortfolioImage(req: Request, res: Response) {
        try {
            const id = req.params.id as string;

            await prisma.solutionPortfolio.delete({
                where: { id }
            });

            return res.status(204).send();
        } catch (error) {
            if (isRecordNotFound(error)) return res.status(404).json({ error: 'Imagem não encontrada.' });
            console.error('Erro ao excluir imagem:', error);
            return res.status(500).json({ error: 'Erro interno ao remover a imagem.' });
        }
    }
};