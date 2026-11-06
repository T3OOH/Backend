/**
 * Servidor MCP público da T3 LED (Model Context Protocol, transporte Streamable HTTP sem sessão).
 *
 * Assistentes de IA (Claude, ChatGPT, Copilot...) consultam os painéis de LED e o contato comercial
 * sem "ler" o site. Só leitura e só dados que já são públicos em GET /panels: nada aqui cria
 * pedido, mexe em conta ou expõe dado interno.
 *
 *   POST /mcp              JSON-RPC 2.0 (initialize, ping, tools/list, tools/call)
 *   GET  /mcp/server-card  Server Card (SEP-2127, https://github.com/modelcontextprotocol/ext-server-card)
 *
 * Montado antes do CORS restrito do app: qualquer origem pode chamar (dados públicos).
 */
import crypto from 'crypto';
import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PanelStatus } from '@prisma/client';
import { PanelService } from '../services/panel.service';

const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const PUBLIC_URL = 'https://api.t3led.com.br/mcp';

export const SERVER_CARD = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: 'br.com.t3led/paineis',
    version: SERVER_VERSION,
    title: 'T3 LED - painéis de LED em Goiânia',
    description: 'Painéis de LED e mídia exterior (OOH/DOOH) da T3 LED em Goiânia e Goiás: pontos, valores e contato.',
    websiteUrl: 'https://t3led.com.br/',
    icons: [{ src: 'https://t3led.com.br/apple-touch-icon.png', mimeType: 'image/png', sizes: ['180x180'] }],
    remotes: [{ type: 'streamable-http', url: PUBLIC_URL, supportedProtocolVersions: PROTOCOL_VERSIONS }],
};
const SERVER_CARD_JSON = JSON.stringify(SERVER_CARD);
const SERVER_CARD_ETAG = `"${crypto.createHash('sha256').update(SERVER_CARD_JSON).digest('hex').slice(0, 32)}"`;

const INSTRUCTIONS = 'Servidor da T3 LED (T3 OOH), rede de painéis de LED em Goiânia e no interior de Goiás. '
    + 'Use buscar_paineis para listar pontos, formatos e valores mensais e contato_comercial para encaminhar orçamentos. '
    + 'Desconto por prazo no valor mensal: 15% em 3 meses, 20% em 6 meses e 30% a partir de 12 meses. '
    + 'O orçamento é feito em https://t3led.com.br/mapa.';

const CONTATO = {
    empresa: 'T3 LED Mídia e Tecnologia',
    cnpj: '43.773.494/0001-50',
    cidade: 'Goiânia - GO',
    whatsapp: [
        { nome: 'Victor Hugo', telefone: '+55 62 9320-6010' },
        { nome: 'Lucas Dourado', telefone: '+55 64 9283-2807' },
    ],
    email: 'contato@t3comunicacao.com',
    formulario: 'https://t3led.com.br/contato',
    orcamento: 'https://t3led.com.br/mapa',
};

const TOOLS = [
    {
        name: 'buscar_paineis',
        title: 'Buscar painéis de LED',
        description: 'Lista os painéis de LED disponíveis da T3 LED com cidade, endereço, formato, resolução, impactos estimados, tempo de inserção e valor mensal (R$). Filtra por texto (cidade, bairro ou avenida).',
        inputSchema: {
            type: 'object',
            properties: {
                busca: { type: 'string', description: 'Cidade, bairro ou avenida (opcional)' },
                limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de painéis (padrão 30)' },
            },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'contato_comercial',
        title: 'Contato comercial',
        description: 'Contatos do comercial da T3 LED (WhatsApp, e-mail e links de orçamento) para anúncios em painéis de LED e para a T3 Solution.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
];

type JsonRpcId = string | number | null;
interface JsonRpcRequest { jsonrpc?: string; id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> }

class RpcError extends Error {
    constructor(readonly code: number, message: string) { super(message); }
}

const panelService = new PanelService();

async function buscarPaineis(args: Record<string, unknown>) {
    const busca = typeof args.busca === 'string' ? args.busca.trim().toLowerCase() : '';
    const limiteBruto = Number(args.limite ?? 30);
    const limite = Number.isFinite(limiteBruto) ? Math.min(100, Math.max(1, Math.trunc(limiteBruto))) : 30;
    const paineis = await panelService.getAllPanels({ status: PanelStatus.AVAILABLE });
    const filtrados = paineis
        .filter((p) => !busca || `${p.name} ${p.address ?? ''} ${p.city ?? ''}`.toLowerCase().includes(busca))
        .slice(0, limite)
        .map((p) => ({
            nome: p.name,
            cidade: p.city,
            estado: p.state,
            endereco: p.address,
            formato: p.size,
            resolucao: p.px,
            impactos_estimados: p.impacts,
            segundos_por_insercao: p.playbackSeconds,
            valor_mensal: p.price,
            latitude: p.lat,
            longitude: p.lng,
        }));
    const resumo = filtrados.length
        ? filtrados.map((p) => `- ${p.nome}${p.cidade ? ` (${p.cidade}${p.estado ? `/${p.estado}` : ''})` : ''}`
            + `${p.formato ? ` · ${p.formato}` : ''}${p.valor_mensal ? ` · R$ ${p.valor_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês` : ''}`).join('\n')
        : `Nenhum painel encontrado${busca ? ` para "${busca}"` : ''}.`;
    const texto = `${filtrados.length} painel(is) disponível(is). Desconto por prazo: 15% em 3 meses, 20% em 6 e 30% a partir de 12.\n${resumo}\nOrçamento: ${CONTATO.orcamento}`;
    return { content: [{ type: 'text', text: texto }], structuredContent: { paineis: filtrados } };
}

async function handle(rpc: JsonRpcRequest) {
    const method = rpc.method;
    if (typeof method !== 'string') throw new RpcError(-32600, 'Requisição inválida.');
    const params = rpc.params ?? {};

    switch (method) {
        case 'initialize': {
            const pedido = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
            return {
                protocolVersion: PROTOCOL_VERSIONS.includes(pedido) ? pedido : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: SERVER_CARD.name, title: SERVER_CARD.title, version: SERVER_VERSION, websiteUrl: SERVER_CARD.websiteUrl },
                instructions: INSTRUCTIONS,
            };
        }
        case 'ping':
            return {};
        case 'tools/list':
            return { tools: TOOLS };
        case 'tools/call': {
            const nome = params.name;
            const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
            if (nome === 'buscar_paineis') return buscarPaineis(args);
            if (nome === 'contato_comercial') {
                const texto = `${CONTATO.empresa} (CNPJ ${CONTATO.cnpj}), ${CONTATO.cidade}.\n`
                    + CONTATO.whatsapp.map((w) => `WhatsApp ${w.nome}: ${w.telefone}`).join('\n')
                    + `\nE-mail: ${CONTATO.email}\nFormulário: ${CONTATO.formulario}\nOrçamento pelo mapa: ${CONTATO.orcamento}`;
                return { content: [{ type: 'text', text: texto }], structuredContent: CONTATO };
            }
            throw new RpcError(-32602, `Ferramenta desconhecida: ${String(nome)}.`);
        }
        default:
            throw new RpcError(-32601, `Método não suportado: ${method}.`);
    }
}

export const mcpRoutes = Router();

// Aberto a qualquer origem (dados públicos), com limite próprio por IP
mcpRoutes.use((req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, If-None-Match, Mcp-Protocol-Version, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'ETag, Mcp-Protocol-Version',
    });
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
});
mcpRoutes.use(rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Muitas requisições. Tente de novo em um minuto.' } },
}));

mcpRoutes.get('/server-card', (req: Request, res: Response) => {
    res.set({ 'Cache-Control': 'public, max-age=3600', ETag: SERVER_CARD_ETAG });
    if (req.get('If-None-Match') === SERVER_CARD_ETAG) { res.status(304).end(); return; }
    res.type('application/mcp-server-card+json').send(SERVER_CARD_JSON);
});

mcpRoutes.post('/', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
    const rpc = req.body as JsonRpcRequest | JsonRpcRequest[];
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
        res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Envie uma única mensagem JSON-RPC 2.0.' } });
        return;
    }
    // Notificações (sem id) não têm resposta
    if (rpc.id === undefined) { res.status(202).end(); return; }
    try {
        const result = await handle(rpc);
        res.json({ jsonrpc: '2.0', id: rpc.id, result });
    } catch (err) {
        const code = err instanceof RpcError ? err.code : -32603;
        const message = err instanceof RpcError ? err.message : 'Erro interno.';
        res.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code, message } });
    }
});

// Sem sessão e sem eventos do servidor: só POST
mcpRoutes.all('/', (_req: Request, res: Response) => {
    res.set('Allow', 'POST, OPTIONS').status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST com JSON-RPC 2.0.' } });
});

// JSON malformado no POST /mcp: erro de parse do JSON-RPC, não 500
mcpRoutes.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
        res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } });
        return;
    }
    next(err);
});
