"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const app_1 = __importDefault(require("./app"));
const auth_routes_1 = require("./routes/auth.routes");
dotenv_1.default.config();
const PORT = process.env.PORT || 3333;
// LIGANDO AS ROTAS DE AUTENTICAÇÃO AQUI
app_1.default.use('/api/auth', auth_routes_1.authRoutes);
const server = app_1.default.listen(PORT, () => {
    console.log(`🚀 [T3 OOH Backend]: Servidor rodando na porta ${PORT}`);
    console.log(`🔒 [Segurança]: Helmet, CORS e Rate Limit ativados.`);
});
// Tratamento de encerramento gracioso (Graceful Shutdown)
process.on('SIGINT', () => {
    console.log('Encerrando servidor de forma segura...');
    server.close(() => {
        process.exit(0);
    });
});
