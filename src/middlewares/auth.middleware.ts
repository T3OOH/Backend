import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';

interface AccessTokenPayload extends JwtPayload {
    role?: Role;
}

const validRoles = new Set(Object.values(Role));

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }

    try {
        const payload = jwt.verify(token, env.JWT_SECRET, {
            algorithms: ['HS256'],
        }) as AccessTokenPayload;

        if (!payload.sub || !payload.role || !validRoles.has(payload.role)) {
            return res.status(401).json({ error: 'Token inválido.' });
        }

        req.user = { id: payload.sub, role: payload.role };
        return next();
    } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
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