import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';

const createClientSchema = z.object({
    name: z.string().min(2),
    document: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    company: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
});

const createDealSchema = z.object({
    clientId: z.string().uuid(),
    title: z.string().min(3),
    expectedValue: z.number().min(0),
    probability: z.number().min(0).max(100).default(0),
});

// Atualizado para a nova estrutura de Checkout do Frontend
interface CheckoutItem {
    panelId: string;
    priceSnapshot: number;
}

interface CheckoutPayload {
    clientDetails: {
        name: string;
        email: string;
        phone: string;
        company?: string;
        message?: string;
    };
    contractMonths: number;
    originalValue: number;
    expectedValue: number;
    items: CheckoutItem[];
    source?: string;
}

export const crmController = {
    async getClients(req: Request, res: Response) {
        try {
            const { id: userId, role } = (req as any).user; 
            const isRestricted = role === 'COMERCIAL';
            
            const clients = await prisma.crmClient.findMany({
                where: isRestricted ? { sellerId: userId } : undefined,
                include: {
                    seller: { select: { name: true } },
                    _count: { select: { deals: true } }
                },
                orderBy: { createdAt: 'desc' }
            });

            return res.status(200).json(clients);
        } catch (error) {
            console.error('[CRM] GetClients Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async createClient(req: Request, res: Response) {
        try {
            const data = createClientSchema.parse(req.body);
            const sellerId = (req as any).user.id; 

            const client = await prisma.crmClient.create({
                data: {
                    ...data,
                    sellerId
                }
            });

            return res.status(201).json(client);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed.', details: error.issues });
            }
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async updateClient(req: Request, res: Response) {
        try {
            const clientId = String(req.params.id); 
            const data = createClientSchema.partial().parse(req.body); 
            const { id: userId, role } = (req as any).user;
            
            if (role === 'COMERCIAL') {
                const checkOwnership = await prisma.crmClient.findFirst({
                    where: { id: clientId, sellerId: userId }
                });
                
                if (!checkOwnership) {
                    return res.status(403).json({ error: 'Acesso negado. Você não gerencia este cliente.' });
                }
            }

            const client = await prisma.crmClient.update({
                where: { id: clientId },
                data
            });

            return res.status(200).json(client);
        } catch (error) {
            console.error('[CRM] UpdateClient Error:', error);
            return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
        }
    },

    async deleteClient(req: Request, res: Response) {
        try {
            const clientId = String(req.params.id);
            const { id: userId, role } = (req as any).user;

            if (role === 'COMERCIAL') {
                const checkOwnership = await prisma.crmClient.findFirst({
                    where: { id: clientId, sellerId: userId }
                });
                
                if (!checkOwnership) {
                    return res.status(403).json({ error: 'Acesso negado. Você não gerencia este cliente.' });
                }
            }

            await prisma.crmClient.delete({
                where: { id: clientId }
            });

            return res.status(204).send();
        } catch (error) {
            console.error('[CRM] DeleteClient Error:', error);
            return res.status(500).json({ error: 'Erro ao deletar cliente.' });
        }
    },

    async getGlobalDeals(req: Request, res: Response) {
        try {
            // Buscando todos os painéis dentro dos itens para o PDF no frontend ter os dados
            const deals = await prisma.crmDeal.findMany({
                include: { 
                    client: { select: { name: true, email: true, phone: true, company: true } },
                    seller: { select: { name: true } },
                    items: {
                        include: {
                            panel: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
            return res.json(deals);
        } catch (error) {
            console.error('[CRM] GetGlobalDeals Error:', error);
            return res.status(500).json({ error: 'Erro ao buscar fila de pedidos.' });
        }
    },

    async claimDeal(req: Request, res: Response) {
        try {
            const id = String(req.params.dealId);
            const userId = String((req as any).user.id);

            const deal = await prisma.crmDeal.findUnique({ where: { id } });
            
            if (!deal) {
                return res.status(404).json({ error: 'Pedido não encontrado.' });
            }

            if (deal.sellerId && deal.sellerId !== userId) {
                return res.status(400).json({ error: 'Este pedido já está sendo atendido por outro consultor.' });
            }

            const updatedDeal = await prisma.crmDeal.update({
                where: { id },
                data: { sellerId: userId },
                include: { seller: { select: { name: true } } }
            });

            return res.json(updatedDeal);
        } catch (error) {
            console.error('[CRM] ClaimDeal Error:', error);
            return res.status(500).json({ error: 'Erro ao assumir pedido.' });
        }
    },

    async getDeals(req: Request, res: Response) {
        try {
            const { id: userId, role } = (req as any).user; 
            const isRestricted = role === 'COMERCIAL';

            const deals = await prisma.crmDeal.findMany({
                where: isRestricted ? { sellerId: userId } : undefined,
                include: {
                    client: { select: { name: true, avatarUrl: true } },
                    items: {
                        include: {
                            panel: { select: { name: true, city: true, state: true } }
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' }
            });

            return res.status(200).json(deals);
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async updateDealStatus(req: Request, res: Response) {
        try {
            const id = String(req.params.id);
            const status = String(req.body.status);

            const deal = await prisma.crmDeal.update({
                where: { id },
                data: { status: status as any } 
            });

            return res.status(200).json(deal);
        } catch (error) {
            console.error('[CRM] UpdateDealStatus Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async createDeal(req: Request, res: Response) {
        try {
            const data = createDealSchema.parse(req.body);
            const sellerId = (req as any).user.id;

            const deal = await prisma.crmDeal.create({
                data: {
                    ...data,
                    sellerId
                },
                include: {
                    client: { select: { name: true } }
                }
            });

            return res.status(201).json(deal);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Validation failed.', details: error.issues });
            }
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async updateDealStage(req: Request, res: Response) {
        try {
            const id = String(req.params.id);
            const stage = String(req.body.stage);

            const deal = await prisma.crmDeal.update({
                where: { id },
                data: { stage: stage as any } 
            });

            return res.status(200).json(deal);
        } catch (error) {
            console.error('[CRM] UpdateDeal Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async getDashboardMetrics(req: Request, res: Response) {
        try {
            const { id: userId, role } = (req as any).user;
            const isRestricted = role === 'COMERCIAL';

            const whereClause = isRestricted ? { sellerId: userId } : {};

            const openDeals = await prisma.crmDeal.findMany({
                where: {
                    ...whereClause,
                    status: 'OPEN',
                }
            });

            const totalExpectedValue = openDeals.reduce((acc, deal) => acc + Number(deal.expectedValue), 0);
            const totalActiveDeals = openDeals.length;

            const totalClients = await prisma.crmClient.count({
                where: whereClause
            });

            const wonDeals = await prisma.crmDeal.findMany({
                where: {
                    ...whereClause,
                    status: 'WON',
                }
            });

            const totalWonValue = wonDeals.reduce((acc, deal) => acc + Number(deal.expectedValue), 0);

            return res.status(200).json({
                totalExpectedValue,
                totalActiveDeals,
                totalClients,
                totalWonValue
            });

        } catch (error) {
            console.error('[CRM] GetMetrics Error:', error);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    },

    async getChatHistory(req: Request, res: Response) {
        try {
            const dealId = String(req.params.dealId);
            const { role } = (req as any).user;
            
            const messages = await prisma.crmMessage.findMany({
                where: { 
                    dealId,
                    isInternal: role === 'USER' ? false : undefined 
                },
                orderBy: { createdAt: 'asc' }
            });
            
            return res.json(messages);
        } catch (error) {
            console.error('[CRM] GetChatHistory Error:', error);
            return res.status(500).json({ error: 'Erro ao buscar mensagens do histórico.' });
        }
    },

    // Nova Rota Refatorada (Cria Deal com Itens Estruturados e Mensagem Rica)
    async createCheckoutDeal(req: Request, res: Response) {
        try {
            const { clientDetails, contractMonths, originalValue, expectedValue, items, source } = req.body as CheckoutPayload;

            if (!clientDetails?.name || !clientDetails?.email || !clientDetails?.phone) {
                return res.status(400).json({ error: 'Dados do cliente incompletos.' });
            }

            if (!items || items.length === 0) {
                return res.status(400).json({ error: 'O carrinho não pode estar vazio.' });
            }

            const deal = await prisma.$transaction(async (tx) => {
                
                const fallbackSeller = await tx.user.findFirst({
                    where: { role: { in: ['ADMIN', 'MANAGER'] } },
                    orderBy: { createdAt: 'asc' } 
                });

                if (!fallbackSeller) {
                    throw new Error('Erro de sistema: Nenhum administrador encontrado para atrelar a ficha.');
                }

                let client = await tx.crmClient.findFirst({
                    where: { email: clientDetails.email }
                });

                if (!client) {
                    client = await tx.crmClient.create({
                        data: {
                            name: clientDetails.name,
                            email: clientDetails.email,
                            phone: clientDetails.phone,
                            whatsapp: clientDetails.phone,
                            company: clientDetails.company,
                            sellerId: fallbackSeller.id 
                        }
                    });
                }

                // Cria o Deal e já insere os itens ao mesmo tempo (Poder do Prisma)
                const newDeal = await tx.crmDeal.create({
                    data: {
                        title: `Cotação via ${source === 'INTERACTIVE_MAP' ? 'Mapa' : 'Catálogo'} - ${contractMonths} meses`,
                        clientId: client.id,
                        expectedValue: expectedValue,
                        originalValue: originalValue,
                        contractMonths: contractMonths,
                        probability: 0,
                        items: {
                            create: items.map(item => ({
                                panelId: item.panelId,
                                priceSnapshot: item.priceSnapshot
                            }))
                        }
                    },
                    // Retorna incluindo os itens e dados do painel para uso futuro
                    include: {
                        items: {
                            include: {
                                panel: true
                            }
                        }
                    }
                });

                // ==============================================================
                // CRIAÇÃO DA MENSAGEM AUTOMÁTICA RICA NO CHAT
                // ==============================================================
                const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
                
                // Lista os painéis com a cidade e o valor rateado
                const panelDetailsText = newDeal.items.map(item => {
                    const p = item.panel;
                    const location = p.city && p.state ? `(${String(p.city).toUpperCase()} - ${String(p.state).toUpperCase()})` : '';
                    return `• ${location} ${p.name}: ${formatCurrency(item.priceSnapshot)}`;
                }).join('\n');

                const economy = originalValue > expectedValue ? originalValue - expectedValue : 0;
                const monthlyInvestment = expectedValue / contractMonths;

                // Monta o texto bonitinho
                const initialText = `NOVA SOLICITAÇÃO DE ORÇAMENTO via ${source === 'INTERACTIVE_MAP' ? 'Mapa' : 'Catálogo'}\n\n` +
                    `Duração da Campanha: ${contractMonths} ${contractMonths === 1 ? 'mês' : 'meses'}\n` +
                    `Investimento Mensal: ${formatCurrency(monthlyInvestment)}\n` +
                    `Valor Total do Contrato (${contractMonths}x): ${formatCurrency(expectedValue)}\n` +
                    (economy > 0 ? `Economia aplicada no pacote: ${formatCurrency(economy)}*\n\n` : '\n') +
                    `PAINÉIS SELECIONADOS:\n${panelDetailsText}\n\n` +
                    `NOTAS DO CLIENTE:\n${clientDetails.message || 'Nenhuma observação inserida pelo cliente.'}`;
                
                await tx.crmMessage.create({
                    data: {
                        dealId: newDeal.id,
                        clientId: client.id,
                        senderId: client.id, 
                        content: initialText,
                        isInternal: false,
                    }
                });

                return newDeal;
            });

            return res.status(201).json(deal);

        } catch (error: any) {
            console.error('[CRM] Checkout Integration Error:', error);
            return res.status(500).json({ error: error.message || 'Internal server error.' });
        }
    }
};