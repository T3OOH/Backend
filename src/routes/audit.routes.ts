import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { auditController } from '../controllers/audit.controller';
import { authMiddleware, MANAGEMENT_ROLES, requireRoles } from '../middlewares/auth.middleware';

const auditRoutes = Router();

// Público: o site informa erros do navegador (limite por IP para não virar enxurrada)
const clientErrorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded.' },
});
auditRoutes.post('/client-error', clientErrorLimiter, auditController.clientError);

// Gestão: registro de alterações e erros
auditRoutes.get('/', authMiddleware, requireRoles(...MANAGEMENT_ROLES), auditController.list);
auditRoutes.get('/facets', authMiddleware, requireRoles(...MANAGEMENT_ROLES), auditController.facets);

export { auditRoutes };
