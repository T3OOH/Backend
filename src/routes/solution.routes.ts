import { Router } from 'express';
import { solutionController } from '../controllers/solution.controller';
import { authMiddleware, requireRoles, MANAGEMENT_ROLES } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint público consumido pela Landing Page
router.get('/portfolio', solutionController.getPortfolio);

// Endpoints protegidos (apenas gestores)
router.post('/portfolio', authMiddleware, requireRoles(...MANAGEMENT_ROLES), solutionController.addPortfolioImage);
router.delete('/portfolio/:id', authMiddleware, requireRoles(...MANAGEMENT_ROLES), solutionController.deletePortfolioImage);

export { router as solutionRoutes };
