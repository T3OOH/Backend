import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../database/supabase';
import { env } from '../config/env';

export class UploadController {
    async uploadImage(req: Request, res: Response) {
        // 1. Verifica se o middleware capturou o arquivo
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }

        try {
            // Se o arquivo não tiver buffer, é porque o multer tá salvando no disco e não na memória
            if (!req.file.buffer) {
                return res.status(500).json({ message: 'Erro de configuração do servidor: Multer deve usar memoryStorage.' });
            }

            const fileBuffer = req.file.buffer;
            const mimeType = req.file.mimetype;
            const extension = req.file.originalname.split('.').pop() || 'png';
            
            // 2. Pega o ID da pasta/painel enviado do frontend (via query params)
            // Se não vier nenhum, joga numa pasta chamada 'avulsos'
            const folderId = req.query.folderId || 'avulsos';

            // 3. Monta o caminho organizado no bucket respeitando EXATAMENTE o folderId
            // Sem forçar "panels/" no começo, para aceitar "team", "Brands" ou "panels/ID"
            const path = `${folderId}/${randomUUID()}.${extension}`;

            // 4. Faz o upload do Buffer direto para o Supabase
            const { error } = await supabase.storage
                .from(env.SUPABASE_BUCKET)
                .upload(path, fileBuffer, {
                    contentType: mimeType,
                    upsert: false,
                });

            if (error) {
                throw new Error(`Falha no upload para o Supabase: ${error.message}`);
            }

            // 5. Recupera a URL pública definitiva
            const { data } = supabase.storage
                .from(env.SUPABASE_BUCKET)
                .getPublicUrl(path);

            // 6. Retorna a URL para o frontend salvar no banco de dados
            return res.status(200).json({ url: data.publicUrl });

        } catch (error: any) {
            console.error('Erro no UploadController:', error);
            return res.status(500).json({ message: 'Erro interno ao processar o upload.' });
        }
    }
}