import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { encaminharSchema, mensagemSchema } from '../lib/assistente';
import { encaminhar, inicio, responder } from '../services/assistente.service';

/**
 * Balão de dúvidas do site (IA T3). Público: qualquer visitante usa.
 * GET /assistente (temas e respostas prontas), POST /assistente/mensagem (IA),
 * POST /assistente/encaminhar (comercial, gestão ou técnico).
 */
export const assistenteRoutes = Router();

// A IA custa por mensagem: limite por IP, além do limite geral da API
const limiteIa = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas perguntas em pouco tempo. Aguarde alguns minutos ou fale com a nossa equipe.' },
});
const limiteEncaminhar = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitos pedidos em pouco tempo. Aguarde e tente de novo, ou use a página de contato.' },
});

assistenteRoutes.get('/', async (_req: Request, res: Response) => {
    try {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json(await inicio());
    } catch (error) {
        console.error('[IA T3] inicio Error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

assistenteRoutes.post('/mensagem', limiteIa, async (req: Request, res: Response) => {
    const parsed = mensagemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Mensagem inválida.', details: parsed.error.issues });
    if (parsed.data.mensagens[parsed.data.mensagens.length - 1].de !== 'visitante') return res.status(400).json({ error: 'A última mensagem precisa ser do visitante.' });
    return res.json(await responder(parsed.data.tema, parsed.data.mensagens));
});

assistenteRoutes.post('/encaminhar', limiteEncaminhar, async (req: Request, res: Response) => {
    const parsed = encaminharSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.', details: parsed.error.issues });
    // Campo-isca preenchido: robô. Responde como sucesso e não registra nada
    if (parsed.data.site) return res.status(201).json({ protocolo: 'RECEBIDO', destino: parsed.data.destino });
    try {
        const r = await encaminhar({ ...parsed.data, email: parsed.data.email || undefined, ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
        return res.status(201).json(r);
    } catch (error) {
        console.error('[IA T3] encaminhar Error:', error);
        return res.status(500).json({ error: 'Não foi possível enviar agora. Tente de novo ou use a página de contato.' });
    }
});
