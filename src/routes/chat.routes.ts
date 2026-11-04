import { Router, Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

const chatRoutes = Router();

chatRoutes.use(authMiddleware, requireRoles(...STAFF_ROLES));

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

        // Não lidas enviadas pelo próprio cliente, numa consulta só (antes era uma consulta por cliente)
        const naoLidas = await prisma.crmMessage.groupBy({
            by: ['clientId', 'senderId'],
            where: { isRead: false },
            _count: { _all: true },
        });
        const unreadPorCliente = new Map<string, number>();
        for (const n of naoLidas) {
            if (n.senderId === n.clientId) unreadPorCliente.set(n.clientId, n._count._all);
        }

        const formatted = clients.map((c) => {
            const unreadCount = unreadPorCliente.get(c.id) ?? 0;

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
        });

        // Ordena para que os que têm mensagens mais recentes fiquem no topo
        formatted.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar contatos.' });
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
        res.status(500).json({ error: 'Erro ao buscar mensagens.' });
    }
});

export { chatRoutes };