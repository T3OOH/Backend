import { Request, Response } from 'express';
import { DealStage, DealStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { calculateQuote } from '../services/pricing.service';
import { readAttribution } from '../lib/attribution';

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
    expectedValue: z.coerce.number().min(0),
    probability: z.coerce.number().int().min(0).max(100).default(0),
});

// Checkout do Frontend: apenas escolhas do cliente; valores são calculados no servidor
const checkoutSchema = z.object({
    clientDetails: z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        phone: z.string().trim().min(8).max(30),
        company: z.string().trim().max(120).optional(),
        message: z.string().max(5000).optional(),
    }),
    contractMonths: z.coerce.number().int().min(1).max(36),
    couponCode: z.string().trim().max(50).optional().nullable(),
    items: z.array(z.object({ panelId: z.string().uuid() })).min(1, 'O carrinho não pode estar vazio.'),
    source: z.string().max(50).optional(),
});

/**
 * Consultores comerciais só podem operar negócios atribuídos a eles.
 * Retorna false (já respondendo 403/404) quando o acesso não é permitido.
 */
async function ensureDealAccess(req: Request, res: Response, dealId: string) {
    const deal = await prisma.crmDeal.findUnique({ where: { id: dealId }, select: { sellerId: true } });
    if (!deal) {
        res.status(404).json({ error: 'Negócio não encontrado.' });
        return false;
    }
    if (req.user?.role === Role.COMERCIAL && deal.sellerId !== req.user.id) {
        res.status(403).json({ error: 'Acesso negado. Você não gerencia este negócio.' });
        return false;
    }
    return true;
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
            if (error instanceof z.ZodError) {
                return res.status(400).json({ error: 'Dados inválidos.', details: error.issues });
            }
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

            // Cupons usados pelo cliente guardam a referência; sem soltá-la o delete falha (FK)
            await prisma.$transaction([
                prisma.crmCoupon.updateMany({ where: { usedById: clientId }, data: { usedById: null } }),
                prisma.crmClient.delete({ where: { id: clientId } }),
            ]);

            return res.status(204).send();
        } catch (error) {
            console.error('[CRM] DeleteClient Error:', error);
            return res.status(500).json({ error: 'Erro ao deletar cliente.' });
        }
    },

    async getGlobalDeals(req: Request, res: Response) {
        try {
            // Fila: orçamentos do site que ainda não têm consultor
            const deals = await prisma.crmDeal.findMany({
                where: { sellerId: null, status: 'OPEN' },
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
                return res.status(409).json({ error: 'Este pedido já está sendo atendido por outro consultor.' });
            }

            const updatedDeal = await prisma.$transaction(async (tx) => {
                // Atômico: só assume se ninguém assumiu entre a leitura e a escrita
                const { count } = await tx.crmDeal.updateMany({
                    where: { id, OR: [{ sellerId: null }, { sellerId: userId }] },
                    data: { sellerId: userId },
                });
                if (count === 0) return null;

                // Leads do site nascem com o cliente atrelado a um admin; quem assume passa a ser o dono
                const client = await tx.crmClient.findUnique({ where: { id: deal.clientId }, select: { seller: { select: { role: true } } } });
                if (client && client.seller.role !== Role.COMERCIAL) {
                    await tx.crmClient.update({ where: { id: deal.clientId }, data: { sellerId: userId } });
                }

                return tx.crmDeal.findUnique({ where: { id }, include: { seller: { select: { name: true } } } });
            });

            if (!updatedDeal) {
                return res.status(409).json({ error: 'Este pedido acabou de ser assumido por outro consultor.' });
            }
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
                    client: { select: { name: true, avatarUrl: true, phone: true, whatsapp: true, email: true, company: true, document: true } },
                    seller: { select: { name: true } },
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
            const status = String(req.body.status) as DealStatus;

            if (!Object.values(DealStatus).includes(status)) {
                return res.status(400).json({ error: 'Status inválido.' });
            }
            if (!(await ensureDealAccess(req, res, id))) return;

            const deal = await prisma.crmDeal.update({
                where: { id },
                data: { status }
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

            if (req.user?.role === Role.COMERCIAL) {
                const ownsClient = await prisma.crmClient.findFirst({ where: { id: data.clientId, sellerId } });
                if (!ownsClient) {
                    return res.status(403).json({ error: 'Acesso negado. Você não gerencia este cliente.' });
                }
            }

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
            const stage = String(req.body.stage) as DealStage;

            if (!Object.values(DealStage).includes(stage)) {
                return res.status(400).json({ error: 'Etapa inválida.' });
            }
            if (!(await ensureDealAccess(req, res, id))) return;

            const deal = await prisma.crmDeal.update({
                where: { id },
                data: { stage }
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
            if (!(await ensureDealAccess(req, res, dealId))) return;

            const messages = await prisma.crmMessage.findMany({
                where: { dealId },
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
        const parsed = checkoutSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados do pedido inválidos.', details: parsed.error.issues });
        }
        const { clientDetails, contractMonths, couponCode, items, source } = parsed.data;
        const attribution = readAttribution(req.body?.attribution);

        // Valores oficiais: preço do banco + desconto de prazo + cupom (erros de cupom viram 400)
        const quote = await calculateQuote({
            panelIds: items.map((item) => item.panelId),
            months: contractMonths,
            couponCode,
        });
        const { originalValue, finalValue: expectedValue } = quote;
        const origin = source?.startsWith('INTERACTIVE_MAP') ? 'Mapa' : 'Catálogo';

        try {
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
                        title: `Cotação via ${origin} - ${contractMonths} meses`,
                        clientId: client.id,
                        expectedValue: expectedValue,
                        originalValue: originalValue,
                        contractMonths: contractMonths,
                        probability: 0,
                        attribution,
                        items: {
                            create: quote.items.map(item => ({
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

                if (quote.coupon?.singleUse) {
                    await tx.crmCoupon.update({
                        where: { id: quote.coupon.id },
                        data: { isUsed: true, usedAt: new Date(), usedById: client.id },
                    });
                }

                // ==============================================================
                // CRIAÇÃO DA MENSAGEM AUTOMÁTICA RICA NO CHAT
                // ==============================================================
                const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
                
                // Lista os painéis com a cidade e o valor rateado
                const panelDetailsText = newDeal.items.map(item => {
                    const p = item.panel;
                    const location = p.city && p.state ? `(${String(p.city).toUpperCase()} - ${String(p.state).toUpperCase()})` : '';
                    return `• ${location} ${p.name}: ${formatCurrency(item.priceSnapshot)}/mês`;
                }).join('\n');

                const economy = originalValue > expectedValue ? originalValue - expectedValue : 0;
                const discountLines = [
                    quote.termDiscountPercent > 0 ? `Desconto de prazo: ${quote.termDiscountPercent * 100}%` : '',
                    quote.coupon ? `Cupom aplicado: ${quote.coupon.code}` : '',
                ].filter(Boolean).join('\n');

                // Monta o texto bonitinho
                const initialText = `NOVA SOLICITAÇÃO DE ORÇAMENTO via ${origin}\n\n` +
                    `Duração da Campanha: ${contractMonths} ${contractMonths === 1 ? 'mês' : 'meses'}\n` +
                    `Investimento Mensal: ${formatCurrency(quote.monthlyValue)}\n` +
                    `Valor Total do Contrato (${contractMonths}x): ${formatCurrency(expectedValue)}\n` +
                    (economy > 0 ? `Economia aplicada no pacote: ${formatCurrency(economy)}*\n` : '') +
                    (discountLines ? `${discountLines}\n\n` : '\n') +
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

            return res.status(201).json({ ...deal, quote });

        } catch (error: any) {
            console.error('[CRM] Checkout Integration Error:', error);
            return res.status(500).json({ error: 'Não foi possível registrar o orçamento. Tente novamente.' });
        }
    }
};