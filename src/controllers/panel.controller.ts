import { Request, Response } from 'express';
import { PanelService } from '../services/panel.service';
import { createPanelSchema, updatePanelSchema } from '../validators/panel.validator';

const panelService = new PanelService();

export class PanelController {
    async create(req: Request, res: Response) {
        const data = createPanelSchema.parse(req.body);
        const panel = await panelService.createPanel(data);
        return res.status(201).json(panel);
    }

    async list(req: Request, res: Response) {
        const panels = await panelService.getAllPanels(req.query);
        return res.status(200).json(panels);
    }

    async mapMarkers(req: Request, res: Response) {
        const markers = await panelService.getMapMarkers();
        return res.status(200).json(markers);
    }

    async getOne(req: Request, res: Response) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        const panel = await panelService.getPanelById(id);
        return res.status(200).json(panel);
    }

    async update(req: Request, res: Response) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        const data = updatePanelSchema.parse(req.body);
        const panel = await panelService.updatePanel(id, data);
        return res.status(200).json(panel);
    }

    async delete(req: Request, res: Response) {
        // Forçamos a conversão para string
        const id = String(req.params.id);
        await panelService.deletePanel(id);
        return res.status(204).send();
    }
}