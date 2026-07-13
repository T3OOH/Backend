import { Request, Response } from 'express';
import sharp from 'sharp';
import { SupabaseStorageService } from '../storage/supabase.storage';

const storageService = new SupabaseStorageService();

export class UploadController {
    async uploadImage(req: Request, res: Response) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
        }

        const processedBuffer = await sharp(req.file.buffer)
            .rotate()
            .resize({
                width: 1280,
                height: 720,
                fit: 'cover',
                position: 'center',
                withoutEnlargement: true,
            })
            .webp({ quality: 80 })
            .toBuffer();

        const url = await storageService.uploadImage(processedBuffer, 'image/webp');
        return res.status(201).json({ url });
    }
}
