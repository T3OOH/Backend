import { Router } from 'express';
import { z } from 'zod';
import { buscarMunicipios, UFS } from '../lib/localidades';
import { LinkInvalido, resolverLinkGoogle, SemCoordenadas } from '../lib/googleMaps';
import { authMiddleware, MANAGEMENT_ROLES, requireRoles } from '../middlewares/auth.middleware';

/**
 * Municípios do IBGE para o campo cidade dos formulários (painéis, clientes do CRM, app desktop).
 * Público: é a lista oficial do IBGE, sem dado da T3.
 */
export const localidadesRoutes = Router();

const buscaSchema = z.object({
    busca: z.string().trim().max(80).default(''),
    uf: z.string().trim().max(30).optional(),
    limite: z.coerce.number().int().min(1).max(50).default(10),
});

localidadesRoutes.get('/municipios', (req, res) => {
    const { busca, uf, limite } = buscaSchema.parse({
        busca: typeof req.query.busca === 'string' ? req.query.busca : undefined,
        uf: typeof req.query.uf === 'string' ? req.query.uf : undefined,
        limite: typeof req.query.limite === 'string' ? req.query.limite : undefined,
    });
    // A lista muda raramente: o navegador e a CDN podem guardar por 1 dia
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(buscarMunicipios(busca, uf, limite));
});

localidadesRoutes.get('/ufs', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(Object.entries(UFS).map(([sigla, nome]) => ({ sigla, nome })));
});

const linkSchema = z.object({ url: z.string().trim().min(3).max(2000) });

/**
 * Posição de um link do Google Maps (link curto do "Compartilhar", link longo ou "lat, lng"),
 * para o cadastro de painéis. Só gestão: a rota abre links (apenas do Google) pelo servidor.
 */
localidadesRoutes.get('/google-maps', authMiddleware, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    const parsed = linkSchema.safeParse({ url: typeof req.query.url === 'string' ? req.query.url : '' });
    if (!parsed.success) return res.status(400).json({ error: 'Cole o link do Google Maps.' });
    try {
        return res.json(await resolverLinkGoogle(parsed.data.url));
    } catch (error) {
        if (error instanceof LinkInvalido) return res.status(400).json({ error: error.message });
        if (error instanceof SemCoordenadas) return res.status(422).json({ error: error.message });
        console.error('[Localidades] google-maps Error:', error);
        return res.status(502).json({ error: 'Não foi possível abrir o link do Google Maps agora. Tente de novo.' });
    }
});
