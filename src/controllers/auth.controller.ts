import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import axios from 'axios';
import { createHash } from 'node:crypto';

import { prisma } from '../database/prisma';
import { env } from '../config/env';
import { loginSchema, registerSchema } from '../validators/auth.validator';

// Cliente de e-mail criado apenas quando a chave existe (sem ela o servidor ainda sobe)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// t3ooh.com está verificado no Resend: o remetente padrão já é do domínio
const EMAIL_FROM = process.env.RESEND_FROM || 'T3 OOH <nao-responda@t3ooh.com>';

/*
 * Avisos de configuração da recuperação de senha (aparecem no log ao subir o servidor).
 * O remetente de teste do Resend (onboarding@resend.dev) só entrega para o e-mail do dono
 * da conta Resend: em produção o remetente precisa ser de um domínio verificado.
 */
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    if (!process.env.RESEND_API_KEY) console.warn('[auth] RESEND_API_KEY ausente: a recuperação de senha não envia e-mails.');
    if (EMAIL_FROM.includes('resend.dev')) console.warn('[auth] RESEND_FROM não configurado: o remetente de teste só entrega para o dono da conta Resend.');
    if (/localhost|127\.0\.0\.1/.test(env.FRONTEND_URL)) console.warn('[auth] FRONTEND_URL aponta para localhost: o link do e-mail não abre para o cliente.');
}

/** E-mail de recuperação no padrão visual do site (tabelas e estilos inline para clientes de e-mail). */
function resetEmail(name: string, link: string) {
    const first = (name || '').trim().split(/\s+/)[0] || 'olá';
    const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#0B0B0C;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0C;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111113;border:1px solid #2A2A2E;">
      <tr><td style="padding:28px 32px;border-bottom:1px solid #2A2A2E;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#ECECEE;">
        t<span style="color:#FF5E00;">3</span> <span style="font-size:11px;letter-spacing:3px;color:#8E8E93;font-weight:normal;">OOH</span>
      </td></tr>
      <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#B4B4B9;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#8E8E93;">Recuperação de senha</p>
        <h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;font-weight:normal;color:#ECECEE;text-transform:uppercase;">Crie uma nova senha</h1>
        <p style="margin:0 0 24px;">${first.charAt(0).toUpperCase() + first.slice(1)}, recebemos um pedido para redefinir a senha da sua conta na T3 OOH. O link vale por <strong style="color:#ECECEE;">15 minutos</strong> e funciona uma única vez.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#FF5E00;">
          <a href="${link}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0B0B0C;text-decoration:none;">Criar nova senha</a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:13px;color:#8E8E93;">Se o botão não abrir, copie este endereço no navegador:<br><a href="${link}" style="color:#FF5E00;word-break:break-all;">${link}</a></p>
        <p style="margin:24px 0 0;font-size:13px;color:#8E8E93;">Não pediu? Ignore este e-mail: sua senha continua a mesma.</p>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #2A2A2E;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6E6E73;">T3 OOH · Mídia exterior em Goiânia e região</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    const text = `Recuperação de senha - T3 OOH

Recebemos um pedido para redefinir a senha da sua conta.
Abra o link abaixo para criar uma nova senha (vale por 15 minutos e funciona uma única vez):

${link}

Não pediu? Ignore este e-mail: sua senha continua a mesma.`;
    return { html, text };
}

function toPublicUser(user: {
    id: string;
    name: string;
    email: string;
    role: Role;
}) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
    };
}

/** Impressão digital curta do hash da senha, usada para invalidar links de reset já usados. */
function passwordFingerprint(passwordHash: string) {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

// ==========================================
// FUNÇÃO DE VALIDAÇÃO DO RECAPTCHA
// ==========================================
async function verifyReCaptcha(token: string): Promise<boolean> {
    if (!token) return false;
    
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
        console.error('AVISO: RECAPTCHA_SECRET_KEY não encontrada no arquivo .env do backend!');
        return false; 
    }

    try {
        // Segredo enviado no corpo (form-urlencoded), nunca na URL
        const response = await axios.post(
            'https://www.google.com/recaptcha/api/siteverify',
            new URLSearchParams({ secret: secretKey, response: String(token) }),
            { timeout: 5000 }
        );
        return response.data.success === true;
    } catch (error) {
        console.error("Erro na comunicação com a API do reCAPTCHA:", error);
        return false;
    }
}

export const authController = {
    // ==========================================
    // LOGIN COM RECAPTCHA
    // ==========================================
    async login(req: Request, res: Response) {
        const { captchaToken, email, password } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ error: 'Captcha obrigatório. Confirme que você não é um robô.' });
        }

        const isCaptchaValid = await verifyReCaptcha(captchaToken);
        if (!isCaptchaValid) {
            return res.status(400).json({ error: 'Falha na verificação do Captcha. Tente novamente.' });
        }

        // CORREÇÃO AQUI: Passamos um objeto limpo apenas com o que o Zod espera, ignorando o captchaToken
        const validatedData = loginSchema.parse({ email, password });

        const user = await prisma.user.findUnique({ where: { email: validatedData.email } });

        if (!user || !(await bcrypt.compare(validatedData.password, user.password))) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            { role: user.role },
            env.JWT_SECRET,
            {
                algorithm: 'HS256',
                subject: user.id,
                expiresIn: '1h',
            },
        );

        return res.json({
            user: toPublicUser(user),
            token,
        });
    },

    // ==========================================
    // REGISTER COM RECAPTCHA
    // ==========================================
    async register(req: Request, res: Response) {
        const { captchaToken, name, email, password, phone, document, personType, companyName } = req.body ?? {};

        if (!captchaToken) {
            return res.status(400).json({ error: 'Captcha obrigatório. Confirme que você não é um robô.' });
        }

        const isCaptchaValid = await verifyReCaptcha(captchaToken);
        if (!isCaptchaValid) {
            return res.status(400).json({ error: 'Falha na verificação do Captcha. Tente novamente.' });
        }

        // CORREÇÃO AQUI: Passamos um objeto limpo para o Zod
        const validatedData = registerSchema.parse({ name, email, password, phone, document, personType, companyName });

        try {
            const user = await prisma.user.create({
                data: {
                    name: validatedData.name,
                    email: validatedData.email,
                    password: await bcrypt.hash(validatedData.password, 12),
                    phone: validatedData.phone || null,
                    document: validatedData.document || null,
                    personType: validatedData.personType ?? 'PF',
                    companyName: validatedData.personType === 'PJ' ? validatedData.companyName || null : null,
                    // O perfil é sempre definido pelo servidor, nunca pelo cliente
                    role: Role.USER,
                },
            });

            return res.status(201).json({
                message: 'Conta criada com sucesso.',
                user: toPublicUser(user),
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                return res.status(409).json({ error: 'Este e-mail já está em uso.' });
            }
            throw error;
        }
    },

    // ==========================================
    // ROTAS DE RECUPERAÇÃO DE SENHA (MANTIDAS)
    // ==========================================
    async forgotPassword(req: Request, res: Response) {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

        if (!email) {
            return res.status(400).json({ error: 'O e-mail é obrigatório.' });
        }

        const genericResponse = { message: 'Se o e-mail estiver cadastrado, enviaremos o link de recuperação.' };
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

        if (!user) {
            return res.json(genericResponse);
        }

        // "pwd" amarra o token ao hash atual: depois que a senha muda, o link deixa de valer
        const resetToken = jwt.sign(
            { id: user.id, purpose: 'reset-password', pwd: passwordFingerprint(user.password) },
            env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '15m' }
        );

        const resetLink = `${env.FRONTEND_URL.replace(/\/$/, '')}/atualizar-senha?token=${encodeURIComponent(resetToken)}`;

        try {
            if (!resend) {
                console.error('AVISO: RESEND_API_KEY não configurada; e-mail de recuperação não enviado.');
                return res.status(503).json({ error: 'A recuperação por e-mail está indisponível no momento. Fale com o comercial pelo WhatsApp para recuperar o acesso.' });
            }

            const { html, text } = resetEmail(user.name, resetLink);
            const { error } = await resend.emails.send({
                from: EMAIL_FROM,
                to: user.email,
                subject: 'Crie uma nova senha · T3 OOH',
                html,
                text,
            });
            // O SDK do Resend devolve o erro (domínio não verificado, chave inválida...) em vez de lançar
            if (error) throw Object.assign(new Error(error.message), { resend: error });

            return res.json(genericResponse);
        } catch (error) {
            console.error('[auth] Falha ao enviar e-mail de recuperação:', (error as { resend?: unknown }).resend ?? error);
            return res.status(502).json({ error: 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos ou fale com o comercial.' });
        }
    },

    async resetPassword(req: Request, res: Response) {
        const { token, password } = req.body ?? {};

        if (!token || !password) {
            return res.status(400).json({ error: 'Token e senha são obrigatórios.' });
        }

        // Mesma política de senha do cadastro
        const passwordCheck = registerSchema.shape.password.safeParse(password);
        if (!passwordCheck.success) {
            return res.status(400).json({ error: passwordCheck.error.issues[0]?.message ?? 'Senha inválida.' });
        }

        try {
            const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { id: string, purpose: string, pwd?: string };

            if (decoded.purpose !== 'reset-password') {
                throw new Error('Token inválido.');
            }

            const current = await prisma.user.findUnique({ where: { id: decoded.id }, select: { password: true } });
            if (!current || decoded.pwd !== passwordFingerprint(current.password)) {
                throw new Error('Token já utilizado.');
            }

            const hashedPassword = await bcrypt.hash(password, 12);

            await prisma.user.update({
                where: { id: decoded.id },
                data: { password: hashedPassword }
            });

            return res.json({ message: 'Senha atualizada com sucesso.' });
        } catch (error) {
            return res.status(401).json({ error: 'O link de recuperação é inválido ou expirou.' });
        }
    }
};