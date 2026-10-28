import { Router } from 'express';
import { bannerController } from '../controllers/banner.controller';
import { authMiddleware, requireRoles, MANAGEMENT_ROLES } from '../middlewares/auth.middleware';

const router = Router();

// Rota pública para a página de Serviços (Frontend)
router.get('/', bannerController.listActive);

// Rotas protegidas (apenas gestores do painel)
router.get('/all', authMiddleware, requireRoles(...MANAGEMENT_ROLES), bannerController.listAll);
router.post('/', authMiddleware, requireRoles(...MANAGEMENT_ROLES), bannerController.create);
router.delete('/:id', authMiddleware, requireRoles(...MANAGEMENT_ROLES), bannerController.delete);

export { router as bannerRoutes };
