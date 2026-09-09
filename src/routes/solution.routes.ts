import { Router } from 'express';
import { solutionController } from '../controllers/solution.controller';

const router = Router();

// Endpoint público consumido pela Landing Page
router.get('/portfolio', solutionController.getPortfolio);

// Endpoints protegidos (O ideal é adicionar seu authMiddleware no futuro)
router.post('/portfolio', solutionController.addPortfolioImage);
router.delete('/portfolio/:id', solutionController.deletePortfolioImage);

// Exportação nomeada para bater com o import { solutionRoutes } no app.ts
export { router as solutionRoutes };