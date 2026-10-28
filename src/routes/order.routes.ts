import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

const orderRoutes = Router();

orderRoutes.use(authMiddleware);

// Qualquer usuário logado pode criar um pedido para si mesmo
orderRoutes.post('/', orderController.create);

// Listagem e atualização apenas pela equipe
orderRoutes.get('/', requireRoles(...STAFF_ROLES), orderController.index);
orderRoutes.get('/:id', requireRoles(...STAFF_ROLES), orderController.show);
orderRoutes.patch('/:id', requireRoles(...STAFF_ROLES), orderController.update);

export { orderRoutes };
