import { Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller';
import { authMiddleware, MANAGEMENT_ROLES, requireRoles } from '../middlewares/auth.middleware';

const analyticsRoutes = Router();

// Público: o site registra visitas anônimas
analyticsRoutes.post('/events', analyticsController.track);

// Gestão: painel de tráfego e origem dos leads
analyticsRoutes.get('/summary', authMiddleware, requireRoles(...MANAGEMENT_ROLES), analyticsController.summary);

export { analyticsRoutes };
