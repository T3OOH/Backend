import { Router, Request, Response } from 'express';
import { DiscountType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

const couponRoutes = Router();

couponRoutes.use(authMiddleware, requireRoles(...STAFF_ROLES));

const createCouponSchema = z.object({
    code: z.string().trim().min(3).max(50),
    discountType: z.nativeEnum(DiscountType),
    value: z.coerce.number().positive(),
    minValue: z.union([z.coerce.number().min(0), z.literal('')]).optional().nullable(),
    validUntil: z.string().optional().nullable(),
    singleUse: z.boolean().optional(),
}).refine(
    (data) => data.discountType !== DiscountType.PERCENTAGE || data.value <= 100,
    { message: 'Desconto percentual deve ser no máximo 100%.', path: ['value'] },
);

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

// 2. Criar um novo cupom (o criador é sempre o usuário autenticado)
couponRoutes.post('/', async (req: Request, res: Response) => {
    const parsed = createCouponSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.issues });
    }
    const { code, discountType, value, minValue, validUntil, singleUse } = parsed.data;

    try {
        const normalizedCode = code.toUpperCase();

        // Verifica se o código já existe
        const existing = await prisma.crmCoupon.findUnique({ where: { code: normalizedCode } });
        if (existing) {
            return res.status(400).json({ error: 'Este código de cupom já existe.' });
        }

        const coupon = await prisma.crmCoupon.create({
            data: {
                code: normalizedCode,
                discountType,
                value,
                minValue: minValue === '' || minValue == null ? null : Number(minValue),
                validUntil: validUntil ? new Date(validUntil) : null,
                singleUse: Boolean(singleUse),
                creatorId: req.user!.id
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
