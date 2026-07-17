"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const multer_1 = __importDefault(require("multer"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const env_1 = require("./config/env");
const auth_routes_1 = require("./routes/auth.routes");
const contact_routes_1 = require("./routes/contact.routes");
const panel_routes_1 = require("./routes/panel.routes");
const upload_routes_1 = require("./routes/upload.routes");
const app = (0, express_1.default)();
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
});
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.disable('x-powered-by');
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: env_1.env.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
}));
app.use(express_1.default.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', auth_routes_1.authRoutes);
app.use('/api/contacts', contact_routes_1.contactRoutes);
app.use('/api/panels', panel_routes_1.panelRoutes);
app.use('/api/upload', upload_routes_1.uploadRoutes);
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, _req, res, _next) => {
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            error: 'Dados inválidos.',
            details: err.issues,
        });
    }
    if (err instanceof multer_1.default.MulterError) {
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
exports.default = app;
