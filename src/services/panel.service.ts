import { PanelStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PanelRepository } from '../repositories/panel.repository';
import { memoryCache } from '../lib/memoryCache';

// Lista e mapa são públicos e mudam pouco: respondem da memória e renovam a cada minuto.
// Qualquer alteração de painel limpa o cache na hora.
const PANELS_CACHE = 'panels:';
const PANELS_TTL_MS = 60_000;

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
        const panel = await this.repository.create(data);
        memoryCache.invalidate(PANELS_CACHE);
        return panel;
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

        return memoryCache.wrap(PANELS_CACHE + JSON.stringify(query), PANELS_TTL_MS, () => this.repository.findAll(filters));
    }

    async getMapMarkers() {
        return memoryCache.wrap(PANELS_CACHE + 'map', PANELS_TTL_MS, () => this.repository.findForMap());
    }

    async getPanelById(id: string) {
        const panel = await this.repository.findById(id);
        if (!panel) throw new Error('Painel não encontrado.');
        return panel;
    }

    async updatePanel(id: string, data: Prisma.PanelUpdateInput) {
        await this.getPanelById(id);
        const panel = await this.repository.update(id, data);
        memoryCache.invalidate(PANELS_CACHE);
        return panel;
    }

    async deletePanel(id: string) {
        await this.getPanelById(id);
        const removed = await this.repository.remove(id);
        memoryCache.invalidate(PANELS_CACHE);
        return removed;
    }
}
