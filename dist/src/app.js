"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const zod_1 = require("zod");
const auth_routes_1 = require("./routes/auth.routes");
const upload_routes_1 = require("./routes/upload.routes");
const panel_routes_1 = require("./routes/panel.routes");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express_1.default.json());
// Cadastro das Rotas (Organizado e sem duplicatas)
app.use('/api/auth', auth_routes_1.authRoutes);
app.use('/api/panels', panel_routes_1.panelRoutes);
app.use('/api/upload', upload_routes_1.uploadRoutes);
app.use((err, req, res, next) => {
    // Correção da propriedade para .issues
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({ error: 'Erro de Validação', details: err.issues });
    }
    if (err.message === 'Painel não encontrado') {
        return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erro Interno do Servidor' });
});
exports.default = app;
