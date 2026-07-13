import { randomUUID } from 'node:crypto';
import { supabase } from '../database/supabase';
import { env } from '../config/env';

export class SupabaseStorageService {
    async uploadImage(fileBuffer: Buffer, mimeType: string): Promise<string> {
        const path = `panels/${randomUUID()}.webp`;

        const { error } = await supabase.storage
            .from(env.SUPABASE_BUCKET)
            .upload(path, fileBuffer, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) {
            throw new Error(`Falha no upload: ${error.message}`);
        }

        const { data } = supabase.storage
            .from(env.SUPABASE_BUCKET)
            .getPublicUrl(path);

        return data.publicUrl;
    }
}
