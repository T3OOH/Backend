"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.panelRoutes = void 0;
const express_1 = require("express");
const panel_controller_1 = require("../controllers/panel.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const panelRoutes = (0, express_1.Router)();
exports.panelRoutes = panelRoutes;
const panelController = new panel_controller_1.PanelController();
// 🟢 ROTAS PÚBLICAS (O mapa e a página inicial precisam acessar sem login)
panelRoutes.get('/', (req, res) => panelController.list(req, res));
panelRoutes.get('/markers', (req, res) => panelController.mapMarkers(req, res)); // Adicionei a sua rota de marcadores aqui!
panelRoutes.get('/:id', (req, res) => panelController.getOne(req, res));
// 🔒 ROTAS PRIVADAS (Tudo abaixo desta linha exige o Token JWT)
panelRoutes.use(auth_middleware_1.authMiddleware);
panelRoutes.post('/', (req, res) => panelController.create(req, res));
panelRoutes.put('/:id', (req, res) => panelController.update(req, res));
panelRoutes.delete('/:id', (req, res) => panelController.delete(req, res));
