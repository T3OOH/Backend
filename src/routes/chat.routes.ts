import { Router, Request, Response } from 'express';
import { prisma } from '../database/prisma'; 

const chatRoutes = Router();

// 1. Buscar todos os contatos da barra lateral
chatRoutes.get('/contacts', async (req: Request, res: Response) => {
    try {
        const clients = await prisma.crmClient.findMany({
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1 
                }
            }
        });

        const formatted = await Promise.all(clients.map(async (c) => {
            // Conta as mensagens não lidas enviadas pelo cliente
            const unreadCount = await prisma.crmMessage.count({
                where: { clientId: c.id, isRead: false, senderId: c.id }
            });

            const lastMsg = c.messages[0];
            
            // Formata o texto da última mensagem dependendo do tipo
            let lastMessageText = 'Nenhuma mensagem';
            if (lastMsg) {
                if (lastMsg.isInternal) lastMessageText = '🔒 Nota Interna';
                else if (lastMsg.mediaUrl) lastMessageText = '📷 Arquivo';
                else lastMessageText = lastMsg.content || 'Mensagem enviada';
            }
            
            return {
                id: c.id,
                name: c.name,
                company: c.city || 'Sem cidade', 
                lastMessage: lastMessageText,
                time: lastMsg ? lastMsg.createdAt : c.createdAt,
                unread: unreadCount,
                online: true 
            };
        }));

        // Ordena para que os que têm mensagens mais recentes fiquem no topo
        formatted.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
});

// 2. Buscar o histórico de um chat específico e marcar como lido
chatRoutes.get('/:clientId/messages', async (req: Request, res: Response) => {
    const clientId = req.params.clientId as string;
    
    try {
        const messages = await prisma.crmMessage.findMany({
            where: { clientId: clientId },
            orderBy: { createdAt: 'asc' },
            select: { // Garantindo que todos os campos venham para o frontend
                id: true,
                clientId: true,
                senderId: true,
                content: true,
                mediaUrl: true,
                mediaType: true,
                isRead: true,
                isInternal: true,
                createdAt: true
            }
        });

        // Marca as mensagens do cliente como lidas
        await prisma.crmMessage.updateMany({
            where: { 
                clientId: clientId, 
                isRead: false, 
                senderId: clientId 
            },
            data: { isRead: true }
        });

        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar mensagens' });
    }
});

export { chatRoutes };