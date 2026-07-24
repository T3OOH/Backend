import { Router } from 'express';
import { crmController } from '../controllers/crm.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const crmRoutes = Router();

// Public routes
crmRoutes.post('/deals/checkout', crmController.createCheckoutDeal);

// Authenticated scope
crmRoutes.use(authMiddleware);

// Dashboard / Metrics
crmRoutes.get('/metrics', crmController.getDashboardMetrics);

// Client Management
crmRoutes.get('/clients', crmController.getClients);
crmRoutes.post('/clients', crmController.createClient);
crmRoutes.put('/clients/:id', crmController.updateClient);
crmRoutes.delete('/clients/:id', crmController.deleteClient);

// Deal Management
crmRoutes.get('/deals', crmController.getDeals);
crmRoutes.get('/deals/:dealId/messages', crmController.getChatHistory);
crmRoutes.post('/deals', crmController.createDeal);
crmRoutes.patch('/deals/:id/stage', crmController.updateDealStage);
crmRoutes.get('/deals/global', crmController.getGlobalDeals);
crmRoutes.post('/deals/:dealId/claim', crmController.claimDeal);
crmRoutes.patch('/deals/:id/status', crmController.updateDealStatus);
crmRoutes.get('/deals/global', crmController.getGlobalDeals);

export { crmRoutes };