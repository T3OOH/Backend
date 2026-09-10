import { Router } from 'express';
import { InstitutionalController } from '../controllers/institutional.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const institutionalRoutes = Router();
const controller = new InstitutionalController();

// GET: Rota pública (qualquer um pode ver no site)
institutionalRoutes.get('/', controller.get);

// PUT: Rota protegida (apenas gestores logados podem salvar alterações)
institutionalRoutes.put('/', authMiddleware, controller.update);

export { institutionalRoutes };