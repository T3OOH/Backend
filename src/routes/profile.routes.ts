import { Router } from 'express';
import { profileController } from '../controllers/profile.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const profileRoutes = Router();

// Todas as rotas de perfil exigem que o usuário esteja logado
profileRoutes.use(authMiddleware);

profileRoutes.get('/', profileController.getProfile);
profileRoutes.put('/', profileController.updateProfile);
profileRoutes.get('/orders', profileController.getMyOrders);

export { profileRoutes };