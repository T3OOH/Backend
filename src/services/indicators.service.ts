/**
 * Indicadores e processos comerciais (Gestão → Indicadores).
 *
 * Funções puras sobre os dados já buscados (controller): fáceis de testar e iguais no BackendJS.
 * O histórico do funil vem de crm_deal_events (gatilho no banco): cada negócio vira uma linha
 * do tempo de etapas, responsável e status, de onde saem lead time, tempo por etapa, SLAs e o
 * tempo de processo de cada comercial.
 */
import { z } from 'zod';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const STAGES = ['NEW_LEAD', 'FIRST_CONTACT', 'NEGOTIATION', 'WAITING_REPLY', 'PROPOSAL_SENT', 'POST_SALES'] as const;
export const STAGE_LABEL: Record<string, string> = {
    NEW_LEAD: 'Novo lead', FIRST_CONTACT: 'Primeiro contato', NEGOTIATION: 'Negociação',
    WAITING_REPLY: 'Aguardando retorno', PROPOSAL_SENT: 'Proposta enviada', POST_SALES: 'Pós-venda',
};

/** Metas dos processos (system_settings.crm_sla), editáveis pela gestão. */
export const slaSchema = z.object({
    primeiraRespostaHoras: z.number().positive().max(720),
    propostaHoras: z.number().positive().max(2160),
    fechamentoDias: z.number().positive().max(365),
    paradoDias: z.number().positive().max(180),
    pedidoAprovacaoHoras: z.number().positive().max(720),
    contatoRespostaHoras: z.number().positive().max(720),
}).strict();
export type Sla = z.infer<typeof slaSchema>;
export const SLA_PADRAO: Sla = { primeiraRespostaHoras: 2, propostaHoras: 48, fechamentoDias: 30, paradoDias: 7, pedidoAprovacaoHoras: 24, contatoRespostaHoras: 24 };

export function lerSla(valor: string | null | undefined): Sla {
    try {
        const parsed = slaSchema.partial().safeParse(JSON.parse(valor ?? '{}'));
        return { ...SLA_PADRAO, ...(parsed.success ? parsed.data : {}) };
    } catch {
        return SLA_PADRAO;
    }
}

export interface IndDeal {
    id: string; title: string; stage: string; status: string; line: string;
    sellerId: string | null; expectedValue: number; probability: number;
    createdAt: Date; updatedAt: Date; clientName: string;
    events: { type: string; fromValue: string | null; toValue: string | null; createdAt: Date }[];
}
export interface IndActivity { sellerId: string; dueDate: Date; isCompleted: boolean; updatedAt: Date; title: string; clientName: string }
export interface IndOrder { status: string; createdAt: Date; updatedAt: Date; totalValue: number }
export interface IndContact { status: string; createdAt: Date; updatedAt: Date; name: string }
export interface IndSeller { id: string; name: string; role: string }

const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const mediana = (v: number[]) => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (parte: number, total: number) => (total ? Math.round((parte / total) * 1000) / 10 : null);
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const horas = (ms: number) => ms / HOUR;

/** Linha do tempo de um negócio, reconstruída dos eventos. */
export function linhaDoTempo(deal: IndDeal, agora: Date) {
    const ev = [...deal.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const criado = ev.find((e) => e.type === 'CREATED');
    const inicio = criado?.createdAt ?? deal.createdAt;
    const sellerNaCriacao = ev.some((e) => e.type === 'SELLER' && e.createdAt.getTime() === inicio.getTime() && e.toValue);
    const primeiroDono = ev.find((e) => e.type === 'SELLER' && e.toValue);
    const fechamento = [...ev].reverse().find((e) => e.type === 'STATUS' && (e.toValue === 'WON' || e.toValue === 'LOST'));
    const fechado = deal.status !== 'OPEN' ? (fechamento?.createdAt ?? deal.updatedAt) : null;

    // Segmentos de etapa: [entrada, saída)
    const segmentos: { etapa: string; inicio: Date; fim: Date; aberto: boolean }[] = [];
    let etapa = criado?.toValue ?? ev.find((e) => e.type === 'STAGE')?.fromValue ?? deal.stage;
    let desde = inicio;
    for (const e of ev.filter((x) => x.type === 'STAGE')) {
        segmentos.push({ etapa, inicio: desde, fim: e.createdAt, aberto: false });
        etapa = e.toValue ?? etapa;
        desde = e.createdAt;
    }
    const fimAtual = fechado ?? agora;
    segmentos.push({ etapa, inicio: desde, fim: fimAtual, aberto: !fechado });

    const proposta = criado?.toValue === 'PROPOSAL_SENT' ? inicio : ev.find((e) => e.type === 'STAGE' && e.toValue === 'PROPOSAL_SENT')?.createdAt ?? null;
    const ultimaAtividade = ev.length ? ev[ev.length - 1].createdAt : deal.updatedAt;
    return {
        inicio, fechado, segmentos, proposta,
        /** Entrou na fila sem dono (lead do site): mede a primeira resposta. */
        entrouSemDono: !sellerNaCriacao,
        primeiroDono: primeiroDono && !sellerNaCriacao ? primeiroDono : null,
        ultimaMovimentacao: ultimaAtividade > deal.updatedAt ? ultimaAtividade : deal.updatedAt,
    };
}

export function buildIndicators(input: {
    deals: IndDeal[]; activities: IndActivity[]; orders: IndOrder[]; contacts: IndContact[];
    sellers: IndSeller[]; sla: Sla; agora: Date; dias: number;
}) {
    const { deals, activities, orders, contacts, sellers, sla, agora, dias } = input;
    const desde = new Date(agora.getTime() - dias * DAY);
    const noPeriodo = (d: Date | null) => !!d && d >= desde && d <= agora;
    const nomeDe = new Map(sellers.map((s) => [s.id, s.name]));
    const tl = new Map(deals.map((d) => [d.id, linhaDoTempo(d, agora)]));

    const criados = deals.filter((d) => noPeriodo(tl.get(d.id)!.inicio));
    const fechadosNoPeriodo = deals.filter((d) => noPeriodo(tl.get(d.id)!.fechado));
    const ganhos = fechadosNoPeriodo.filter((d) => d.status === 'WON');
    const perdidos = fechadosNoPeriodo.filter((d) => d.status === 'LOST');
    const abertos = deals.filter((d) => d.status === 'OPEN');

    // ---------------------------- processos (SLA) ----------------------------
    // 1. Primeira resposta: lead que entrou sem dono até alguém assumir
    const respostas: { deal: IndDeal; h: number; dono: string | null }[] = [];
    const semDonoAtrasados: IndDeal[] = [];
    for (const d of criados) {
        const t = tl.get(d.id)!;
        if (!t.entrouSemDono) continue;
        if (t.primeiroDono) respostas.push({ deal: d, h: horas(t.primeiroDono.createdAt.getTime() - t.inicio.getTime()), dono: t.primeiroDono.toValue });
        else if (horas(agora.getTime() - t.inicio.getTime()) > sla.primeiraRespostaHoras) semDonoAtrasados.push(d);
    }
    const respostaNoPrazo = respostas.filter((r) => r.h <= sla.primeiraRespostaHoras).length;

    // 2. Proposta: da entrada até a proposta enviada
    const propostas: number[] = [];
    let propostasAtrasadasAbertas = 0;
    for (const d of criados) {
        const t = tl.get(d.id)!;
        if (t.proposta) propostas.push(horas(t.proposta.getTime() - t.inicio.getTime()));
        else if (d.status === 'OPEN' && horas(agora.getTime() - t.inicio.getTime()) > sla.propostaHoras) propostasAtrasadasAbertas++;
    }
    const propostaNoPrazo = propostas.filter((h) => h <= sla.propostaHoras).length;

    // 3. Fechamento (lead time): da entrada ao ganho/perda
    const leadTimes = fechadosNoPeriodo.map((d) => (tl.get(d.id)!.fechado!.getTime() - tl.get(d.id)!.inicio.getTime()) / DAY);
    const ciclos = ganhos.map((d) => (tl.get(d.id)!.fechado!.getTime() - tl.get(d.id)!.inicio.getTime()) / DAY);
    const fechamentoNoPrazo = leadTimes.filter((dd) => dd <= sla.fechamentoDias).length;

    // 4. Negócios parados: abertos sem movimentação há mais do que a meta
    const parados = abertos
        .map((d) => ({ d, diasParado: (agora.getTime() - tl.get(d.id)!.ultimaMovimentacao.getTime()) / DAY }))
        .filter((x) => x.diasParado > sla.paradoDias)
        .sort((a, b) => b.diasParado - a.diasParado);

    // 5. Pedidos do site: tempo até aprovar/recusar (pela última alteração: aproximado)
    const pedidosPeriodo = orders.filter((o) => noPeriodo(o.createdAt));
    const pedidosDecididos = pedidosPeriodo.filter((o) => o.status !== 'PENDING').map((o) => horas(o.updatedAt.getTime() - o.createdAt.getTime()));
    const pedidosPendentesAtrasados = orders.filter((o) => o.status === 'PENDING' && horas(agora.getTime() - o.createdAt.getTime()) > sla.pedidoAprovacaoHoras).length;

    // 6. Contatos do site: tempo até resolver (aproximado pela última alteração)
    const contatosPeriodo = contacts.filter((c) => noPeriodo(c.createdAt));
    const contatosResolvidos = contatosPeriodo.filter((c) => c.status === 'RESOLVED').map((c) => horas(c.updatedAt.getTime() - c.createdAt.getTime()));
    const contatosAtrasados = contacts.filter((c) => c.status !== 'RESOLVED' && horas(agora.getTime() - c.createdAt.getTime()) > sla.contatoRespostaHoras);

    // 7. Follow-up: atividades da agenda feitas no prazo (conclusão pela última alteração: aproximado)
    const atividadesPeriodo = activities.filter((a) => noPeriodo(a.dueDate) || (!a.isCompleted && a.dueDate < agora));
    const atrasadas = activities.filter((a) => !a.isCompleted && a.dueDate < agora);
    const concluidas = atividadesPeriodo.filter((a) => a.isCompleted);
    const concluidasNoPrazo = concluidas.filter((a) => a.updatedAt.getTime() <= a.dueDate.getTime() + DAY).length;

    const processos = [
        {
            id: 'primeira-resposta', nome: 'Primeira resposta ao lead', dono: 'Comercial',
            descricao: 'Do lead entrar na fila (site, mapa, T3 Solution) até um consultor assumir.',
            meta: `até ${sla.primeiraRespostaHoras} h`, unidade: 'h',
            mediaMedida: r1(media(respostas.map((r) => r.h))), medianaMedida: r1(mediana(respostas.map((r) => r.h))),
            amostras: respostas.length + semDonoAtrasados.length,
            cumprimentoPct: pct(respostaNoPrazo, respostas.length + semDonoAtrasados.length),
            emAtraso: semDonoAtrasados.length,
        },
        {
            id: 'proposta', nome: 'Proposta enviada', dono: 'Comercial',
            descricao: 'Da entrada do negócio até a etapa "Proposta enviada".',
            meta: `até ${sla.propostaHoras} h`, unidade: 'h',
            mediaMedida: r1(media(propostas)), medianaMedida: r1(mediana(propostas)),
            amostras: propostas.length + propostasAtrasadasAbertas,
            cumprimentoPct: pct(propostaNoPrazo, propostas.length + propostasAtrasadasAbertas),
            emAtraso: propostasAtrasadasAbertas,
        },
        {
            id: 'fechamento', nome: 'Fechamento (lead time)', dono: 'Comercial',
            descricao: 'Da entrada até o negócio ser ganho ou perdido.',
            meta: `até ${sla.fechamentoDias} dias`, unidade: 'dias',
            mediaMedida: r1(media(leadTimes)), medianaMedida: r1(mediana(leadTimes)),
            amostras: leadTimes.length, cumprimentoPct: pct(fechamentoNoPrazo, leadTimes.length),
            emAtraso: abertos.filter((d) => (agora.getTime() - tl.get(d.id)!.inicio.getTime()) / DAY > sla.fechamentoDias).length,
        },
        {
            id: 'movimentacao', nome: 'Negócio em movimento', dono: 'Comercial',
            descricao: 'Todo negócio aberto precisa mudar de etapa, status ou responsável dentro da meta.',
            meta: `parado no máx. ${sla.paradoDias} dias`, unidade: 'negócios',
            mediaMedida: null, medianaMedida: null, amostras: abertos.length,
            cumprimentoPct: pct(abertos.length - parados.length, abertos.length), emAtraso: parados.length,
        },
        {
            id: 'pedido', nome: 'Aprovação de pedido do site', dono: 'Gestão',
            descricao: 'Do pedido feito no site até ser aprovado ou recusado (pela última alteração do pedido).',
            meta: `até ${sla.pedidoAprovacaoHoras} h`, unidade: 'h',
            mediaMedida: r1(media(pedidosDecididos)), medianaMedida: r1(mediana(pedidosDecididos)),
            amostras: pedidosDecididos.length,
            cumprimentoPct: pct(pedidosDecididos.filter((h) => h <= sla.pedidoAprovacaoHoras).length, pedidosDecididos.length + pedidosPendentesAtrasados),
            emAtraso: pedidosPendentesAtrasados,
        },
        {
            id: 'contato', nome: 'Resposta a contato do site', dono: 'Comercial',
            descricao: 'Do formulário de contato até ser marcado como resolvido (pela última alteração).',
            meta: `até ${sla.contatoRespostaHoras} h`, unidade: 'h',
            mediaMedida: r1(media(contatosResolvidos)), medianaMedida: r1(mediana(contatosResolvidos)),
            amostras: contatosResolvidos.length,
            cumprimentoPct: pct(contatosResolvidos.filter((h) => h <= sla.contatoRespostaHoras).length, contatosResolvidos.length + contatosAtrasados.length),
            emAtraso: contatosAtrasados.length,
        },
        {
            id: 'follow-up', nome: 'Follow-up no prazo', dono: 'Comercial',
            descricao: 'Atividades da agenda (ligação, reunião, retorno) concluídas até o dia combinado.',
            meta: 'no dia previsto', unidade: 'atividades',
            mediaMedida: null, medianaMedida: null, amostras: concluidas.length + atrasadas.length,
            cumprimentoPct: pct(concluidasNoPrazo, concluidas.length + atrasadas.length), emAtraso: atrasadas.length,
        },
    ];

    // ---------------------------- etapas do funil ----------------------------
    const etapas = STAGES.map((etapa) => {
        const duracoes: number[] = [];
        for (const d of deals) {
            for (const s of tl.get(d.id)!.segmentos) {
                if (s.etapa === etapa && !s.aberto && noPeriodo(s.fim)) duracoes.push(horas(s.fim.getTime() - s.inicio.getTime()));
            }
        }
        const nela = abertos.filter((d) => d.stage === etapa);
        const idades = nela.map((d) => horas(agora.getTime() - tl.get(d.id)!.segmentos.at(-1)!.inicio.getTime()));
        return {
            etapa, nome: STAGE_LABEL[etapa],
            abertos: nela.length, valorAberto: nela.reduce((a, d) => a + d.expectedValue, 0),
            tempoMedioHoras: r1(media(duracoes)), tempoMedianoHoras: r1(mediana(duracoes)), passagens: duracoes.length,
            idadeMediaAbertosHoras: r1(media(idades)),
        };
    });
    const gargalo = [...etapas].filter((e) => e.tempoMedioHoras !== null).sort((a, b) => (b.tempoMedioHoras ?? 0) - (a.tempoMedioHoras ?? 0))[0] ?? null;

    // ---------------------------- por comercial ----------------------------
    const comerciais = sellers.map((s) => {
        const meus = deals.filter((d) => d.sellerId === s.id);
        const meusCriados = meus.filter((d) => noPeriodo(tl.get(d.id)!.inicio));
        const meusGanhos = ganhos.filter((d) => d.sellerId === s.id);
        const meusPerdidos = perdidos.filter((d) => d.sellerId === s.id);
        const minhasRespostas = respostas.filter((r) => r.dono === s.id).map((r) => r.h);
        const meusLeadTimes = [...meusGanhos, ...meusPerdidos].map((d) => (tl.get(d.id)!.fechado!.getTime() - tl.get(d.id)!.inicio.getTime()) / DAY);
        const porEtapa: Record<string, number | null> = {};
        for (const etapa of STAGES) {
            const dur: number[] = [];
            for (const d of meus) for (const seg of tl.get(d.id)!.segmentos) if (seg.etapa === etapa && !seg.aberto && noPeriodo(seg.fim)) dur.push(horas(seg.fim.getTime() - seg.inicio.getTime()));
            porEtapa[etapa] = r1(media(dur));
        }
        const minhasAtividades = activities.filter((a) => a.sellerId === s.id);
        const receita = meusGanhos.reduce((a, d) => a + d.expectedValue, 0);
        return {
            id: s.id, nome: s.name, perfil: s.role,
            negociosNoPeriodo: meusCriados.length, abertos: meus.filter((d) => d.status === 'OPEN').length,
            ganhos: meusGanhos.length, perdidos: meusPerdidos.length,
            taxaConversaoPct: pct(meusGanhos.length, meusGanhos.length + meusPerdidos.length),
            receita, ticketMedio: meusGanhos.length ? receita / meusGanhos.length : null,
            pipelineAberto: meus.filter((d) => d.status === 'OPEN').reduce((a, d) => a + d.expectedValue, 0),
            primeiraRespostaMediaHoras: r1(media(minhasRespostas)),
            primeiraRespostaNoPrazoPct: pct(minhasRespostas.filter((h) => h <= sla.primeiraRespostaHoras).length, minhasRespostas.length),
            leadTimeMedioDias: r1(media(meusLeadTimes)),
            tempoPorEtapaHoras: porEtapa,
            atividadesConcluidas: minhasAtividades.filter((a) => a.isCompleted && noPeriodo(a.updatedAt)).length,
            atividadesAtrasadas: minhasAtividades.filter((a) => !a.isCompleted && a.dueDate < agora).length,
            parados: parados.filter((p) => p.d.sellerId === s.id).length,
        };
    }).filter((c) => c.negociosNoPeriodo || c.abertos || c.ganhos || c.perdidos || c.atividadesAtrasadas || c.atividadesConcluidas)
        .sort((a, b) => b.receita - a.receita || b.ganhos - a.ganhos);

    // ---------------------------- alertas ----------------------------
    const alertas = [
        ...semDonoAtrasados.map((d) => ({ tipo: 'sem-dono', titulo: 'Lead sem consultor acima do SLA', negocioId: d.id, negocio: d.title, cliente: d.clientName, comercial: null as string | null, desde: tl.get(d.id)!.inicio, horas: r1(horas(agora.getTime() - tl.get(d.id)!.inicio.getTime())) })),
        ...parados.map(({ d, diasParado }) => ({ tipo: 'parado', titulo: `Parado em ${STAGE_LABEL[d.stage] ?? d.stage}`, negocioId: d.id, negocio: d.title, cliente: d.clientName, comercial: d.sellerId ? nomeDe.get(d.sellerId) ?? null : null, desde: tl.get(d.id)!.ultimaMovimentacao, horas: r1(diasParado * 24) })),
        ...atrasadas.map((a) => ({ tipo: 'atividade', titulo: `Atividade atrasada: ${a.title}`, negocioId: null, negocio: null, cliente: a.clientName, comercial: nomeDe.get(a.sellerId) ?? null, desde: a.dueDate, horas: r1(horas(agora.getTime() - a.dueDate.getTime())) })),
        ...contatosAtrasados.map((c) => ({ tipo: 'contato', titulo: 'Contato do site sem resposta', negocioId: null, negocio: null, cliente: c.name, comercial: null, desde: c.createdAt, horas: r1(horas(agora.getTime() - c.createdAt.getTime())) })),
    ].sort((a, b) => (b.horas ?? 0) - (a.horas ?? 0)).slice(0, 30);

    // ---------------------------- série semanal (12 semanas) ----------------------------
    const semanas = Array.from({ length: 12 }, (_, i) => {
        const fim = new Date(agora.getTime() - (11 - i) * 7 * DAY);
        const ini = new Date(fim.getTime() - 7 * DAY);
        const entre = (d: Date | null) => !!d && d > ini && d <= fim;
        return {
            inicio: ini.toISOString().slice(0, 10),
            leads: deals.filter((d) => entre(tl.get(d.id)!.inicio)).length,
            ganhos: deals.filter((d) => d.status === 'WON' && entre(tl.get(d.id)!.fechado)).length,
            perdidos: deals.filter((d) => d.status === 'LOST' && entre(tl.get(d.id)!.fechado)).length,
        };
    });

    const receitaGanha = ganhos.reduce((a, d) => a + d.expectedValue, 0);
    return {
        periodo: { dias, de: desde.toISOString(), ate: agora.toISOString() },
        sla,
        kpis: {
            leadsNovos: criados.length,
            ganhos: ganhos.length,
            perdidos: perdidos.length,
            taxaConversaoPct: pct(ganhos.length, ganhos.length + perdidos.length),
            receitaGanha,
            ticketMedio: ganhos.length ? receitaGanha / ganhos.length : null,
            pipelineAberto: abertos.reduce((a, d) => a + d.expectedValue, 0),
            previsaoPonderada: abertos.reduce((a, d) => a + d.expectedValue * (d.probability / 100), 0),
            negociosAbertos: abertos.length,
            leadTimeMedioDias: r1(media(leadTimes)),
            cicloVendaMedioDias: r1(media(ciclos)),
            primeiraRespostaMediaHoras: r1(media(respostas.map((r) => r.h))),
            slaCumprimentoPct: (() => {
                const comAmostra = processos.filter((p) => p.cumprimentoPct !== null);
                return comAmostra.length ? r1(media(comAmostra.map((p) => p.cumprimentoPct as number))) : null;
            })(),
            emAtraso: processos.reduce((a, p) => a + p.emAtraso, 0),
        },
        processos,
        etapas,
        gargalo: gargalo ? { etapa: gargalo.etapa, nome: gargalo.nome, tempoMedioHoras: gargalo.tempoMedioHoras } : null,
        comerciais,
        alertas,
        semanas,
    };
}
