"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const env_1 = require("../config/env");
const connectionString = env_1.env.DATABASE_URL;
// O SEGREDO ESTÁ AQUI 👇
// Adicionamos a configuração de SSL. Sem isso, o Supabase fecha a porta e dá ECONNREFUSED.
const pool = new pg_1.Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const globalForPrisma = global;
// Agora o PrismaClient recebe exatamente o adapter que ele está exigindo!
exports.prisma = globalForPrisma.prisma || new client_1.PrismaClient({ adapter });
if (env_1.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = exports.prisma;
