import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { contactSchema } from '../validators/contact.validator';
import { splitAttribution } from '../lib/attribution';

export const contactController = {
    async create(req: Request, res: Response) {
        // A origem do lead vem à parte: o validador do contato recusa campos desconhecidos
        const { attribution, body } = splitAttribution(req.body);
        const data = contactSchema.parse(body);

        const contact = await prisma.contact.create({
            data: {
                ...data,
                ip: req.ip,
                userAgent: req.get('user-agent') ?? undefined,
                origin: 'Página de contato',
                attribution,
            },
        });

        return res.status(201).json({
            id: contact.id,
            message: 'Mensagem enviada com sucesso.',
        });
    },
};
