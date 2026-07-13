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

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/panels', panelRoutes);
app.use('/api/upload', uploadRoutes);

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
