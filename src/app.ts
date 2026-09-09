import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import path from 'path';

import { env } from './config/env';
import { authRoutes } from './routes/auth.routes';
import { contactRoutes } from './routes/contact.routes';
import { panelRoutes } from './routes/panel.routes';
import { uploadRoutes } from './routes/upload.routes';
import { userRoutes } from './routes/user.routes';
import { orderRoutes } from './routes/order.routes';
import { crmRoutes } from './routes/crm.routes';
import { chatRoutes } from './routes/chat.routes';
import { agendaRoutes } from './routes/agenda.routes';
import { couponRoutes } from './routes/coupon.routes';
import { profileRoutes } from './routes/profile.routes';
import { bannerRoutes } from './routes/banner.routes';
import { solutionRoutes } from './routes/solution.routes'; 

/**
 * Instância principal da aplicação Express.
 */
const app: Application = express();

/**
 * Configuração de proxy reverso.
 * Necessário para que o rate limiter confie no IP original caso a API esteja
 * hospedada atrás de balanceadores de carga como Vercel, Heroku ou Nginx.
 */
app.set('trust proxy', 1);

/**
 * Configurações de Segurança: Helmet unificado.
 * O Helmet define cabeçalhos HTTP focados em segurança. A política de CSP 
 * foi ajustada para permitir frames e origens cruzadas do localhost e URL de produção.
 */
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "frame-ancestors": ["'self'", "http://localhost:3000", "http://localhost:5173", "https://t3ooh.com", "https://www.t3ooh.com", env.FRONTEND_URL].filter(Boolean) as string[],
        },
    },
}));
app.disable('x-powered-by');

/**
 * ========================================================
 * CORS "À PROVA DE BALAS" (DINÂMICO)
 * ========================================================
 * Removemos a lista fixa para evitar bloqueios de www ou 
 * cache. Esta função permite a passagem dinâmica.
 */
app.use(cors({
    origin: function (origin, callback) {
        callback(null, true); 
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
}));

/**
 * Configuração do Parser JSON.
 */
app.use(express.json({ limit: '1mb' }));

/**
 * Provedor de Arquivos Estáticos (Uploads).
 * Middleware reposicionado acima do roteador principal para garantir 
 * que as imagens carreguem antes de baterem na rota 404.
 */
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

/**
 * Limitadores de Taxa (Rate Limit).
 * O limite geral da API foi dimensionado para acomodar aplicações React 
 * com comportamento de Polling sem disparar o status HTTP 429 precocemente.
 */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Limite de requisições excedido. Tente novamente em alguns minutos.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

/**
 * Registros de Rotas e Controladores.
 */
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use(apiLimiter);
app.use('/auth/login', loginLimiter);
app.use('/auth', authRoutes);
app.use('/contacts', contactRoutes);
app.use('/panels', panelRoutes);
app.use('/banners', bannerRoutes); 
app.use('/solution', solutionRoutes); // <-- NOVA ROTA REGISTRADA AQUI
app.use('/upload', uploadRoutes);
app.use('/users', userRoutes);
app.use('/orders', orderRoutes);
app.use('/crm', crmRoutes);
app.use('/chat', chatRoutes);
app.use('/agenda', agendaRoutes);
app.use('/coupons', couponRoutes);
app.use('/profile', profileRoutes);

/**
 * Manipulador de Rotas Não Encontradas (404).
 * Funciona como um fallback quando nenhuma rota anterior é correspondida.
 */
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

/**
 * Middleware de Tratamento de Erros Global.
 * Intercepta exceções lançadas nos controladores (ex: erros de validação Zod, Multer).
 */
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

    if (err instanceof Error && err.message === 'Formato invalido. Envie imagens ou documentos (PDF, DOC).') {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof Error && err.message === 'Painel não encontrado.') {
        return res.status(404).json({ error: err.message });
    }

    console.error(err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
});

export default app;