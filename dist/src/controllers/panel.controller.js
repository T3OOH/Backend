"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelController = void 0;
const panel_service_1 = require("../services/panel.service");
const panel_validator_1 = require("../validators/panel.validator");
const panelService = new panel_service_1.PanelService();
class PanelController {
    async create(req, res) {
        const data = panel_validator_1.createPanelSchema.parse(req.body);
        const panel = await panelService.createPanel(data);
        return res.status(201).json(panel);
    }
    async list(req, res) {
        const panels = await panelService.getAllPanels(req.query);
        return res.status(200).json(panels);
    }
    async mapMarkers(req, res) {
        const markers = await panelService.getMapMarkers();
        return res.status(200).json(markers);
    }
    async getOne(req, res) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        const panel = await panelService.getPanelById(id);
        return res.status(200).json(panel);
    }
    async update(req, res) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        const data = panel_validator_1.updatePanelSchema.parse(req.body);
        const panel = await panelService.updatePanel(id, data);
        return res.status(200).json(panel);
    }
    async delete(req, res) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        await panelService.deletePanel(id);
        return res.status(204).send();
    }
}
exports.PanelController = PanelController;
