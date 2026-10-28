/**
 * Diagnóstico de conexão: banco (Prisma), Storage (Supabase) e migrações.
 * Uso: npm run db:check
 */
import { env } from '../config/env';
import { prisma } from '../database/prisma';
import { supabase } from '../database/supabase';

const ok = (msg: string) => console.log(`  OK    ${msg}`);
const fail = (msg: string) => console.log(`  ERRO  ${msg}`);

/** Mensagem útil do erro (o adapter do Prisma às vezes traz a causa só em `cause`). */
function describe(error: unknown): string {
    const err = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const code = err?.cause?.code ?? err?.code;
    // O Prisma começa com "Invalid `prisma.x()` invocation"; a causa real fica na última linha
    const lines = (err?.message || err?.cause?.message || String(error)).split('\n').map((l) => l.trim()).filter(Boolean);
    const message = lines.at(-1) ?? 'erro desconhecido';
    const authFailed = code === '28P01' || code === 'P1000' || /authentication failed/i.test(message);
    const hint = authFailed ? ' → senha do banco incorreta (DATABASE_URL/DIRECT_URL)' : '';
    return `${code ? `[${code}] ` : ''}${message}${hint}`;
}

/** Valores ainda não preenchidos (placeholders) contam como ausentes. */
const isSet = (value?: string) => Boolean(value && !/^(COLE_AQUI|CHANGE_ME)$/i.test(value.trim()));

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
        fail(`Banco: ${describe(error)}`);
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
        fail(`Migrações: ${describe(error)}`);
    }

    // 3. Storage
    try {
        const { data, error } = await supabase.storage.getBucket(env.SUPABASE_BUCKET);
        if (error) throw error;
        const limitMb = data.file_size_limit ? `${data.file_size_limit / 1024 / 1024} MB` : 'sem limite';
        ok(`Storage: bucket "${data.name}" (${data.public ? 'público' : 'privado'}, ${limitMb})`);
    } catch (error) {
        failures++;
        const keyHint = isSet(env.SUPABASE_SERVICE_ROLE_KEY) ? '' : ' → SUPABASE_SERVICE_ROLE_KEY não preenchida';
        fail(`Storage: ${describe(error)}${keyHint}`);
    }

    // 4. Integrações opcionais
    const recaptcha = isSet(process.env.RECAPTCHA_SECRET_KEY);
    const email = isSet(process.env.RESEND_API_KEY);
    console.log(`  ${recaptcha ? 'OK  ' : 'AVISO'}  reCAPTCHA ${recaptcha ? 'configurado' : 'sem RECAPTCHA_SECRET_KEY (login e cadastro vão falhar)'}`);
    console.log(`  ${email ? 'OK  ' : 'AVISO'}  E-mail ${email ? 'configurado' : 'sem RESEND_API_KEY (recuperação de senha indisponível)'}`);

    console.log(failures ? `\n${failures} verificação(ões) falharam.\n` : '\nTudo conectado.\n');
    process.exitCode = failures ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
