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
const EMAIL_FROM = process.env.RESEND_FROM || 'T3 OOH System <onboarding@resend.dev>';

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
        const user = await prisma.user.findUnique({ where: { email } });

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
                return res.status(503).json({ error: 'Recuperação de senha indisponível no momento.' });
            }

            await resend.emails.send({
                from: EMAIL_FROM,
                to: user.email, 
                subject: 'Recuperação de Senha - T3 OOH',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #111113; color: #fff; padding: 40px; border-radius: 16px;">
                        <h2 style="color: #FF5E00;">Recuperação de Senha</h2>
                        <p style="color: #8F8F91;">Você solicitou a recuperação de senha. Clique no botão abaixo para criar uma nova:</p>
                        <a href="${resetLink}" style="display: inline-block; background-color: #FF5E00; color: #0A0A0B; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Redefinir minha senha</a>
                        <p style="color: #8F8F91; font-size: 12px;">Este link expira em 15 minutos.</p>
                    </div>
                `
            });

            return res.json(genericResponse);
        } catch (error) {
            console.error('Erro Resend:', error);
            return res.status(500).json({ error: 'Erro ao disparar o e-mail.' });
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