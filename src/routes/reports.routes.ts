import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller';
import { authMiddleware, MANAGEMENT_ROLES, requireRoles } from '../middlewares/auth.middleware';

const reportsRoutes = Router();

// Gestão: relatórios de vendas e ocupação dos painéis
reportsRoutes.use(authMiddleware, requireRoles(...MANAGEMENT_ROLES));
reportsRoutes.get('/summary', reportsController.summary);
reportsRoutes.get('/occupancy', reportsController.occupancy);
// Indicadores e processos: KPIs, SLA, lead time, tempo por etapa e por comercial
reportsRoutes.get('/indicators', reportsController.indicators);
reportsRoutes.get('/sla', reportsController.getSla);
reportsRoutes.put('/sla', reportsController.updateSla);

export { reportsRoutes };
