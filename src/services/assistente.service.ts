import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../database/prisma';
import {
    conversaEmTexto, dadosParaIa, DESTINOS, Destino, INSTRUCOES, mensagensParaIa, NOME_IA, PainelContexto,
    RESPOSTA_IA_JSON_SCHEMA, RespostaIa, respostaIaSchema, respostasProntas, TEMAS, TemaId,
} from '../lib/assistente';
import { sendMailInBackground, assistenteEquipeEmail } from './mail.service';

/**
 * IA T3 (balão de dúvidas do site): respostas prontas com os dados do banco, respostas da IA
 * (Claude, só se ANTHROPIC_API_KEY estiver configurada) e encaminhamento para comercial
 * (lead na fila do CRM), gestão (contato + e-mail aos gestores) ou técnico (contato + e-mail
 * para SUPORTE_TECNICO_EMAIL, ou aos administradores se ela não existir).
 */

const MODELO = 'claude-opus-5-5';
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const iaAtiva = Boolean(anthropic);

// Painéis lidos do banco no máximo a cada 5 minutos (o contexto fica igual e o cache do Claude rende)
const CACHE_MS = 5 * 60_000;
let cache: { em: number; paineis: PainelContexto[] } | null = null;

async function paineis(): Promise<PainelContexto[]> {
    if (cache && Date.now() - cache.em < CACHE_MS) return cache.paineis;
    const lista = await prisma.panel.findMany({
        select: { name: true, city: true, state: true, address: true, impacts: true, size: true, px: true, price: true, status: true, playbackSeconds: true },
        orderBy: [{ state: 'asc' }, { city: 'asc' }, { name: 'asc' }],
    });
    cache = { em: Date.now(), paineis: lista.map((p) => ({ ...p, status: String(p.status), price: p.price === null ? null : Number(p.price) })) };
    return cache.paineis;
}

/** Dados de abertura do balão: nome, temas, respostas prontas e se a IA está ligada. */
export async function inicio() {
    const prontas = respostasProntas(await paineis());
    return {
        nome: NOME_IA,
        saudacao: `Oi! Sou a ${NOME_IA}, assistente da T3 LED. Sobre o que é sua dúvida?`,
        iaAtiva,
        temas: TEMAS.map((t) => ({ ...t, respostas: prontas[t.id] })),
        destinos: DESTINOS,
    };
}

export class IaIndisponivel extends Error {}

/** Resposta da IA para a conversa. Sem chave da API, avisa e sugere o destino do tema. */
export async function responder(tema: TemaId, mensagens: { de: 'visitante' | 'ia'; texto: string }[]): Promise<RespostaIa> {
    const padrao = TEMAS.find((t) => t.id === tema)!.destino;
    if (!anthropic) {
        return {
            resposta: 'Ainda não consigo responder perguntas livres por aqui. Escolha uma das perguntas prontas ou fale com a nossa equipe.',
            encaminhar: padrao,
            motivo: 'IA desligada (sem ANTHROPIC_API_KEY)',
        };
    }
    const mensagensIa = mensagensParaIa(mensagens, tema);
    if (!mensagensIa.length) throw new IaIndisponivel('Escreva sua dúvida.');

    try {
        const resposta = await anthropic.beta.messages.create({
            model: MODELO,
            // Pensamento sempre ligado no Opus 5.5: o esforço baixo deixa o chat rápido e barato
            max_tokens: 4000,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPOSTA_IA_JSON_SCHEMA } },
            // Se o modelo recusar por política, a API tenta o modelo recomendado no lugar
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: [
                { type: 'text', text: INSTRUCOES },
                // Dados do banco: mudam pouco (cache de 5 min), então ficam no cache do prompt
                { type: 'text', text: dadosParaIa(await paineis()), cache_control: { type: 'ephemeral' } },
            ],
            messages: mensagensIa,
        });
        if (resposta.stop_reason === 'refusal') {
            return { resposta: 'Não consigo ajudar com isso por aqui. Posso te passar para a nossa equipe.', encaminhar: padrao, motivo: 'IA recusou a pergunta' };
        }
        const bloco = resposta.content.find((b) => b.type === 'text');
        const lido = respostaIaSchema.safeParse(JSON.parse(bloco && bloco.type === 'text' ? bloco.text : '{}'));
        if (!lido.success || !lido.data.resposta.trim()) throw new Error('Resposta da IA fora do formato.');
        return lido.data;
    } catch (error) {
        if (error instanceof Anthropic.RateLimitError) {
            return { resposta: 'Estou com muitas conversas agora. Tente de novo em instantes ou fale com a nossa equipe.', encaminhar: padrao, motivo: 'IA ocupada (limite de uso)' };
        }
        console.error('[IA T3] Falha ao responder:', error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
        return { resposta: 'Tive um problema para responder agora. Posso te passar para a nossa equipe.', encaminhar: padrao, motivo: 'Falha da IA' };
    }
}

export interface Encaminhamento {
    destino: Destino;
    tema: TemaId;
    nome: string;
    telefone: string;
    email?: string;
    empresa?: string;
    motivo?: string;
    mensagens: { de: 'visitante' | 'ia'; texto: string }[];
    pagina?: string;
    ip?: string;
    userAgent?: string;
}

/** Leva a conversa para quem resolve. Devolve um protocolo curto para mostrar ao visitante. */
export async function encaminhar(e: Encaminhamento) {
    const tema = TEMAS.find((t) => t.id === e.tema)!.titulo;
    const conversa = conversaEmTexto(e.mensagens);
    const texto = [
        `Pedido pelo balão de dúvidas (${NOME_IA}) · assunto: ${tema}`,
        e.motivo ? `Motivo: ${e.motivo}` : '',
        e.pagina ? `Página: ${e.pagina}` : '',
        '',
        conversa || '(sem conversa)',
    ].filter((l, i) => l || i > 2).join('\n');

    if (e.destino === 'comercial') {
        // Lead na fila do CRM (negócio sem consultor), igual aos orçamentos do site
        const deal = await prisma.$transaction(async (tx) => {
            const dono = await tx.user.findFirst({ where: { role: { in: ['ADMIN', 'MANAGER'] } }, orderBy: { createdAt: 'asc' } });
            if (!dono) throw new Error('Nenhum administrador para atrelar o cliente.');
            let cliente = e.email ? await tx.crmClient.findFirst({ where: { email: { equals: e.email, mode: 'insensitive' } } }) : null;
            cliente ??= await tx.crmClient.findFirst({ where: { OR: [{ whatsapp: e.telefone }, { phone: e.telefone }] } });
            cliente ??= await tx.crmClient.create({
                data: { name: e.nome, email: e.email || null, phone: e.telefone, whatsapp: e.telefone, company: e.empresa || null, sellerId: dono.id },
            });
            const negocio = await tx.crmDeal.create({
                data: { title: `Dúvida no site (${NOME_IA}): ${tema}`, clientId: cliente.id, probability: 0, attribution: { source: 'chat-ia-t3', page: e.pagina ?? null } },
            });
            await tx.crmMessage.create({ data: { dealId: negocio.id, clientId: cliente.id, senderId: cliente.id, content: texto, isInternal: false } });
            return negocio;
        });
        return { protocolo: deal.id.slice(0, 8).toUpperCase(), destino: e.destino };
    }

    // Gestão e técnico: contato registrado + e-mail para quem resolve
    const contato = await prisma.contact.create({
        data: {
            name: e.nome, phone: e.telefone, email: e.email || '', company: e.empresa || null,
            message: texto, ip: e.ip, userAgent: e.userAgent,
            origin: e.destino === 'tecnico' ? `${NOME_IA} · suporte técnico` : `${NOME_IA} · gestão`,
        },
    });
    const protocolo = contato.id.slice(0, 8).toUpperCase();
    const destinatarios = e.destino === 'tecnico' && process.env.SUPORTE_TECNICO_EMAIL
        ? [process.env.SUPORTE_TECNICO_EMAIL]
        : (await prisma.user.findMany({ where: { role: e.destino === 'tecnico' ? 'ADMIN' : { in: ['ADMIN', 'MANAGER'] } }, select: { email: true } })).map((u) => u.email);
    const assunto = `${e.destino === 'tecnico' ? 'Suporte técnico' : 'Atendimento'}: ${tema} (#${protocolo})`;
    const conteudo = assistenteEquipeEmail({
        destino: e.destino === 'tecnico' ? 'Suporte técnico' : 'Gestão', protocolo, tema, nome: e.nome, telefone: e.telefone,
        email: e.email || undefined, empresa: e.empresa || undefined, motivo: e.motivo, conversa,
    });
    for (const para of new Set(destinatarios)) sendMailInBackground(para, assunto, conteudo, `IA T3 ${e.destino}`);
    return { protocolo, destino: e.destino };
}
