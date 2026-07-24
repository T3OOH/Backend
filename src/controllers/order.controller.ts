import { Request, Response } from 'express';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';

// Schema de validacao para a entrada de dados do pedido
const createOrderSchema = z.object({
    userId: z.string().uuid(),
    panelId: z.string().uuid().optional(),
    totalValue: z.number().min(0),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    notes: z.string().optional(),
});

export const orderController = {
    async create(req: Request, res: Response) {
        try {
            const data = createOrderSchema.parse(req.body);

            const order = await prisma.order.create({
                data: {
                    userId: data.userId,
                    panelId: data.panelId,
                    totalValue: data.totalValue,
                    startDate: data.startDate ? new Date(data.startDate) : null,
                    endDate: data.endDate ? new Date(data.endDate) : null,
                    notes: data.notes,
                    status: OrderStatus.PENDING,
                },
                include: {
                    user: { select: { name: true, email: true } },
                    panel: { select: { name: true, price: true } }
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
                    user: { select: { name: true, email: true } },
                    panel: { select: { name: true, city: true, state: true } }
                }
            });

            return res.status(200).json(orders);
        } catch (error) {
            console.error('Erro ao buscar pedidos:', error);
            return res.status(500).json({ error: 'Erro interno ao buscar pedidos.' });
        }
    },

    async updateStatus(req: Request<{ id: string }>, res: Response) {
        const { id } = req.params;
        const { status } = req.body;

        // Validacao restrita para os status disponiveis no Enum
        if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
            return res.status(400).json({ error: 'Status de pedido inválido.' });
        }

        try {
            const updatedOrder = await prisma.order.update({
                where: { id: String(id) },
                data: { status: status as OrderStatus },
                include: {
                    user: { select: { name: true, email: true } },
                    panel: { select: { name: true } }
                }
            });

            return res.status(200).json(updatedOrder);
        } catch (error) {
            console.error('Erro ao atualizar status do pedido:', error);
            return res.status(500).json({ error: 'Erro interno ao atualizar status do pedido.' });
        }
    }
};