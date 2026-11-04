import { Role } from '@prisma/client';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role: Role;
                /** Sessão do aparelho (quando o token tem "sid"). */
                sessionId?: string;
            };
            /** Reunião a que o token de reunião dá acesso (só nas rotas de /meetings). */
            meetingId?: string;
        }
    }
}

export { };
