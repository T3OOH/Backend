"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactController = void 0;
const prisma_1 = require("../database/prisma");
const contact_validator_1 = require("../validators/contact.validator");
exports.contactController = {
    async create(req, res) {
        const data = contact_validator_1.contactSchema.parse(req.body);
        const contact = await prisma_1.prisma.contact.create({
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
