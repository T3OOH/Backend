import { Role } from '@prisma/client';
import { prisma } from '../database/prisma';
import { mailEnabled, newQueueDealEmail, sendMailInBackground } from './mail.service';

/*
 * Aviso de pedido novo na fila do CRM: todos com o cargo Comercial recebem um e-mail (um por pessoa,
 * sem expor o endereço dos colegas). Quem assume primeiro fica com o pedido: o "assumir"
 * (crmController.claimDeal) é atômico, então dois cliques ao mesmo tempo nunca dão o mesmo pedido
 * a duas pessoas. Roda depois da resposta ao cliente: falha aqui nunca derruba o pedido.
 */

export interface PedidoNaFila {
    id: string;
    line: 'OOH' | 'SOLUTION';
    title: string;
    /** Linhas "rótulo: valor" mostradas no e-mail (cliente, valor, aplicação...). */
    details: [string, string][];
}

/** Mesmo protocolo que o cliente vê em "Meu perfil → Orçamentos". */
export const protocoloDo = (dealId: string) => dealId.slice(0, 6).toUpperCase();

/** Consultores que recebem o aviso: cargo Comercial com e-mail. */
export async function destinatariosComerciais() {
    return prisma.user.findMany({
        where: { role: Role.COMERCIAL, email: { not: '' } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
    });
}

/** Avisa o comercial em segundo plano; devolve quantos foram avisados (para log e testes). */
export async function avisarComercialPedidoNovo(pedido: PedidoNaFila): Promise<number> {
    const consultores = await destinatariosComerciais();
    if (!consultores.length) {
        console.warn(`[CRM] Pedido #${protocoloDo(pedido.id)} na fila, mas não há ninguém com o cargo Comercial para avisar.`);
        return 0;
    }
    if (!mailEnabled) {
        console.info(`[CRM] E-mail desligado (sem RESEND_API_KEY): ${consultores.length} consultor(es) seriam avisados do pedido #${protocoloDo(pedido.id)}.`);
        return 0;
    }
    const assunto = `Pedido novo na fila #${protocoloDo(pedido.id)} · ${pedido.line === 'SOLUTION' ? 'T3 Solution' : 'T3 OOH'}`;
    for (const c of consultores) {
        const conteudo = newQueueDealEmail(c.name, { protocol: protocoloDo(pedido.id), line: pedido.line, title: pedido.title, details: pedido.details });
        sendMailInBackground(c.email, assunto, conteudo, 'pedido novo na fila');
    }
    console.info(`[CRM] Pedido #${protocoloDo(pedido.id)} na fila: ${consultores.length} consultor(es) avisado(s) por e-mail.`);
    return consultores.length;
}

/** Dispara sem esperar e sem deixar erro escapar (o pedido do cliente já foi gravado). */
export function avisarComercialEmSegundoPlano(pedido: PedidoNaFila) {
    avisarComercialPedidoNovo(pedido).catch((error) => {
        console.error(`[CRM] Falha ao avisar o comercial do pedido #${protocoloDo(pedido.id)}:`, error);
    });
}
