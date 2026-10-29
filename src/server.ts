import http from 'http';
import app from './app';
import { env } from './config/env';
import { prisma } from './database/prisma';
import { initWebSocket } from './websocket';
import { PanelService } from './services/panel.service';

const httpServer = http.createServer(app);

initWebSocket(httpServer);

httpServer.listen(env.PORT, () => {
    console.log(`[T3 OOH Backend] Servidor rodando na porta ${env.PORT}.`);
    // Aquece conexão com o banco e o cache dos painéis antes da primeira visita
    const panels = new PanelService();
    Promise.all([panels.getAllPanels({}), panels.getMapMarkers()])
        .then(() => console.log('[T3 OOH Backend] Cache de painéis pronto.'))
        .catch((error) => console.error('[T3 OOH Backend] Falha ao aquecer o cache:', error));
});

function shutdown() {
    console.log('[Sistema] Encerrando servidor de forma segura...');
    httpServer.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);