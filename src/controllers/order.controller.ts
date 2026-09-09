import { Request, Response } from 'express';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';

// Novo schema aceitando o carrinho (array de itens)
const createOrderSchema = z.object({
    userId: z.string().uuid(),
    totalValue: z.number().min(0),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
        panelId: z.string().uuid(),
        priceSnapshot: z.number().min(0)
    })).min(1, "O pedido deve ter pelo menos um painel.")
});

export const orderController = {
    async create(req: Request, res: Response) {
        try {
            const data = createOrderSchema.parse(req.body);

            const order = await prisma.order.create({
                data: {
                    userId: data.userId,
                    totalValue: data.totalValue,
                    startDate: data.startDate ? new Date(data.startDate) : null,
                    endDate: data.endDate ? new Date(data.endDate) : null,
                    notes: data.notes,
                    status: OrderStatus.PENDING,
                    // Aqui criamos os painéis vinculados ao pacote de uma só vez
                    items: {
                        create: data.items.map(item => ({
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

            return res.status(201).json(order);
        } catch (error) {
            console.error('Erro ao criar pedido:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Dados inválidos.', details: error.issues });
            }
            return res.status(500).json({ error: 'Erro interno ao criar pedido.' });
        }
    },

    async index(req: Request, res: Response) {
        try {
            const orders = await prisma.order.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { name: true, email: true, phone: true, companyName: true } },
                    seller: { select: { id: true, name: true } },
                    // Agora buscamos os painéis através da relação "items"
                    items: {
                        include: {
                            panel: { select: { id: true, name: true, city: true, state: true, images: true, price: true } }
                        }
                    }
                }
            });

            return res.status(200).json(orders);
        } catch (error) {
            console.error('Erro ao buscar pedidos:', error);
            return res.status(500).json({ error: 'Erro interno ao buscar pedidos.' });
        }
    },

    async update(req: Request<{ id: string }>, res: Response) {
        const { id } = req.params;
        const { status, sellerId } = req.body;

        if (status && !Object.values(OrderStatus).includes(status as OrderStatus)) {
            return res.status(400).json({ error: 'Status de pedido inválido.' });
        }

        try {
            const updatedOrder = await prisma.order.update({
                where: { id: String(id) },
                data: {
                    ...(status && { status: status as OrderStatus }),
                    ...(sellerId !== undefined && { sellerId: sellerId }) 
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