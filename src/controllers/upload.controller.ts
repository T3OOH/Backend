import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../database/supabase';
import { env } from '../config/env';

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/**
 * Normaliza a pasta de destino no bucket.
 * Aceita até 3 segmentos alfanuméricos (ex.: "team", "Brands", "panels/<id>"); qualquer
 * outra coisa (como "..", barras extras ou caracteres especiais) cai em "avulsos".
 */
function sanitizeFolder(raw: unknown) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return 'avulsos';

    const segments = value.split('/').filter(Boolean);
    const isValid = segments.length > 0
        && segments.length <= 3
        && segments.every((segment) => /^[A-Za-z0-9_-]{1,64}$/.test(segment));

    return isValid ? segments.join('/') : 'avulsos';
}

export class UploadController {
    async uploadImage(req: Request, res: Response) {
        // 1. Verifica se o middleware capturou o arquivo
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }

        try {
            const fileBuffer = req.file.buffer;
            const mimeType = req.file.mimetype;
            const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';

            // 2. Pasta de destino informada pelo frontend (via query params), já sanitizada
            const folderId = sanitizeFolder(req.query.folderId);
            const path = `${folderId}/${randomUUID()}.${extension}`;

            // 3. Faz o upload do Buffer direto para o Supabase
            const { error } = await supabase.storage
                .from(env.SUPABASE_BUCKET)
                .upload(path, fileBuffer, {
                    contentType: mimeType,
                    upsert: false,
                });

            if (error) {
                throw new Error(`Falha no upload para o Supabase: ${error.message}`);
            }

            // 4. Recupera a URL pública definitiva
            const { data } = supabase.storage
                .from(env.SUPABASE_BUCKET)
                .getPublicUrl(path);

            // 5. Retorna a URL para o frontend salvar no banco de dados
            return res.status(200).json({ url: data.publicUrl });

        } catch (error: any) {
            console.error('Erro no UploadController:', error);
            return res.status(500).json({ message: 'Erro interno ao processar o upload.' });
        }
    }
}
