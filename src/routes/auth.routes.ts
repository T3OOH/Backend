import { Router } from 'express';
import { authController } from '../controllers/auth.controller';

const authRoutes = Router();

authRoutes.post('/register', authController.register);
authRoutes.post('/login', authController.login);
authRoutes.post('/google', authController.google);

// Novas rotas de recuperação de senha
authRoutes.post('/forgot-password', authController.forgotPassword);
authRoutes.post('/reset-password', authController.resetPassword);

export { authRoutes };