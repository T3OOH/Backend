import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { DesktopReleaseError, desktopDownloadLink, latestDesktopRelease, launcherDownloadLink, launcherRelease } from '../services/desktop-release.service';
import { audit } from '../services/audit.service';

/** Compara a senha sem vazar, pelo tempo de resposta, quantos caracteres acertou. */
export function senhaConfere(digitada: unknown, esperada: string | undefined): boolean {
    if (!esperada || typeof digitada !== 'string' || !digitada) return false;
    const a = createHash('sha256').update(digitada).digest();
    const b = createHash('sha256').update(esperada).digest();
    return timingSafeEqual(a, b);
}

function fail(res: Response, error: unknown, fallback: string) {
    if (error instanceof DesktopReleaseError) return res.status(error.status).json({ error: error.message });
    // GitHub não respondeu no prazo (AbortSignal.timeout)
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        console.error(fallback, 'GitHub não respondeu no prazo');
        return res.status(502).json({ error: 'O GitHub não respondeu a tempo. Tente de novo em instantes.' });
    }
    console.error(fallback, error);
    return res.status(500).json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' });
}

export const downloadsController = {
    /** Versão atual do app desktop da equipe e os arquivos disponíveis. */
    async desktop(_req: Request, res: Response) {
        try {
            return res.json(await latestDesktopRelease());
        } catch (error) {
            return fail(res, error, '[Desktop] Release:');
        }
    },

    /**
     * T3 Launcher pela área de download do site: sem login, protegido por senha (conferida aqui,
     * no servidor) e com limite de tentativas por IP (app.ts). Devolve um link temporário.
     */
    async launcher(req: Request, res: Response) {
        if (!env.LAUNCHER_DOWNLOAD_PASSWORD) {
            return res.status(503).json({ error: 'O download do launcher ainda não foi configurado no servidor.' });
        }
        if (!senhaConfere(req.body?.senha, env.LAUNCHER_DOWNLOAD_PASSWORD)) {
            void audit.write({ source: 'api', action: 'download', level: 'warning', entity: 'launcher', entityId: 'senha', summary: 'Senha errada no download do launcher' });
            return res.status(401).json({ error: 'Senha incorreta.' });
        }
        try {
            const link = await launcherDownloadLink();
            void audit.write({ source: 'api', action: 'download', level: 'info', entity: 'launcher', entityId: link.name, summary: 'Download do T3 Launcher (área com senha)' });
            return res.json({ ...link, expiresIn: 300 });
        } catch (error) {
            return fail(res, error, '[Desktop] Launcher:');
        }
    },

    /** Versão publicada do T3 Launcher, para ele se atualizar sozinho (só a equipe logada). */
    async launcherVersion(_req: Request, res: Response) {
        try {
            const { version, name, size, sha256 } = await launcherRelease();
            return res.json({ version, name, size, sha256 });
        } catch (error) {
            return fail(res, error, '[Desktop] Versão do launcher:');
        }
    },

    /** Link temporário do zip do launcher para a atualização automática dele (só a equipe logada). */
    async launcherUpdateLink(_req: Request, res: Response) {
        try {
            const link = await launcherDownloadLink();
            void audit.write({ source: 'api', action: 'download', level: 'info', entity: 'launcher', entityId: link.name, summary: 'Atualização automática do T3 Launcher' });
            return res.json({ ...link, expiresIn: 300 });
        } catch (error) {
            return fail(res, error, '[Desktop] Atualização do launcher:');
        }
    },

    /** Link temporário para baixar um arquivo da versão atual (fica no registro de auditoria). */
    async desktopLink(req: Request, res: Response) {
        const fileId = Number(req.params.fileId);
        if (!Number.isSafeInteger(fileId) || fileId <= 0) {
            return res.status(400).json({ error: 'Arquivo inválido.' });
        }
        try {
            const url = await desktopDownloadLink(fileId);
            void audit.write({ source: 'api', action: 'download', level: 'info', entity: 'app desktop', entityId: String(fileId), summary: 'Download do app desktop' });
            return res.json({ url, expiresIn: 300 });
        } catch (error) {
            return fail(res, error, '[Desktop] Link:');
        }
    },
};
