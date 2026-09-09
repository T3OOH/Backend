import { Router } from 'express';
import { orderController } from '../controllers/order.controller';

const orderRoutes = Router();

// Mapeamento das rotas de pedidos
orderRoutes.post('/', orderController.create);
orderRoutes.get('/', orderController.index);

// Rota corrigida: apontando para 'update' e usando apenas '/:id'
orderRoutes.patch('/:id', orderController.update);

export { orderRoutes };