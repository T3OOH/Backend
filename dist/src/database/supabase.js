"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
require("dotenv/config");
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltam as credenciais do Supabase no .env');
}
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
