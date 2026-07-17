"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelRepository = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../database/prisma");
class PanelRepository {
    async create(data) {
        return prisma_1.prisma.panel.create({ data });
    }
    async findById(id) {
        return prisma_1.prisma.panel.findUnique({
            where: { id },
            include: { category: true },
        });
    }
    async findAll(filters = {}) {
        return prisma_1.prisma.panel.findMany({
            where: filters,
            include: { category: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findForMap() {
        return prisma_1.prisma.panel.findMany({
            where: { status: client_1.PanelStatus.AVAILABLE },
            select: {
                id: true,
                name: true,
                lat: true,
                lng: true,
                city: true,
                state: true,
                status: true,
                images: true,
                impacts: true,
                size: true,
                px: true,
            },
        });
    }
    async update(id, data) {
        return prisma_1.prisma.panel.update({ where: { id }, data });
    }
    async remove(id) {
        return prisma_1.prisma.panel.delete({ where: { id } });
    }
}
exports.PanelRepository = PanelRepository;
