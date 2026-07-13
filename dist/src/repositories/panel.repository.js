"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelRepository = void 0;
const prisma_1 = require("../database/prisma");
class PanelRepository {
    async create(data) {
        return prisma_1.prisma.panel.create({ data });
    }
    async findById(id) {
        return prisma_1.prisma.panel.findUnique({
            where: { id },
            include: { category: true }
        });
    }
    async findAll(filters = {}) {
        return prisma_1.prisma.panel.findMany({
            where: filters,
            include: { category: true },
            orderBy: { createdAt: 'desc' }
        });
    }
    async findForMap() {
        return prisma_1.prisma.panel.findMany({
            where: { status: 'AVAILABLE' },
            select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
                city: true,
                state: true,
                status: true,
                categoryId: true
            }
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
