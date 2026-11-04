import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';

const listId = z.union([z.string().max(64), z.number()]).optional().nullable();
const imageUrl = z.string().trim().max(1000).optional().nullable();

/** Página "Sobre": equipe e marcas atendidas. Campos fora da lista são descartados. */
const institutionalSchema = z.object({
    team: z.array(z.object({
        id: listId,
        name: z.string({ error: 'Informe o nome de cada pessoa da equipe.' }).trim().min(1, 'Informe o nome de cada pessoa da equipe.').max(120),
        role: z.string({ error: 'Informe o cargo de cada pessoa da equipe.' }).trim().min(1, 'Informe o cargo de cada pessoa da equipe.').max(120),
        bio: z.string().trim().max(2000).optional().default(''),
        image: imageUrl,
    }), { error: 'Envie a equipe como lista.' }).max(50, 'A equipe aceita até 50 pessoas.'),
    brands: z.array(z.object({
        id: listId,
        name: z.string().trim().max(120).optional().default(''),
        logo: imageUrl,
    }), { error: 'Envie as marcas como lista.' }).max(200, 'Até 200 marcas.'),
});

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
            const parsed = institutionalSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.', details: parsed.error.issues });
            }
            const { team, brands } = parsed.data;

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