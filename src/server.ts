import app from './app';
import { env } from './config/env';
import { prisma } from './database/prisma';

const server = app.listen(env.PORT, () => {
    console.log(`[T3 OOH Backend] Servidor rodando na porta ${env.PORT}.`);
});

function shutdown() {
    console.log('Encerrando servidor de forma segura...');
    server.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
