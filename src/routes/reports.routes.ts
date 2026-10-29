import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller';
import { authMiddleware, MANAGEMENT_ROLES, requireRoles } from '../middlewares/auth.middleware';

const reportsRoutes = Router();

// Gestão: relatórios de vendas e ocupação dos painéis
reportsRoutes.use(authMiddleware, requireRoles(...MANAGEMENT_ROLES));
reportsRoutes.get('/summary', reportsController.summary);
reportsRoutes.get('/occupancy', reportsController.occupancy);

export { reportsRoutes };
