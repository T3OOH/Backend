"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseStorageService = void 0;
const node_crypto_1 = require("node:crypto");
const supabase_1 = require("../database/supabase");
const env_1 = require("../config/env");
class SupabaseStorageService {
    async uploadImage(fileBuffer, mimeType) {
        const path = `panels/${(0, node_crypto_1.randomUUID)()}.webp`;
        const { error } = await supabase_1.supabase.storage
            .from(env_1.env.SUPABASE_BUCKET)
            .upload(path, fileBuffer, {
            contentType: mimeType,
            upsert: false,
        });
        if (error) {
            throw new Error(`Falha no upload: ${error.message}`);
        }
        const { data } = supabase_1.supabase.storage
            .from(env_1.env.SUPABASE_BUCKET)
            .getPublicUrl(path);
        return data.publicUrl;
    }
}
exports.SupabaseStorageService = SupabaseStorageService;
