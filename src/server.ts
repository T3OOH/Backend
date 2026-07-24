import http from 'http';
import app from './app';
import { env } from './config/env';
import { prisma } from './database/prisma';
import { initWebSocket } from './websocket';

const httpServer = http.createServer(app);

initWebSocket(httpServer);

httpServer.listen(env.PORT, () => {
    console.log(`[T3 OOH Backend] Servidor rodando na porta ${env.PORT}.`);
});

function shutdown() {
    console.log('[Sistema] Encerrando servidor de forma segura...');
    httpServer.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);