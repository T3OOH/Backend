import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth.middleware';
import { UploadController } from '../controllers/upload.controller';

const uploadRoutes = Router();
const uploadController = new UploadController();

// 1. O SEGREDO: Usamos memoryStorage() em vez de diskStorage()
// Isso mantém a imagem na memória RAM apenas pelo tempo necessário para enviar ao Supabase
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 2. Rota blindada e apontando para o Controller correto
// O controller é quem vai pegar o req.file.buffer e mandar para o bucket
uploadRoutes.post(
    '/', 
    authMiddleware, 
    upload.single('file'), 
    uploadController.uploadImage
);

export { uploadRoutes };