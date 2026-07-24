import { Router, Request, Response } from 'express';
import { prisma } from '../database/prisma'; // Ajuste o caminho do prisma

const couponRoutes = Router();

// 1. Listar todos os cupons
couponRoutes.get('/', async (req: Request, res: Response) => {
    try {
        const coupons = await prisma.crmCoupon.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                creator: {
                    select: { name: true } // Traz o nome de quem criou
                },
                usedBy: {
                    select: { name: true } // Traz o nome do cliente que usou (se houver)
                }
            }
        });
        res.json(coupons);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar cupons' });
    }
});

// 2. Criar um novo cupom
couponRoutes.post('/', async (req: Request, res: Response) => {
    const { code, discountType, value, minValue, validUntil, singleUse, creatorId } = req.body;

    try {
        // Verifica se o código já existe
        const existing = await prisma.crmCoupon.findUnique({ where: { code } });
        if (existing) {
            return res.status(400).json({ error: 'Este código de cupom já existe.' });
        }

        const coupon = await prisma.crmCoupon.create({
            data: {
                code: code.toUpperCase(),
                discountType,
                value: Number(value),
                minValue: minValue ? Number(minValue) : null,
                validUntil: validUntil ? new Date(validUntil) : null,
                singleUse: Boolean(singleUse),
                creatorId
            }
        });

        res.status(201).json(coupon);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar cupom' });
    }
});

// 3. Excluir cupom
couponRoutes.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    
    try {
        await prisma.crmCoupon.delete({
            where: { id }
        });
        res.json({ message: 'Cupom excluído com sucesso' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir cupom' });
    }
});

export { couponRoutes };