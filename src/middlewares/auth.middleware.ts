import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { isSessionActive } from '../services/session.service';

interface AccessTokenPayload extends JwtPayload {
    role?: Role;
    /** Sessão do aparelho. Tokens antigos (antes das sessões) não têm e expiram sozinhos em até 1 h. */
    sid?: string;
}

const validRoles = new Set(Object.values(Role));

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }

    let payload: AccessTokenPayload;
    try {
        payload = jwt.verify(token, env.JWT_SECRET, {
            algorithms: ['HS256'],
        }) as AccessTokenPayload;
    } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    {

        if (!payload.sub || !payload.role || !validRoles.has(payload.role)) {
            return res.status(401).json({ error: 'Token inválido.' });
        }

        // Sessão encerrada (sair, "Não fui eu", troca de senha): o token deixa de valer na hora
        if (payload.sid) {
            try {
                if (!(await isSessionActive(payload.sid))) {
                    return res.status(401).json({ error: 'Sessão encerrada. Entre de novo.', code: 'SESSION_REVOKED' });
                }
            } catch (error) {
                return next(error);
            }
        }

        req.user = { id: payload.sub, role: payload.role, sessionId: payload.sid };
        return next();
    }
}

export function requireRoles(...roles: Role[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Não autenticado.' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Sem permissão para esta ação.' });
        }

        return next();
    };
}
/** Perfis com acesso ao dashboard administrativo. */
export const MANAGEMENT_ROLES: Role[] = [Role.ADMIN, Role.MANAGER];

/** Perfis da equipe interna (dashboard + CRM). */
export const STAFF_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.COMERCIAL];
