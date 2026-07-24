import { Router } from 'express';
import { orderController } from '../controllers/order.controller';

const orderRoutes = Router();

// Mapeamento das rotas de pedidos
orderRoutes.post('/', orderController.create);
orderRoutes.get('/', orderController.index);
orderRoutes.patch('/:id/status', orderController.updateStatus);

export { orderRoutes };