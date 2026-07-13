import { PanelStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PanelRepository } from '../repositories/panel.repository';

const firstQueryValue = (value: unknown) => Array.isArray(value) ? value[0] : value;
const optionalQueryString = z.preprocess(
    firstQueryValue,
    z.string().trim().min(1).optional(),
);

const panelListQuerySchema = z.object({
    city: optionalQueryString,
    state: optionalQueryString,
    status: z.preprocess(firstQueryValue, z.nativeEnum(PanelStatus).optional()),
    categoryId: z.preprocess(firstQueryValue, z.string().uuid().optional()),
}).strip();

export class PanelService {
    private readonly repository = new PanelRepository();

    async createPanel(data: Prisma.PanelUncheckedCreateInput) {
        return this.repository.create(data);
    }

    async getAllPanels(queryFilters: unknown) {
        const query = panelListQuerySchema.parse(queryFilters);
        const filters: Prisma.PanelWhereInput = {};

        if (query.city) {
            filters.city = { contains: query.city, mode: 'insensitive' };
        }
        if (query.state) filters.state = query.state;
        if (query.status) filters.status = query.status;
        if (query.categoryId) filters.categoryId = query.categoryId;

        return this.repository.findAll(filters);
    }

    async getMapMarkers() {
        return this.repository.findForMap();
    }

    async getPanelById(id: string) {
        const panel = await this.repository.findById(id);
        if (!panel) throw new Error('Painel não encontrado.');
        return panel;
    }

    async updatePanel(id: string, data: Prisma.PanelUpdateInput) {
        await this.getPanelById(id);
        return this.repository.update(id, data);
    }

    async deletePanel(id: string) {
        await this.getPanelById(id);
        return this.repository.remove(id);
    }
}
