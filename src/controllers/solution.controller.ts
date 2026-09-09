import { Request, Response } from 'express';

// ✅ Importando a instância correta do Prisma do seu projeto
import { prisma } from '../database/prisma';

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
            const { url, alt } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'A URL da imagem é obrigatória.' });
            }

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

            return res.status(200).json({ message: 'Imagem removida com sucesso.' });
        } catch (error) {
            console.error('Erro ao deletar imagem:', error);
            return res.status(500).json({ error: 'Erro ao remover imagem ou imagem não encontrada.' });
        }
    }
};