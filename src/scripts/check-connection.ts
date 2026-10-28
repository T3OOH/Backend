/**
 * Diagnóstico de conexão: banco (Prisma), Storage (Supabase) e migrações.
 * Uso: npm run db:check
 */
import { env } from '../config/env';
import { prisma } from '../database/prisma';
import { supabase } from '../database/supabase';

const ok = (msg: string) => console.log(`  OK    ${msg}`);
const fail = (msg: string) => console.log(`  ERRO  ${msg}`);

async function main() {
    let failures = 0;
    console.log(`\nT3 OOH — diagnóstico (${env.NODE_ENV})\n`);

    // 1. Banco de dados
    try {
        const [users, panels, orders] = await Promise.all([
            prisma.user.count(),
            prisma.panel.count(),
            prisma.order.count(),
        ]);
        ok(`Banco conectado: ${users} usuários, ${panels} painéis, ${orders} pedidos`);
    } catch (error) {
        failures++;
        fail(`Banco: ${(error as Error).message.split('\n')[0]}`);
    }

    // 2. Migrações registradas
    try {
        const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
            select migration_name from "_prisma_migrations"
            where finished_at is not null and rolled_back_at is null
            order by migration_name`;
        ok(`Migrações aplicadas: ${rows.map((r) => r.migration_name).join(', ') || 'nenhuma'}`);
    } catch (error) {
        failures++;
        fail(`Migrações: ${(error as Error).message.split('\n')[0]}`);
    }

    // 3. Storage
    try {
        const { data, error } = await supabase.storage.getBucket(env.SUPABASE_BUCKET);
        if (error) throw error;
        const limitMb = data.file_size_limit ? `${data.file_size_limit / 1024 / 1024} MB` : 'sem limite';
        ok(`Storage: bucket "${data.name}" (${data.public ? 'público' : 'privado'}, ${limitMb})`);
    } catch (error) {
        failures++;
        fail(`Storage: ${(error as Error).message}`);
    }

    // 4. Integrações opcionais
    console.log(`  ${process.env.RECAPTCHA_SECRET_KEY ? 'OK  ' : 'AVISO'}  reCAPTCHA ${process.env.RECAPTCHA_SECRET_KEY ? 'configurado' : 'sem RECAPTCHA_SECRET_KEY (login e cadastro vão falhar)'}`);
    console.log(`  ${process.env.RESEND_API_KEY ? 'OK  ' : 'AVISO'}  E-mail ${process.env.RESEND_API_KEY ? 'configurado' : 'sem RESEND_API_KEY (recuperação de senha indisponível)'}`);

    console.log(failures ? `\n${failures} verificação(ões) falharam.\n` : '\nTudo conectado.\n');
    process.exitCode = failures ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
