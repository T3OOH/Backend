import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { mailAccountController } from '../controllers/mail-account.controller';
import { authMiddleware, requireRoles, MANAGEMENT_ROLES } from '../middlewares/auth.middleware';

const mailAccountRoutes = Router();

// Caixas @t3led.com.br da equipe: só ADMIN e MANAGER (Gestor)
mailAccountRoutes.use(authMiddleware, requireRoles(...MANAGEMENT_ROLES));

// Cada criação gera uma caixa (cobrada por caixa no plano pago) e um e-mail: limite folgado para uso real
const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas contas criadas em pouco tempo. Aguarde e tente de novo.' },
});

mailAccountRoutes.get('/status', mailAccountController.status);
mailAccountRoutes.get('/', mailAccountController.index);
mailAccountRoutes.post('/', createLimiter, mailAccountController.store);

export { mailAccountRoutes };
