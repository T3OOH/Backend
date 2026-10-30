import http from 'http';
import app from './app';
import { env } from './config/env';
import { prisma } from './database/prisma';
import { initWebSocket } from './websocket';
import { PanelService } from './services/panel.service';
import { audit, captureConsoleErrors, pruneAuditLogs, syncRepositories } from './services/audit.service';

// Erros da API (console.error, falhas não tratadas) entram no registro de auditoria
captureConsoleErrors();
process.on('unhandledRejection', (reason) => console.error('[Sistema] Promise rejeitada sem tratamento:', reason));
process.on('uncaughtException', (error) => {
    console.error('[Sistema] Exceção não tratada:', error);
    // Dá tempo de gravar o registro antes de encerrar
    setTimeout(() => process.exit(1), 1500).unref();
});

const httpServer = http.createServer(app);

initWebSocket(httpServer);

httpServer.listen(env.PORT, () => {
    console.log(`[T3 OOH Backend] Servidor rodando na porta ${env.PORT}.`);
    // Aquece conexão com o banco e o cache dos painéis antes da primeira visita
    const panels = new PanelService();
    Promise.all([panels.getAllPanels({}), panels.getMapMarkers()])
        .then(() => console.log('[T3 OOH Backend] Cache de painéis pronto.'))
        .catch((error) => console.error('[T3 OOH Backend] Falha ao aquecer o cache:', error));

    void audit.write({ source: 'api', action: 'deploy', level: 'info', summary: 'API iniciada (deploy ou reinício)', entity: 'servidor' });
    // Repositório a cada 15 min e limpeza do registro uma vez por dia
    const syncRepos = () => syncRepositories().catch((error) => console.error('[Audit] Falha ao ler o repositório:', error));
    syncRepos();
    setInterval(syncRepos, 15 * 60_000).unref();
    void pruneAuditLogs();
    setInterval(() => void pruneAuditLogs(), 24 * 60 * 60_000).unref();
});

function shutdown() {
    console.log('[Sistema] Encerrando servidor de forma segura...');
    httpServer.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);