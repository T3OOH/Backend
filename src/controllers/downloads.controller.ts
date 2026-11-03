import { Request, Response } from 'express';
import { DesktopReleaseError, desktopDownloadLink, latestDesktopRelease } from '../services/desktop-release.service';
import { audit } from '../services/audit.service';

function fail(res: Response, error: unknown, fallback: string) {
    if (error instanceof DesktopReleaseError) return res.status(error.status).json({ error: error.message });
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
