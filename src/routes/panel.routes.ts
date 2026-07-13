import { Router } from 'express';
import { Role } from '@prisma/client';

import { PanelController } from '../controllers/panel.controller';
import { authMiddleware, requireRoles } from '../middlewares/auth.middleware';

const panelRoutes = Router();
const panelController = new PanelController();

panelRoutes.get('/', (req, res) => panelController.list(req, res));
panelRoutes.get('/markers', (req, res) => panelController.mapMarkers(req, res));
panelRoutes.get('/:id', (req, res) => panelController.getOne(req, res));

panelRoutes.post(
    '/',
    authMiddleware,
    requireRoles(Role.ADMIN, Role.MANAGER),
    (req, res) => panelController.create(req, res),
);

panelRoutes.put(
    '/:id',
    authMiddleware,
    requireRoles(Role.ADMIN, Role.MANAGER),
    (req, res) => panelController.update(req, res),
);

panelRoutes.delete(
    '/:id',
    authMiddleware,
    requireRoles(Role.ADMIN, Role.MANAGER),
    (req, res) => panelController.delete(req, res),
);

export { panelRoutes };