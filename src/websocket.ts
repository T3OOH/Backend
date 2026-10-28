import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from './database/prisma';
import { env, isAllowedOrigin } from './config/env';

export let io: Server;

const STAFF_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER, Role.COMERCIAL]);

interface SocketUser {
    id: string;
    role: Role;
}

/**
 * Verifica se o usuário pode acessar o chat de um negócio.
 * Comercial: apenas negócios atribuídos a ele. Admin/Manager: todos.
 */
async function canAccessDeal(user: SocketUser, dealId: string) {
    const deal = await prisma.crmDeal.findUnique({
        where: { id: dealId },
        select: { clientId: true, sellerId: true }
    });
    if (!deal) return null;
    if (user.role === Role.COMERCIAL && deal.sellerId !== user.id) return null;
    return deal;
}

export function initWebSocket(httpServer: HttpServer) {
    // ========================================================
    // CORS SOCKET.IO (mesmas origens autorizadas da API)
    // ========================================================
    io = new Server(httpServer, {
        cors: {
            origin: function (requestOrigin, callback) {
                callback(null, !requestOrigin || isAllowedOrigin(requestOrigin));
            },
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    // ========================================================
    // AUTENTICAÇÃO NO HANDSHAKE (JWT da equipe interna)
    // ========================================================
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) return next(new Error('Não autenticado.'));

        try {
            const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload & { role?: Role };
            if (!payload.sub || !payload.role || !STAFF_ROLES.has(payload.role)) {
                return next(new Error('Sem permissão.'));
            }
            socket.data.user = { id: payload.sub, role: payload.role } satisfies SocketUser;
            return next();
        } catch {
            return next(new Error('Token inválido ou expirado.'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = socket.data.user as SocketUser;

        socket.on('join_chat', async (chatId: string) => {
            if (typeof chatId !== 'string') return;
            if (await canAccessDeal(user, chatId)) socket.join(chatId);
        });

        socket.on('leave_chat', (chatId: string) => {
            socket.leave(chatId);
        });

        socket.on('send_message', async (data: {
            chatId: string,
            text?: string,
            isInternal?: boolean,
            mediaUrl?: string,
            mediaType?: string
        }) => {
            try {
                if (!data || typeof data.chatId !== 'string') return;

                // Recupera o Cliente atrelado ao negócio e valida a permissão do remetente
                const deal = await canAccessDeal(user, data.chatId);
                if (!deal) {
                    console.warn(`[Socket] Envio negado ou Deal inexistente: ${data.chatId}`);
                    return;
                }

                const text = typeof data.text === 'string' ? data.text.slice(0, 5000) : null;

                // O remetente é sempre o usuário autenticado (nunca o valor enviado pelo cliente)
                const savedMsg = await prisma.crmMessage.create({
                    data: {
                        dealId: data.chatId,
                        clientId: deal.clientId, // Solução da constraint P2003
                        senderId: user.id,
                        content: text || null,
                        isInternal: Boolean(data.isInternal),
                        mediaUrl: data.mediaUrl || null,
                        mediaType: data.mediaType || null,
                        isRead: false
                    }
                });

                const payload = {
                    id: savedMsg.id,
                    chatId: data.chatId,
                    text: savedMsg.content,
                    senderId: user.id,
                    time: savedMsg.createdAt,
                    isInternal: savedMsg.isInternal,
                    mediaUrl: savedMsg.mediaUrl,
                    mediaType: savedMsg.mediaType
                };

                // Broadcast apenas para quem está na sala do negócio
                socket.to(data.chatId).emit('receive_message', payload);
                io.to(data.chatId).emit('update_sidebar', payload);

            } catch (error) {
                console.error("[Socket] Erro ao processar payload de mensagem:", error);
            }
        });
    });
}
