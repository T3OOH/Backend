"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoutes = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const supabase_1 = require("../database/supabase");
const uploadRoutes = (0, express_1.Router)();
exports.uploadRoutes = uploadRoutes;
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
uploadRoutes.post('/', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Nenhum arquivo foi enviado.' });
        }
        const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
        const { error } = await supabase_1.supabase.storage
            .from('panels')
            .upload(fileName, file.buffer, {
            contentType: file.mimetype,
        });
        if (error) {
            throw error;
        }
        const { data: { publicUrl } } = supabase_1.supabase.storage
            .from('panels')
            .getPublicUrl(fileName);
        return res.status(200).json({ url: publicUrl });
    }
    catch (error) {
        console.error('Erro no upload:', error);
        return res.status(500).json({ error: 'Falha ao processar a imagem.' });
    }
});
