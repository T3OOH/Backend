"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelService = void 0;
const panel_repository_1 = require("../repositories/panel.repository");
class PanelService {
    repository;
    constructor() {
        this.repository = new panel_repository_1.PanelRepository();
    }
    async createPanel(data) {
        return this.repository.create(data);
    }
    async getAllPanels(queryFilters) {
        const filters = {};
        // Helper para garantir que o valor seja apenas string
        const parseString = (val) => Array.isArray(val) ? String(val[0]) : String(val);
        if (queryFilters.city)
            filters.city = { contains: parseString(queryFilters.city), mode: 'insensitive' };
        if (queryFilters.state)
            filters.state = parseString(queryFilters.state);
        if (queryFilters.status)
            filters.status = parseString(queryFilters.status);
        if (queryFilters.categoryId)
            filters.categoryId = parseString(queryFilters.categoryId);
        return this.repository.findAll(filters);
    }
    async getMapMarkers() {
        return this.repository.findForMap();
    }
    async getPanelById(id) {
        const panel = await this.repository.findById(id);
        if (!panel)
            throw new Error('Painel não encontrado');
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
