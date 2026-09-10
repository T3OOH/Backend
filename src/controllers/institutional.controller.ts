import { Request, Response } from 'express';
import { prisma } from '../database/prisma'; // Confirme se o caminho do seu prisma client é este

export class InstitutionalController {
    // Retorna os dados para a Home e para o Dashboard
    async get(req: Request, res: Response) {
        try {
            let data = await prisma.institutional.findUnique({
                where: { id: 'global' }
            });

            // Se for a primeira vez rodando e não tiver nada no banco, retorna um objeto limpo
            if (!data) {
                data = { id: 'global', team: [], brands: [], updatedAt: new Date() } as any;
            }

            return res.json(data);
        } catch (error) {
            console.error("Erro ao buscar dados institucionais:", error);
            return res.status(500).json({ error: "Erro interno ao buscar os dados." });
        }
    }

    // Salva ou atualiza os dados enviados pelo DashboardInfo.tsx
    async update(req: Request, res: Response) {
        try {
            const { team, brands } = req.body;

            // O upsert atualiza se já existir o id 'global', ou cria se for a primeira vez
            const data = await prisma.institutional.upsert({
                where: { id: 'global' },
                update: { team, brands },
                create: { id: 'global', team, brands }
            });

            return res.json(data);
        } catch (error) {
            console.error("Erro ao atualizar dados institucionais:", error);
            return res.status(500).json({ error: "Erro interno ao atualizar os dados." });
        }
    }
}