import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../database/supabase';
import { env } from '../config/env';

export class UploadController {
    async uploadImage(req: Request, res: Response) {
        // 1. Verifica se o middleware de upload (multer) conseguiu capturar o arquivo
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }

        try {
            // 2. Extrai os dados do arquivo gerados pelo multer (em memória)
            const fileBuffer = req.file.buffer;
            const mimeType = req.file.mimetype;
            
            // Pega a extensão original do arquivo (ex: 'jpg', 'png')
            const extension = req.file.originalname.split('.').pop() || 'png';
            
            const path = `panels/${randomUUID()}.${extension}`;

            // 3. Faz o upload para o Supabase
            const { error } = await supabase.storage
                .from(env.SUPABASE_BUCKET)
                .upload(path, fileBuffer, {
                    contentType: mimeType,
                    upsert: false,
                });

            if (error) {
                throw new Error(`Falha no upload para o Supabase: ${error.message}`);
            }

            // 4. Recupera a URL pública da imagem
            const { data } = supabase.storage
                .from(env.SUPABASE_BUCKET)
                .getPublicUrl(path);

            // 5. Retorna a URL para o frontend
            return res.status(200).json({ url: data.publicUrl });

        } catch (error: any) {
            console.error('Erro no UploadController:', error);
            return res.status(500).json({ message: 'Erro interno ao processar o upload.' });
        }
    }
}