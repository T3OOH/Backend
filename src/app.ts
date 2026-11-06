import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import path from 'path';

import { Prisma } from '@prisma/client';
import { env, isAllowedOrigin } from './config/env';
import { PricingError } from './services/pricing.service';
import { pricingRoutes } from './routes/pricing.routes';
import { authRoutes } from './routes/auth.routes';
import { contactRoutes } from './routes/contact.routes';
import { panelRoutes } from './routes/panel.routes';
import { uploadRoutes } from './routes/upload.routes';
import { userRoutes } from './routes/user.routes';
import { mailAccountRoutes } from './routes/mail-account.routes';
import { orderRoutes } from './routes/order.routes';
import { crmRoutes } from './routes/crm.routes';
import { chatRoutes } from './routes/chat.routes';
import { agendaRoutes } from './routes/agenda.routes';
import { couponRoutes } from './routes/coupon.routes';
import { profileRoutes } from './routes/profile.routes';
import { bannerRoutes } from './routes/banner.routes';
import { solutionRoutes } from './routes/solution.routes';
import { institutionalRoutes } from './routes/institutional.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { reportsRoutes } from './routes/reports.routes';
import { auditRoutes } from './routes/audit.routes';
import { downloadsRoutes } from './routes/downloads.routes';
import { meetingRoutes } from './routes/meeting.routes';
import { mcpRoutes } from './routes/mcp.routes';
import { localidadesRoutes } from './routes/localidades.routes';
import { assistenteRoutes } from './routes/assistente.routes';
import { requestContext } from './lib/requestContext';
import { recordRequestError } from './services/audit.service';

/**
 * Main Express application instance.
 */
const app: Application = express();

/**
 * Trust proxy configuration.
 * Required for correct IP resolution when application runs behind reverse proxies (e.g., Vercel, Nginx).
 */
app.set('trust proxy', 1);

/**
 * Contexto da requisição (id, rota, IP e autor) para o registro de auditoria.
 * Toda resposta 5xx vira um registro de erro com o que foi capturado durante a requisição.
 */
app.use(requestContext.middleware);
app.use((_req, res, next) => {
    const ctx = requestContext.get();
    res.on('finish', () => {
        if (res.statusCode >= 500 && ctx) requestContext.run(ctx, () => recordRequestError(res.statusCode));
    });
    next();
});

/**
 * Security Middleware (Helmet).
 * Configures HTTP response headers to protect against common web vulnerabilities.
 * The Content Security Policy (CSP) is explicitly tailored to allow:
 * 1. Vite's development server scripts and HMR WebSockets ('unsafe-inline', 'unsafe-eval').
 * 2. External image loading from Supabase Storage and OpenStreetMap (Leaflet).
 * 3. Cross-origin requests and framing from authorized domains.
 */
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "default-src": ["'self'"],
            "script-src": [
                "'self'", 
                "'unsafe-inline'", 
                "'unsafe-eval'", 
                "http://localhost:3000", 
                "http://localhost:5173"
            ],
            "connect-src": [
                "'self'", 
                "http://localhost:3000", 
                "http://localhost:5173", 
                "ws://localhost:3000", 
                "ws://localhost:5173", 
                "https://*.supabase.co"
            ],
            "img-src": [
                "'self'", 
                "data:", 
                "blob:", 
                "https://*.supabase.co", 
                "https://*.openstreetmap.org", 
                "https://unpkg.com"
            ],
            "frame-ancestors": [
                "'self'", 
                "http://localhost:3000", 
                "http://localhost:5173", 
                "https://t3led.com.br", 
                "https://www.t3led.com.br", 
                "https://t3ooh.com", 
                "https://www.t3ooh.com", 
                env.FRONTEND_URL
            ].filter(Boolean) as string[],
        },
    },
}));
app.disable('x-powered-by');

/**
 * Servidor MCP público (assistentes de IA): aberto a qualquer origem e com limite próprio,
 * por isso fica antes do CORS restrito ao site. Só leitura de dados públicos.
 */
app.use('/mcp', mcpRoutes);

/**
 * Cross-Origin Resource Sharing (CORS) Configuration.
 * Only the official frontend origins are accepted (see config/env.ts → allowedOrigins).
 */
app.use(cors({
    origin: function (origin, callback) {
        // Requests without Origin (curl, health checks, server-to-server) are allowed
        callback(null, !origin || isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
}));

/**
 * JSON Payload Parser.
 * Configured with a 1MB limit for incoming request bodies.
 */
app.use(express.json({ limit: '1mb' }));

/**
 * Static File Serving.
 * Exposes the local uploads directory.
 */
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

/**
 * Rate Limiting Middleware.
 * Global API rate limiter configured to accommodate standard client polling behaviors.
 */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Muitas requisições. Aguarde alguns minutos e tente de novo.' }
});

/**
 * Authentication Rate Limiter.
 * Stricter configuration applied specifically to login endpoints to prevent brute-force attacks.
 */
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.' },
});

/**
 * Recuperação de senha: limita pedidos de link (evita disparo de e-mails em massa
 * para a caixa de alguém) e tentativas de redefinição.
 */
const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitos pedidos de recuperação. Aguarde alguns minutos e tente de novo.' },
});
const passwordUpdateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
});

/**
 * Senha do download do launcher: 5 tentativas a cada 15 minutos por IP. Uma senha de 6 dígitos
 * tem 1 milhão de combinações; com o limite, adivinhar levaria décadas.
 */
const launcherLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    // Só senha errada conta: quem acerta pode baixar de novo sem ficar bloqueado
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de senha. Aguarde 15 minutos e tente de novo.' },
});

/**
 * Formulários públicos que gravam no banco (cadastro, contato, pedido do carrinho): limite próprio
 * para spam não encher as tabelas (o global de 1500 por 15 min é para navegação).
 */
const publicWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: { error: 'Muitos envios em pouco tempo. Aguarde alguns minutos e tente de novo.' },
});

/** Renovação de sessão: cada aba renova a cada ~15 min; o teto barra tentativas em massa. */
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas renovações de sessão. Aguarde alguns minutos.' },
});

/** Visitas do site: generoso para navegação normal, barra disparos automáticos. */
const analyticsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Aguarde alguns minutos e tente de novo.' },
});

/**
 * Route Registrations.
 */
// "commit" vem do Render (RENDER_GIT_COMMIT): o workflow "Produção" espera o deploy novo por ele
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', commit: process.env.RENDER_GIT_COMMIT ?? null }));

app.use(apiLimiter);
app.use('/auth/login', loginLimiter);
app.use('/auth/register', publicWriteLimiter);
app.use('/contacts', publicWriteLimiter);
app.use('/crm/deals/checkout', publicWriteLimiter);
app.use('/auth/google', loginLimiter);
app.use('/auth/forgot-password', passwordResetLimiter);
app.use('/auth/reset-password', passwordUpdateLimiter);
app.use('/auth/report-access', passwordUpdateLimiter);
app.use('/auth/refresh', refreshLimiter);
app.use('/crm/deals/solution', passwordResetLimiter);
app.use('/profile/password', passwordUpdateLimiter);
app.use('/auth', authRoutes);
app.use('/analytics/events', analyticsLimiter);
app.use('/analytics', analyticsRoutes);
app.use('/reports', reportsRoutes);
app.use('/audit', auditRoutes);
// Só a senha (POST) tem o limite apertado; a consulta de versão do launcher logado (GET) não
app.use('/downloads/launcher', (req, res, next) => (req.method === 'POST' ? launcherLimiter(req, res, next) : next()));
app.use('/downloads', downloadsRoutes);
app.use('/contacts', contactRoutes);
app.use('/panels', panelRoutes);
app.use('/localidades', localidadesRoutes);
app.use('/assistente', assistenteRoutes);
app.use('/banners', bannerRoutes); 
app.use('/solution', solutionRoutes);
app.use('/institutional', institutionalRoutes); 
app.use('/upload', uploadRoutes);
app.use('/users', userRoutes);
app.use('/mail-accounts', mailAccountRoutes);
app.use('/orders', orderRoutes);
app.use('/crm', crmRoutes);
app.use('/chat', chatRoutes);
app.use('/agenda', agendaRoutes);
app.use('/meetings', meetingRoutes);
app.use('/coupons', couponRoutes);
app.use('/pricing', pricingRoutes);
app.use('/profile', profileRoutes);

/**
 * 404 Fallback Handler.
 * Intercepts requests that do not match any registered routes.
 */
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

/**
 * Global Error Handling Middleware.
 * Processes exceptions thrown during request execution, standardizing response formats for client consumption.
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

    if (err instanceof Error && err.message === 'Formato inválido. Envie imagens (JPG, PNG, WebP) ou documentos (PDF, DOC, DOCX).') {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof Error && err.message === 'Painel não encontrado.') {
        return res.status(404).json({ error: err.message });
    }

    if (err instanceof PricingError) {
        return res.status(400).json({ error: err.message });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    // FK restrita: o registro ainda é usado em outro lugar (ex.: painel presente em pedidos ou negócios)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        return res.status(409).json({ error: 'Este registro está ligado a pedidos ou negócios e não pode ser excluído. Mude a situação em vez de excluir.' });
    }

    console.error(err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
});

export default app;