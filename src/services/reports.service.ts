/**
 * Relatórios da gestão: cálculos puros sobre negócios, pedidos e painéis.
 * O controller só busca os dados; tudo aqui é testável sem banco.
 */

const DAY = 86_400_000;

export type ReportDeal = {
    stage: string;
    status: 'OPEN' | 'WON' | 'LOST';
    line: string;
    expectedValue: number;
    probability: number;
    createdAt: Date;
    updatedAt: Date;
    attribution: unknown;
};

export type ReportOrder = {
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
    totalValue: number;
    createdAt: Date;
    updatedAt: Date;
};

/** Primeiro dia do mês, em UTC, `offset` meses a partir de `date`. */
const monthStart = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const monthKey = (date: Date) => date.toISOString().slice(0, 7);

const sourceOf = (attribution: unknown) => {
    const source = (attribution as { source?: unknown } | null)?.source;
    return typeof source === 'string' && source.trim() ? source.trim().toLowerCase() : 'sem registro';
};

export function buildSummary(deals: ReportDeal[], orders: ReportOrder[], now: Date, days: number) {
    const since = new Date(now.getTime() - days * DAY);
    const inPeriod = (d: Date) => d >= since && d <= now;

    // Negócios fechados no período (ganhos e perdidos): a data de fechamento é a última atualização
    const won = deals.filter((d) => d.status === 'WON' && inPeriod(d.updatedAt));
    const lost = deals.filter((d) => d.status === 'LOST' && inPeriod(d.updatedAt));
    const open = deals.filter((d) => d.status === 'OPEN');
    const closedOrders = orders.filter((o) => (o.status === 'APPROVED' || o.status === 'COMPLETED') && inPeriod(o.updatedAt));

    const wonValue = won.reduce((s, d) => s + d.expectedValue, 0);
    const ordersValue = closedOrders.reduce((s, o) => s + o.totalValue, 0);
    const sales = won.length + closedOrders.length;
    const cycle = won.map((d) => (d.updatedAt.getTime() - d.createdAt.getTime()) / DAY);

    // Funil: negócios em aberto por etapa, na ordem do processo
    const STAGES = ['NEW_LEAD', 'FIRST_CONTACT', 'NEGOTIATION', 'WAITING_REPLY', 'PROPOSAL_SENT', 'POST_SALES'];
    const funnel = STAGES.map((stage) => {
        const list = open.filter((d) => d.stage === stage);
        return { stage, count: list.length, value: list.reduce((s, d) => s + d.expectedValue, 0) };
    });

    // Receita fechada por mês (12 meses, o atual por último)
    const months = Array.from({ length: 12 }, (_, i) => monthKey(monthStart(now, i - 11)));
    const byMonth = new Map(months.map((m) => [m, { month: m, deals: 0, orders: 0 }]));
    for (const d of deals) if (d.status === 'WON') { const row = byMonth.get(monthKey(d.updatedAt)); if (row) row.deals += d.expectedValue; }
    for (const o of orders) if (o.status === 'APPROVED' || o.status === 'COMPLETED') { const row = byMonth.get(monthKey(o.updatedAt)); if (row) row.orders += o.totalValue; }

    // Origem dos negócios criados no período e quantos já viraram venda
    const sources = new Map<string, { source: string; leads: number; won: number; wonValue: number }>();
    for (const d of deals.filter((x) => inPeriod(x.createdAt))) {
        const key = sourceOf(d.attribution);
        const row = sources.get(key) ?? { source: key, leads: 0, won: 0, wonValue: 0 };
        row.leads += 1;
        if (d.status === 'WON') { row.won += 1; row.wonValue += d.expectedValue; }
        sources.set(key, row);
    }

    const lines = ['OOH', 'SOLUTION'].map((line) => ({
        line,
        won: won.filter((d) => d.line === line).reduce((s, d) => s + d.expectedValue, 0),
        open: open.filter((d) => d.line === line).reduce((s, d) => s + d.expectedValue, 0),
    }));

    return {
        days,
        totals: {
            revenue: wonValue + ordersValue,
            sales,
            averageTicket: sales ? (wonValue + ordersValue) / sales : 0,
            conversion: won.length + lost.length ? won.length / (won.length + lost.length) : null,
            won: won.length,
            lost: lost.length,
            averageCycleDays: cycle.length ? cycle.reduce((s, v) => s + v, 0) / cycle.length : null,
            newDeals: deals.filter((d) => inPeriod(d.createdAt)).length,
            openValue: open.reduce((s, d) => s + d.expectedValue, 0),
            // Valor em aberto ponderado pela probabilidade de cada negócio
            forecast: open.reduce((s, d) => s + d.expectedValue * (Math.min(100, Math.max(0, d.probability)) / 100), 0),
        },
        funnel,
        monthly: [...byMonth.values()].map((m) => ({ ...m, total: m.deals + m.orders })),
        sources: [...sources.values()].sort((a, b) => b.leads - a.leads),
        lines,
    };
}

export type Booking = { panelId: string; start: Date; end: Date; label: string };
export type ReportPanel = { id: string; name: string; city: string | null; state: string | null; status: string };

/** Ocupação mês a mês: cada célula diz se o painel está contratado naquele mês e por quem. */
export function buildOccupancy(panels: ReportPanel[], bookings: Booking[], now: Date, months: number) {
    const starts = Array.from({ length: months }, (_, i) => monthStart(now, i));
    const grid = panels.map((p) => {
        const own = bookings.filter((b) => b.panelId === p.id);
        const cells = starts.map((start) => {
            const end = monthStart(start, 1);
            const hit = own.find((b) => b.start < end && b.end > start);
            return hit ? hit.label : null;
        });
        return { id: p.id, name: p.name, city: p.city, state: p.state, status: p.status, months: cells };
    });
    const busy = grid.reduce((s, row) => s + row.months.filter(Boolean).length, 0);
    return {
        months: starts.map(monthKey),
        panels: grid,
        rate: grid.length ? busy / (grid.length * months) : 0,
    };
}

/** Contrato a partir de uma data e um prazo em meses. */
export const addMonths = (date: Date, months: number) => {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() + Math.max(1, months));
    return d;
};
