"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = require("./config/env");
const prisma_1 = require("./database/prisma");
const server = app_1.default.listen(env_1.env.PORT, () => {
    console.log(`[T3 OOH Backend] Servidor rodando na porta ${env_1.env.PORT}.`);
});
function shutdown() {
    console.log('Encerrando servidor de forma segura...');
    server.close(() => {
        void prisma_1.prisma.$disconnect().finally(() => process.exit(0));
    });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
