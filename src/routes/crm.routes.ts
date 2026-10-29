import { Router } from 'express';
import { crmController } from '../controllers/crm.controller';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

const crmRoutes = Router();

// Public routes
crmRoutes.post('/deals/checkout', crmController.createCheckoutDeal);
crmRoutes.post('/deals/solution', crmController.createSolutionLead);

// Authenticated scope (equipe interna apenas)
crmRoutes.use(authMiddleware, requireRoles(...STAFF_ROLES));

// Dashboard / Metrics
crmRoutes.get('/metrics', crmController.getDashboardMetrics);

// Client Management
crmRoutes.get('/clients', crmController.getClients);
crmRoutes.get('/site-clients', crmController.getSiteClients);
crmRoutes.post('/clients', crmController.createClient);
crmRoutes.put('/clients/:id', crmController.updateClient);
crmRoutes.delete('/clients/:id', crmController.deleteClient);

// Deal Management
crmRoutes.get('/deals', crmController.getDeals);
crmRoutes.get('/deals/global', crmController.getGlobalDeals);
crmRoutes.get('/deals/:dealId/messages', crmController.getChatHistory);
crmRoutes.post('/deals', crmController.createDeal);
crmRoutes.post('/deals/:dealId/claim', crmController.claimDeal);
crmRoutes.patch('/deals/:id/stage', crmController.updateDealStage);
crmRoutes.patch('/deals/:id/status', crmController.updateDealStatus);
crmRoutes.patch('/deals/:id', crmController.updateDeal);

export { crmRoutes };
