import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { contactSchema } from '../validators/contact.validator';

export const contactController = {
    async create(req: Request, res: Response) {
        const data = contactSchema.parse(req.body);

        const contact = await prisma.contact.create({
            data: {
                ...data,
                ip: req.ip,
                userAgent: req.get('user-agent') ?? undefined,
                origin: 'Página de contato',
            },
        });

        return res.status(201).json({
            id: contact.id,
            message: 'Mensagem enviada com sucesso.',
        });
    },
};
