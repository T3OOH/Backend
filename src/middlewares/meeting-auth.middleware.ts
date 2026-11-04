import { NextFunction, Request, Response } from 'express';
import { authMiddleware, requireRoles } from './auth.middleware';
import { findStaffUser, MEETING_ROLES, verifyMeetingToken } from '../services/meeting.service';

/**
 * Aceita o token de acesso da equipe OU o token de reunião.
 * Só as rotas que usam este middleware aceitam o token de reunião; o authMiddleware normal o recusa.
 * Com token de reunião, req.meetingId fica definido e a rota confere se bate com a reunião pedida.
 */
export async function meetingOrStaffAuth(req: Request, res: Response, next: NextFunction) {
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    const meetingToken = scheme === 'Bearer' && token ? verifyMeetingToken(token) : null;

    if (!meetingToken) {
        return authMiddleware(req, res, (err?: unknown) => {
            if (err) return next(err);
            return requireRoles(...MEETING_ROLES)(req, res, next);
        });
    }

    try {
        // O token dura 12 h: confere se o usuário ainda existe e continua na equipe
        const user = await findStaffUser(meetingToken.userId);
        if (!user) return res.status(401).json({ error: 'Token inválido.' });
        req.user = { id: user.id, role: user.role };
        req.meetingId = meetingToken.meetingId;
        return next();
    } catch (error) {
        return next(error);
    }
}
