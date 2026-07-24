import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { prisma } from './database/prisma';
import { env } from './config/env';

export let io: Server;

export function initWebSocket(httpServer: HttpServer) {
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:5173',
        env.FRONTEND_URL 
    ].filter(Boolean) as string[];

    io = new Server(httpServer, {
        cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
    });

    io.on('connection', (socket: Socket) => {
        console.log(`[Socket] Cliente conectado: ${socket.id}`);

        socket.on('join_chat', (chatId: string) => {
            socket.join(chatId);
        });

        socket.on('leave_chat', (chatId: string) => {
            socket.leave(chatId);
        });

        socket.on('send_message', async (data: { 
            chatId: string, 
            text?: string, 
            senderId: string,
            isInternal?: boolean,
            mediaUrl?: string,
            mediaType?: string
        }) => {
            try {
                // Recupera a referência oficial do Cliente atrelado a este Pedido
                const deal = await prisma.crmDeal.findUnique({
                    where: { id: data.chatId },
                    select: { clientId: true }
                });

                if (!deal) {
                    console.warn(`[Socket] Tentativa de envio em Deal inexistente: ${data.chatId}`);
                    return;
                }

                // Persistência com as chaves estrangeiras corretas resolvidas
                const savedMsg = await prisma.crmMessage.create({
                    data: {
                        dealId: data.chatId,
                        clientId: deal.clientId, // Solução da constraint P2003
                        senderId: data.senderId,
                        content: data.text || null,
                        isInternal: data.isInternal || false,
                        mediaUrl: data.mediaUrl || null,
                        mediaType: data.mediaType || null,
                        isRead: false
                    }
                });

                const payload = {
                    id: savedMsg.id,
                    chatId: data.chatId,
                    text: data.text,
                    senderId: data.senderId,
                    time: savedMsg.createdAt,
                    isInternal: savedMsg.isInternal,
                    mediaUrl: savedMsg.mediaUrl,
                    mediaType: savedMsg.mediaType
                };

                // Broadcast para a sala e notificação global
                socket.to(data.chatId).emit('receive_message', payload);
                io.emit('update_sidebar', payload);
                
            } catch (error) {
                console.error("[Socket] Erro ao processar payload de mensagem:", error);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] Cliente desconectado: ${socket.id}`);
        });
    });
}