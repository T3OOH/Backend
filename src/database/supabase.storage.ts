import { randomUUID } from 'node:crypto';
import { supabase } from '../database/supabase';

export class SupabaseStorageService {
    async uploadFile(
        fileBuffer: Buffer, 
        mimeType: string, 
        extension: string, 
        bucketName: string
    ): Promise<string> {
        // Agora o nome do arquivo respeita a extensão correta (pdf, docx, webp)
        const fileName = `${randomUUID()}.${extension}`;

        // Agora usamos o bucketName dinâmico que o frontend enviar
        const { error } = await supabase.storage
            .from(bucketName)
            .upload(fileName, fileBuffer, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) {
            throw new Error(`Falha no upload: ${error.message}`);
        }

        const { data } = supabase.storage
            .from(bucketName)
            .getPublicUrl(fileName);

        return data.publicUrl;
    }
}