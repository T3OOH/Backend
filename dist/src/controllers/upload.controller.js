"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadController = void 0;
const sharp_1 = __importDefault(require("sharp"));
const supabase_storage_1 = require("../storage/supabase.storage");
const storageService = new supabase_storage_1.SupabaseStorageService();
class UploadController {
    async uploadImage(req, res) {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
        }
        const processedBuffer = await (0, sharp_1.default)(req.file.buffer)
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
exports.UploadController = UploadController;
