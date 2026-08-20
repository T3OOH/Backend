import { Router } from 'express';
import { bannerController } from '../controllers/banner.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Rota pública para a página de Serviços (Frontend)
router.get('/', bannerController.listActive);

// Rotas protegidas (apenas usuários logados no painel)
router.get('/all', authMiddleware, bannerController.listAll);
router.post('/', authMiddleware, bannerController.create);
router.delete('/:id', authMiddleware, bannerController.delete);

export { router as bannerRoutes };