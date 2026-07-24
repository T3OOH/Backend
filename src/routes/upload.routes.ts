import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs'; // 👈 IMPORTAÇÃO NOVA
import { authMiddleware } from '../middlewares/auth.middleware';

const uploadRoutes = Router();

// Lógica para verificar e CRIAR a pasta automaticamente
const uploadDir = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuração do Multer para salvar os arquivos com nomes únicos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir); 
    },
    filename: (req, file, cb) => {
        const hash = crypto.randomBytes(8).toString('hex');
        const fileName = `${hash}-${file.originalname.replace(/\s+/g, '-')}`;
        cb(null, fileName);
    }
});

const upload = multer({ storage });

uploadRoutes.post('/', authMiddleware, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }
        const fileUrl = `${process.env.API_URL || 'http://localhost:3333'}/uploads/${req.file.filename}`;

        return res.json({ url: fileUrl });
    } catch (error) {
        console.error('[Upload] Erro:', error);
        return res.status(500).json({ error: 'Erro interno ao processar o arquivo.' });
    }
});

export { uploadRoutes };