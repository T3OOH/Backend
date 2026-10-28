import { Router } from 'express';
import { InstitutionalController } from '../controllers/institutional.controller';
import { authMiddleware, requireRoles, MANAGEMENT_ROLES } from '../middlewares/auth.middleware';

const institutionalRoutes = Router();
const controller = new InstitutionalController();

// GET: Rota pública (qualquer um pode ver no site)
institutionalRoutes.get('/', controller.get);

// PUT: Rota protegida (apenas gestores podem salvar alterações)
institutionalRoutes.put('/', authMiddleware, requireRoles(...MANAGEMENT_ROLES), controller.update);

export { institutionalRoutes };
