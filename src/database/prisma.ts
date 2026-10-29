import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

const connectionString = env.DATABASE_URL;

// O SEGREDO ESTÁ AQUI 👇
// Adicionamos a configuração de SSL. Sem isso, o Supabase fecha a porta e dá ECONNREFUSED.
const pool = new Pool({ 
    connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    // Mantém as conexões abertas entre visitas: abrir uma nova (TLS até o Supabase) custava segundos
    keepAlive: true,
    idleTimeoutMillis: 5 * 60_000,
    connectionTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Agora o PrismaClient recebe exatamente o adapter que ele está exigindo!
export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
