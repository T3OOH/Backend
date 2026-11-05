import { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { audit } from '../services/audit.service';
import {
    HostingerMailError, LOCAL_PART_RE, createMailbox, hostingerMailEnabled, listMailboxes, localPartFromName, temporaryPassword,
} from '../services/hostinger-mail.service';
import { mailEnabled, mailboxWelcomeEmail, sendMail } from '../services/mail.service';

const WEBMAIL_URL = 'https://mail.hostinger.com';

const createSchema = z.object({
    // Nome da pessoa ou da área ("Felipe Rabello", "Financeiro")
    name: z.string().trim().min(2, 'Informe o nome da pessoa ou da área.').max(80),
    // E-mail pessoal que recebe o endereço novo e a senha inicial
    personalEmail: z.string().trim().toLowerCase().email('E-mail pessoal inválido.').max(160),
    // Opcional: parte antes do @ escolhida pelo gestor; sem ela, vem do nome
    localPart: z.string().trim().toLowerCase().max(50).regex(LOCAL_PART_RE, 'Use só letras, números, ponto, hífen e sublinhado.').optional(),
}).strict();

function fail(res: Response, error: unknown, fallback: string) {
    if (error instanceof HostingerMailError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error(fallback, error);
    return res.status(500).json({ error: fallback });
}

export const mailAccountController = {
    /** Situação da integração (o app mostra o aviso quando está desligada). */
    status(_req: Request, res: Response) {
        return res.json({ enabled: hostingerMailEnabled() && mailEnabled, domain: env.MAIL_DOMAIN });
    },

    async index(_req: Request, res: Response) {
        try {
            const mailboxes = await listMailboxes();
            return res.json(mailboxes.sort((a, b) => a.address.localeCompare(b.address)));
        } catch (error) {
            return fail(res, error, 'Erro ao listar as caixas de e-mail.');
        }
    },

    /**
     * Cria a caixa na Hostinger com senha aleatória e manda os dados para o e-mail pessoal.
     * A senha não é gravada nem registrada em lugar nenhum; só volta na resposta se o e-mail falhar,
     * para o gestor repassar.
     */
    async store(req: Request, res: Response) {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.', details: parsed.error.issues });
        }
        if (!hostingerMailEnabled() || !mailEnabled) {
            return res.status(503).json({ error: 'Criação de e-mails não configurada no servidor.', code: 'MAIL_DISABLED' });
        }
        const { name, personalEmail } = parsed.data;
        const localPart = parsed.data.localPart ?? localPartFromName(name);
        if (!LOCAL_PART_RE.test(localPart)) {
            return res.status(400).json({ error: 'Não deu para montar o endereço a partir do nome. Informe o endereço manualmente.' });
        }
        if (personalEmail.endsWith(`@${env.MAIL_DOMAIN}`)) {
            return res.status(400).json({ error: `Informe um e-mail pessoal, fora de @${env.MAIL_DOMAIN}.` });
        }

        const password = temporaryPassword();
        let mailbox;
        try {
            mailbox = await createMailbox(localPart, password);
        } catch (error) {
            return fail(res, error, 'Erro ao criar a caixa de e-mail.');
        }

        let emailSent = true;
        try {
            await sendMail(personalEmail, 'Seu e-mail da T3 está pronto', mailboxWelcomeEmail(name, mailbox.address, password, WEBMAIL_URL));
        } catch (error) {
            emailSent = false;
            console.error('[mail] Falha ao enviar boas-vindas da caixa:', (error as { resend?: unknown }).resend ?? error);
        }

        await audit.write({
            source: 'api',
            action: 'create',
            entity: 'mailbox',
            entityId: mailbox.id,
            level: emailSent ? 'info' : 'warning',
            summary: `Caixa de e-mail ${mailbox.address} criada para ${name}${emailSent ? `; dados enviados para ${personalEmail}` : '; o e-mail com os dados falhou'}`,
            changes: { address: mailbox.address, name, personalEmail, emailSent },
        });

        return res.status(201).json({
            mailbox,
            emailSent,
            // Só quando o envio falhou: o gestor precisa repassar a senha de outro jeito
            ...(emailSent ? {} : { temporaryPassword: password }),
        });
    },
};
