import { NextFunction, Request, Response, Router } from 'express';
import { Role } from '@prisma/client';

import { PanelController } from '../controllers/panel.controller';
import { authMiddleware, requireRoles } from '../middlewares/auth.middleware';

const panelRoutes = Router();
const panelController = new PanelController();

// Navegador reaproveita a lista por 30 s e pode mostrar a anterior enquanto busca a nova
const publicCache = (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=600');
    next();
};

panelRoutes.get('/', publicCache, (req, res) => panelController.list(req, res));
panelRoutes.get('/markers', publicCache, (req, res) => panelController.mapMarkers(req, res));
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