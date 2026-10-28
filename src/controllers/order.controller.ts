import { Request, Response } from 'express';
import { OrderStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { calculateQuote } from '../services/pricing.service';

// O carrinho envia apenas o que o cliente escolheu; valores são calculados no servidor
const createOrderSchema = z.object({
    months: z.coerce.number().int().min(1).max(36),
    couponCode: z.string().trim().max(50).optional().nullable(),
    startDate: z.string().datetime().optional(),
    notes: z.string().max(5000).optional(),
    items: z.array(z.object({
        panelId: z.string().uuid(),
    })).min(1, "O pedido deve ter pelo menos um painel.")
});

const orderInclude = {
    user: { select: { name: true, email: true, phone: true, companyName: true } },
    seller: { select: { id: true, name: true } },
    items: {
        include: {
            panel: { select: { id: true, name: true, city: true, state: true, images: true, price: true } }
        }
    }
} as const;

export const orderController = {
    async create(req: Request, res: Response) {
        try {
            const data = createOrderSchema.parse(req.body);
            const quote = await calculateQuote({
                panelIds: data.items.map((item) => item.panelId),
                months: data.months,
                couponCode: data.couponCode,
            });

            const startDate = data.startDate ? new Date(data.startDate) : new Date();
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + data.months);

            const order = await prisma.$transaction(async (tx) => {
                const created = await tx.order.create({
                    data: {
                        userId: req.user!.id,
                        totalValue: quote.finalValue,
                        startDate,
                        endDate,
                        notes: data.notes,
                        status: OrderStatus.PENDING,
                        // Aqui criamos os painéis vinculados ao pacote de uma só vez
                        items: {
                            create: quote.items.map(item => ({
                                panelId: item.panelId,
                                priceSnapshot: item.priceSnapshot
                            }))
                        }
                    },
                    include: {
                        user: { select: { name: true, email: true } },
                        items: { include: { panel: { select: { name: true, price: true } } } }
                    }
                });

                if (quote.coupon?.singleUse) {
                    await tx.crmCoupon.update({
                        where: { id: quote.coupon.id },
                        data: { isUsed: true, usedAt: new Date() },
                    });
                }

                return created;
            });

            return res.status(201).json(order);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Dados inválidos.', details: error.issues });
            }
            throw error;
        }
    },

    async index(req: Request, res: Response) {
        try {
            // Consultores comerciais veem apenas os próprios pedidos e os ainda não atribuídos
            const where = req.user?.role === Role.COMERCIAL
                ? { OR: [{ sellerId: req.user.id }, { sellerId: null }] }
                : undefined;

            const orders = await prisma.order.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: orderInclude
            });

            return res.status(200).json(orders);
        } catch (error) {
            console.error('Erro ao buscar pedidos:', error);
            return res.status(500).json({ error: 'Erro interno ao buscar pedidos.' });
        }
    },

    async show(req: Request<{ id: string }>, res: Response) {
        const order = await prisma.order.findUnique({
            where: { id: String(req.params.id) },
            include: orderInclude
        });

        if (!order) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        if (req.user?.role === Role.COMERCIAL && order.sellerId && order.sellerId !== req.user.id) {
            return res.status(403).json({ error: 'Sem permissão para esta ação.' });
        }

        return res.status(200).json(order);
    },

    async update(req: Request<{ id: string }>, res: Response) {
        const { id } = req.params;
        const { status, sellerId } = req.body;

        if (status && !Object.values(OrderStatus).includes(status as OrderStatus)) {
            return res.status(400).json({ error: 'Status de pedido inválido.' });
        }

        if (sellerId !== undefined && sellerId !== null && typeof sellerId !== 'string') {
            return res.status(400).json({ error: 'Vendedor inválido.' });
        }

        try {
            const current = await prisma.order.findUnique({ where: { id: String(id) }, select: { sellerId: true } });
            if (!current) {
                return res.status(404).json({ error: 'Pedido não encontrado.' });
            }

            // Comercial só altera pedidos próprios (ou livres) e não pode repassá-los a outra pessoa
            if (req.user?.role === Role.COMERCIAL) {
                const ownsOrder = !current.sellerId || current.sellerId === req.user.id;
                const reassigns = sellerId !== undefined && sellerId !== req.user.id;
                if (!ownsOrder || reassigns) {
                    return res.status(403).json({ error: 'Sem permissão para esta ação.' });
                }
            }

            const updatedOrder = await prisma.order.update({
                where: { id: String(id) },
                data: {
                    ...(status && { status: status as OrderStatus }),
                    ...(sellerId !== undefined && { sellerId: sellerId || null })
                },
                include: {
                    user: { select: { name: true, email: true } },
                    seller: { select: { id: true, name: true } },
                    items: { include: { panel: { select: { name: true } } } }
                }
            });

            return res.status(200).json(updatedOrder);
        } catch (error) {
            console.error('Erro ao atualizar o pedido:', error);
            return res.status(500).json({ error: 'Erro interno ao atualizar o pedido.' });
        }
    }
};
