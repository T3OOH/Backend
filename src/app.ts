import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';

import { env } from './config/env';
import { authRoutes } from './routes/auth.routes';
import { contactRoutes } from './routes/contact.routes';
import { panelRoutes } from './routes/panel.routes';
import { uploadRoutes } from './routes/upload.routes';

const app: Application = express();

// ==========================================
// CONFIGURAÇÃO OBRIGATÓRIA PARA O RENDER
// ==========================================
// Como o Render usa um proxy, o Express precisa confiar nele 
// para que o express-rate-limit pegue o IP real do usuário, não o do servidor do Render.
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

// Lista de URLs permitidas para acessar a API
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://frontend-h3ik-mu.vercel.app',
    env.FRONTEND_URL 
].filter(Boolean); 

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ==========================================
// AJUSTE NAS ROTAS (REMOVIDO O /api)
// ==========================================
// Agora as rotas batem exatamente com o que o seu frontend está chamando.
app.use(apiLimiter);
app.use('/auth/login', loginLimiter);
app.use('/auth', authRoutes);
app.use('/contacts', contactRoutes);
app.use('/panels', panelRoutes);
app.use('/upload', uploadRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
        return res.status(400).json({
            error: 'Dados inválidos.',
            details: err.issues,
        });
    }

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof Error && err.message === 'Formato inválido. Envie JPG, PNG ou WEBP.') {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof Error && err.message === 'Painel não encontrado.') {
        return res.status(404).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
});

export default app;