import { Router } from 'express';
import { userController } from '../controllers/user.controller';
import { authMiddleware, requireRoles, MANAGEMENT_ROLES } from '../middlewares/auth.middleware';

const userRoutes = Router();

// Gestão de usuários: exclusiva do dashboard administrativo
userRoutes.use(authMiddleware, requireRoles(...MANAGEMENT_ROLES));

userRoutes.get('/', userController.index);
userRoutes.patch('/:id/role', userController.updateRole);

export { userRoutes };
