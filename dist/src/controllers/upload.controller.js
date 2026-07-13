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
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Nenhuma imagem foi enviada' });
            }
            // 🛠️ MOTOR DE OTIMIZAÇÃO (SHARP)
            // Interceptamos o buffer original e transformamos em 16:9 WebP
            const processedBuffer = await (0, sharp_1.default)(req.file.buffer)
                .resize({
                width: 1280,
                height: 720,
                fit: 'cover',
                position: 'center'
            })
                .webp({ quality: 80 })
                .toBuffer();
            // 📦 PREPARANDO OS NOVOS METADADOS
            // Como convertemos para WebP, precisamos avisar o seu Storage Service
            const timestamp = Date.now();
            const newFileName = `painel-${timestamp}.webp`; // Nome padronizado e seguro
            const newMimetype = 'image/webp';
            // Passamos o buffer OTIMIZADO e os novos dados para o seu serviço
            const url = await storageService.uploadImage(processedBuffer, newFileName, newMimetype);
            return res.status(200).json({ url });
        }
        catch (error) {
            console.error('Erro ao processar/fazer upload da imagem:', error);
            return res.status(500).json({ error: 'Erro interno ao processar a imagem.' });
        }
    }
}
exports.UploadController = UploadController;
