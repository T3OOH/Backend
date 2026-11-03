import { Router } from 'express';
import { downloadsController } from '../controllers/downloads.controller';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

const downloadsRoutes = Router();

// App desktop: só a equipe interna (gestão e comercial)
downloadsRoutes.get('/desktop', authMiddleware, requireRoles(...STAFF_ROLES), downloadsController.desktop);
downloadsRoutes.get('/desktop/arquivos/:fileId/link', authMiddleware, requireRoles(...STAFF_ROLES), downloadsController.desktopLink);

export { downloadsRoutes };
