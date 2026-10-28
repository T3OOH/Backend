import { Router } from 'express';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';
import { uploadMiddleware } from '../middlewares/upload.middleware';
import { UploadController } from '../controllers/upload.controller';

const uploadRoutes = Router();
const uploadController = new UploadController();

// memoryStorage + limite de 5MB + tipos permitidos (ver upload.middleware.ts)
uploadRoutes.post(
    '/', 
    authMiddleware, 
    requireRoles(...STAFF_ROLES),
    uploadMiddleware.single('file'), 
    uploadController.uploadImage
);

export { uploadRoutes };
