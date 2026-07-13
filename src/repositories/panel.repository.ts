import { Panel, PanelStatus, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';

export class PanelRepository {
    async create(data: Prisma.PanelUncheckedCreateInput): Promise<Panel> {
        return prisma.panel.create({ data });
    }

    async findById(id: string) {
        return prisma.panel.findUnique({
            where: { id },
            include: { category: true },
        });
    }

    async findAll(filters: Prisma.PanelWhereInput = {}) {
        return prisma.panel.findMany({
            where: filters,
            include: { category: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findForMap() {
        return prisma.panel.findMany({
            where: { status: PanelStatus.AVAILABLE },
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

    async update(id: string, data: Prisma.PanelUpdateInput): Promise<Panel> {
        return prisma.panel.update({ where: { id }, data });
    }

    async remove(id: string): Promise<Panel> {
        return prisma.panel.delete({ where: { id } });
    }
}
