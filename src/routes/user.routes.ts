import { Router } from 'express';
import { userController } from '../controllers/user.controller';

const userRoutes = Router();

// Mapeamento das rotas de gestão de usuários
userRoutes.get('/', userController.index);
userRoutes.patch('/:id/role', userController.updateRole);

export { userRoutes };