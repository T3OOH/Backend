import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

import { prisma } from '../database/prisma';
import { env } from '../config/env';
import { loginSchema, registerSchema } from '../validators/auth.validator';
import { readAttribution } from '../lib/attribution';
import { EMAIL_FROM, mailEnabled, passwordChangedEmail, resetEmail, sendMail, sendMailInBackground } from '../services/mail.service';
import {
    ACCESS_TTL_SECONDS, SessionError, clearLoginFailures, clientIp, describeDevice, logSecurityEvent, loginLockedFor,
    passwordFingerprint, pruneOldSessions, registerLoginFailure, revokeSession, revokeUserSessions, rotateSession, startSession,
} from '../services/session.service';


/*
 * Avisos de configuração da recuperação de senha (aparecem no log ao subir o servidor).
 * O remetente de teste do Resend (onboarding@resend.dev) só entrega para o e-mail do dono
 * da conta Resend: em produção o remetente precisa ser de um domínio verificado.
 */
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    if (!mailEnabled) console.warn('[auth] RESEND_API_KEY ausente: recuperação de senha e alertas de segurança não enviam e-mails.');
    if (EMAIL_FROM.includes('resend.dev')) console.warn('[auth] RESEND_FROM não configurado: o remetente de teste só entrega para o dono da conta Resend.');
    if (/localhost|127\.0\.0\.1/.test(env.FRONTEND_URL)) console.warn('[auth] FRONTEND_URL aponta para localhost: o link do e-mail não abre para o cliente.');
}


function toPublicUser(user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    preferences?: Prisma.JsonValue | null;
}) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        preferences: user.preferences ?? null,
    };
}


/** Resposta de login: token de acesso curto + refresh token da sessão do aparelho. */
function sessionPayload(user: Parameters<typeof toPublicUser>[0], started: { accessToken: string; refreshToken: string; session: { persistent: boolean } }) {
    return {
        user: toPublicUser(user),
        token: started.accessToken,
        refreshToken: started.refreshToken,
        expiresIn: ACCESS_TTL_SECONDS,
        persistent: started.session.persistent,
    };
}

const resetLinkFor = (user: { id: string; password: string }) => {
    // "pwd" amarra o token ao hash atual: depois que a senha muda, o link deixa de valer
    const token = jwt.sign(
        { id: user.id, purpose: 'reset-password', pwd: passwordFingerprint(user.password) },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '15m' },
    );
    return { token, link: `${env.FRONTEND_URL.replace(/\/$/, '')}/atualizar-senha?token=${encodeURIComponent(token)}` };
};

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;


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
        const { captchaToken, email, password, deviceId, remember } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ error: 'Captcha obrigatório. Confirme que você não é um robô.' });
        }

        const isCaptchaValid = await verifyReCaptcha(captchaToken);
        if (!isCaptchaValid) {
            return res.status(400).json({ error: 'Falha na verificação do Captcha. Tente novamente.' });
        }

        // CORREÇÃO AQUI: Passamos um objeto limpo apenas com o que o Zod espera, ignorando o captchaToken
        const validatedData = loginSchema.parse({ email, password });

        const emailKey = validatedData.email.toLowerCase();

        // Muitas senhas erradas na mesma conta: espera, mesmo trocando de IP
        const lockedMinutes = loginLockedFor(emailKey);
        if (lockedMinutes) {
            return res.status(429).json({ error: `Muitas tentativas com senha errada. Tente de novo em ${lockedMinutes} min ou use "Esqueci minha senha".` });
        }

        const user = await prisma.user.findUnique({ where: { email: validatedData.email } });

        if (!user || !(await bcrypt.compare(validatedData.password, user.password))) {
            const locked = registerLoginFailure(emailKey);
            if (user) await logSecurityEvent(locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', { userId: user.id, req });
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        clearLoginFailures(emailKey);
        pruneOldSessions();
        const started = await startSession(user, req, { deviceId, remember, method: 'password' });
        return res.json(sessionPayload(user, started));
    },

    // ==========================================
    // LOGIN / CADASTRO COM GOOGLE
    // ==========================================
    async google(req: Request, res: Response) {
        if (!googleClient || !env.GOOGLE_CLIENT_ID) {
            return res.status(503).json({ error: 'O login com Google não está disponível no momento.' });
        }

        const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
        if (!credential) {
            return res.status(400).json({ error: 'Credencial do Google ausente.' });
        }

        // Confere assinatura, validade e se o token foi emitido para o nosso cliente OAuth
        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
            payload = ticket.getPayload();
        } catch {
            return res.status(401).json({ error: 'Não foi possível confirmar sua conta Google. Tente de novo.' });
        }

        if (!payload?.sub || !payload.email || !payload.email_verified) {
            return res.status(401).json({ error: 'Sua conta Google precisa ter um e-mail verificado.' });
        }

        const email = payload.email.toLowerCase();
        const name = (payload.name || email.split('@')[0]).trim().slice(0, 120);

        // 1) conta já ligada ao Google; 2) conta existente com o mesmo e-mail (verificado pelo Google): liga;
        // 3) nenhuma: cria uma conta de cliente
        let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
        let created = false;

        if (!user) {
            const byEmail = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            if (byEmail) {
                user = await prisma.user.update({
                    where: { id: byEmail.id },
                    data: { googleId: payload.sub, isEmailVerified: true },
                });
            } else {
                try {
                    user = await prisma.user.create({
                        data: {
                            name,
                            email,
                            // Conta sem senha conhecida: a pessoa pode criar uma em "Esqueci minha senha"
                            password: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
                            googleId: payload.sub,
                            isEmailVerified: true,
                            role: Role.USER,
                            attribution: readAttribution(req.body?.attribution),
                        },
                    });
                    created = true;
                } catch (error) {
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                        return res.status(409).json({ error: 'Este e-mail já está em uso. Entre com e-mail e senha.' });
                    }
                    throw error;
                }
            }
        }

        const started = await startSession(user, req, { deviceId: req.body?.deviceId, remember: req.body?.remember, method: 'google' });
        return res.status(created ? 201 : 200).json({ ...sessionPayload(user, started), created });
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
                    attribution: readAttribution(req.body?.attribution),
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

        const { link: resetLink } = resetLinkFor(user);

        try {
            if (!mailEnabled) {
                console.error('AVISO: RESEND_API_KEY não configurada; e-mail de recuperação não enviado.');
                return res.status(503).json({ error: 'A recuperação por e-mail está indisponível no momento. Fale com o comercial pelo WhatsApp para recuperar o acesso.' });
            }

            await sendMail(user.email, 'Crie uma nova senha · T3 OOH', resetEmail(user.name, resetLink));

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

            const current = await prisma.user.findUnique({ where: { id: decoded.id }, select: { password: true, name: true, email: true } });
            if (!current || decoded.pwd !== passwordFingerprint(current.password)) {
                throw new Error('Token já utilizado.');
            }

            const hashedPassword = await bcrypt.hash(password, 12);

            const updated = await prisma.user.update({
                where: { id: decoded.id },
                data: { password: hashedPassword }
            });

            // Senha nova: todos os aparelhos saem (quem pediu a troca entra de novo com a senha nova)
            await revokeUserSessions(decoded.id, 'password-reset');
            await logSecurityEvent('PASSWORD_RESET', { userId: decoded.id, req });
            sendMailInBackground(current.email, 'Sua senha foi alterada · T3 OOH', passwordChangedEmail(current.name,
                { when: new Date(), device: describeDevice(req.get('user-agent')).label, ip: clientIp(req) }, resetLinkFor(updated).link), 'senha alterada');

            return res.json({ message: 'Senha atualizada com sucesso.' });
        } catch (error) {
            return res.status(401).json({ error: 'O link de recuperação é inválido ou expirou.' });
        }
    },

    // ==========================================
    // SESSÃO: RENOVAR, SAIR E "NÃO FUI EU"
    // ==========================================
    /** Troca o refresh token por um novo par. 409 = outra aba já renovou (o site relê o token). */
    async refresh(req: Request, res: Response) {
        try {
            const result = await rotateSession(req.body?.refreshToken, req);
            return res.json({
                user: toPublicUser(result.user),
                token: result.accessToken,
                refreshToken: result.refreshToken,
                expiresIn: ACCESS_TTL_SECONDS,
                persistent: result.persistent,
            });
        } catch (error) {
            if (error instanceof SessionError) {
                return res.status(error.code === 'ROTATED' ? 409 : 401).json({ error: error.message, code: error.code });
            }
            throw error;
        }
    },

    /** Encerra a sessão deste aparelho (pelo refresh token ou pelo token de acesso). */
    async logout(req: Request, res: Response) {
        const refresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
        let sid = refresh.includes('.') ? refresh.split('.', 1)[0] : '';
        let userId: string | null = null;
        const [scheme, bearer] = req.headers.authorization?.split(' ') ?? [];
        if (scheme === 'Bearer' && bearer) {
            const payload = jwt.decode(bearer) as { sid?: string; sub?: string } | null;
            sid ||= payload?.sid ?? '';
            userId = payload?.sub ?? null;
        }
        if (sid) {
            await revokeSession(sid, 'logout');
            await logSecurityEvent('LOGOUT', { userId, req, sessionId: sid });
        }
        return res.status(204).end();
    },

    /**
     * Link "Não fui eu" do e-mail de aparelho novo: encerra todos os aparelhos e devolve um
     * token de redefinição para a pessoa criar a senha nova na hora.
     */
    async reportAccess(req: Request, res: Response) {
        const token = typeof req.body?.token === 'string' ? req.body.token : '';
        try {
            const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string; purpose?: string; sid?: string; pwd?: string };
            if (decoded.purpose !== 'report-access' || !decoded.sub) throw new Error('token');
            const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
            // Senha já trocada depois do alerta: o link perde a validade
            if (!user || decoded.pwd !== passwordFingerprint(user.password)) throw new Error('usado');

            const closed = await revokeUserSessions(user.id, 'reported-not-me');
            await logSecurityEvent('REPORTED_NOT_ME', { userId: user.id, req, sessionId: decoded.sid ?? null, detail: `${closed} sessões encerradas` });

            return res.json({ resetToken: resetLinkFor(user).token, closedSessions: closed });
        } catch {
            return res.status(401).json({ error: 'Este link expirou ou já foi usado. Se ainda não reconhece o acesso, use "Esqueci minha senha".' });
        }
    },
};
