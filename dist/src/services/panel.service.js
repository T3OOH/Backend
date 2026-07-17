"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelService = void 0;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const panel_repository_1 = require("../repositories/panel.repository");
const firstQueryValue = (value) => Array.isArray(value) ? value[0] : value;
const optionalQueryString = zod_1.z.preprocess(firstQueryValue, zod_1.z.string().trim().min(1).optional());
const panelListQuerySchema = zod_1.z.object({
    city: optionalQueryString,
    state: optionalQueryString,
    status: zod_1.z.preprocess(firstQueryValue, zod_1.z.nativeEnum(client_1.PanelStatus).optional()),
    categoryId: zod_1.z.preprocess(firstQueryValue, zod_1.z.string().uuid().optional()),
}).strip();
class PanelService {
    repository = new panel_repository_1.PanelRepository();
    async createPanel(data) {
        return this.repository.create(data);
    }
    async getAllPanels(queryFilters) {
        const query = panelListQuerySchema.parse(queryFilters);
        const filters = {};
        if (query.city) {
            filters.city = { contains: query.city, mode: 'insensitive' };
        }
        if (query.state)
            filters.state = query.state;
        if (query.status)
            filters.status = query.status;
        if (query.categoryId)
            filters.categoryId = query.categoryId;
        return this.repository.findAll(filters);
    }
    async getMapMarkers() {
        return this.repository.findForMap();
    }
    async getPanelById(id) {
        const panel = await this.repository.findById(id);
        if (!panel)
            throw new Error('Painel não encontrado.');
        return panel;
    }
    async updatePanel(id, data) {
        await this.getPanelById(id);
        return this.repository.update(id, data);
    }
    async deletePanel(id) {
        await this.getPanelById(id);
        return this.repository.remove(id);
    }
}
exports.PanelService = PanelService;
