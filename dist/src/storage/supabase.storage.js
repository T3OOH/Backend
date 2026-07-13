"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseStorageService = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
class SupabaseStorageService {
    async uploadImage(fileBuffer, fileName, mimeType) {
        const uniqueFileName = `${Date.now()}-${fileName.replace(/\s/g, '_')}`;
        const { data, error } = await supabase.storage
            .from('t3-images')
            .upload(`panels/${uniqueFileName}`, fileBuffer, {
            contentType: mimeType,
            upsert: false
        });
        if (error) {
            throw new Error(`Erro ao fazer upload: ${error.message}`);
        }
        const { data: publicUrlData } = supabase.storage
            .from('t3-images')
            .getPublicUrl(`panels/${uniqueFileName}`);
        return publicUrlData.publicUrl;
    }
}
exports.SupabaseStorageService = SupabaseStorageService;
