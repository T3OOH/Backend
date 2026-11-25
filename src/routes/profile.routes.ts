import { Router } from 'express';
import { profileController } from '../controllers/profile.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const profileRoutes = Router();

// Todas as rotas de perfil exigem que o usuário esteja logado
profileRoutes.use(authMiddleware);

profileRoutes.get('/', profileController.getProfile);
profileRoutes.put('/', profileController.updateProfile);
profileRoutes.put('/preferences', profileController.updatePreferences);

// Segurança: aparelhos conectados, atividade recente e troca de senha
profileRoutes.get('/security', profileController.getSecurity);
profileRoutes.delete('/sessions/:id', profileController.revokeSession);
profileRoutes.post('/sessions/revoke-others', profileController.revokeOtherSessions);
profileRoutes.put('/password', profileController.changePassword);
profileRoutes.get('/orders', profileController.getMyOrders);

// LGPD: cópia dos dados e exclusão da conta pelo próprio titular
profileRoutes.get('/export', profileController.exportData);
profileRoutes.delete('/', profileController.deleteAccount);

export { profileRoutes };