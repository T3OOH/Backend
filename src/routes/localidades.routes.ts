import { Router } from 'express';
import { z } from 'zod';
import { buscarMunicipios, UFS } from '../lib/localidades';

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
