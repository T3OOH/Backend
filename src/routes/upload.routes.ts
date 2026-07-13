import { Router } from 'express';
import { Role } from '@prisma/client';

import { UploadController } from '../controllers/upload.controller';
import { authMiddleware, requireRoles } from '../middlewares/auth.middleware';
import { uploadMiddleware } from '../middlewares/upload.middleware';

const uploadRoutes = Router();
const uploadController = new UploadController();

uploadRoutes.post(
    '/',
    authMiddleware,
    requireRoles(Role.ADMIN, Role.MANAGER),
    uploadMiddleware.single('file'),
    (req, res, next) => {
        void uploadController.uploadImage(req, res).catch(next);
    },
);

export { uploadRoutes };