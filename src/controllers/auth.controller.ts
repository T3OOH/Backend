import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import axios from 'axios'; 

import { prisma } from '../database/prisma';
import { env } from '../config/env';
import { loginSchema, registerSchema } from '../validators/auth.validator';

const resend = new Resend(process.env.RESEND_API_KEY);

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
        const response = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`
        );
        return response.data.success; 
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
        const { captchaToken, name, email, password } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ error: 'Captcha obrigatório. Confirme que você não é um robô.' });
        }

        const isCaptchaValid = await verifyReCaptcha(captchaToken);
        if (!isCaptchaValid) {
            return res.status(400).json({ error: 'Falha na verificação do Captcha. Tente novamente.' });
        }

        // CORREÇÃO AQUI: Passamos um objeto limpo para o Zod
        const validatedData = registerSchema.parse({ name, email, password });

        try {
            const user = await prisma.user.create({
                data: {
                    name: validatedData.name,
                    email: validatedData.email,
                    password: await bcrypt.hash(validatedData.password, 12),
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
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'O e-mail é obrigatório.' });
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.json({ message: 'Se o e-mail existir, o link foi enviado.' });
        }

        const resetToken = jwt.sign(
            { id: user.id, purpose: 'reset-password' },
            env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        const resetLink = `http://localhost:5173/atualizar-senha?token=${resetToken}`;

        try {
            await resend.emails.send({
                from: 'T3 OOH System <onboarding@resend.dev>',
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

            return res.json({ message: 'E-mail enviado com sucesso.' });
        } catch (error) {
            console.error('Erro Resend:', error);
            return res.status(500).json({ error: 'Erro ao disparar o e-mail.' });
        }
    },

    async resetPassword(req: Request, res: Response) {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ error: 'Token e senha são obrigatórios.' });
        }

        try {
            const decoded = jwt.verify(token, env.JWT_SECRET) as { id: string, purpose: string };

            if (decoded.purpose !== 'reset-password') {
                throw new Error('Token inválido.');
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