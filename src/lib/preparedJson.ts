import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Request, Response } from 'express';

/**
 * Respostas públicas que saem do memoryCache (lista de painéis, mapa, página do painel).
 *
 * No teste de carga com 1000 usuários, montar o JSON a cada pedido (124 KB só a lista) era a
 * maior fatia de CPU da API. Aqui o JSON, a versão gzip e o ETag são feitos uma vez por valor
 * em cache (o mesmo objeto até o cache renovar) e reaproveitados em todos os pedidos.
 */
type Prepared = { json: string; gzip: Buffer; etag: string };

const prepared = new WeakMap<object, Prepared>();

function prepare(value: object): Prepared {
    let entry = prepared.get(value);
    if (!entry) {
        const json = JSON.stringify(value);
        entry = { json, gzip: gzipSync(json), etag: `"${createHash('sha1').update(json).digest('base64url')}"` };
        prepared.set(value, entry);
    }
    return entry;
}

/** Envia o valor em cache: 304 se o navegador já tem esta versão, gzip quando ele aceita. */
export function sendPreparedJson(req: Request, res: Response, value: object) {
    const entry = prepare(value);
    res.set('ETag', entry.etag);
    res.vary('Accept-Encoding');
    if (req.fresh) return res.status(304).end();

    res.type('application/json');
    if (req.acceptsEncodings('gzip') === 'gzip') {
        res.set('Content-Encoding', 'gzip');
        return res.send(entry.gzip);
    }
    return res.send(entry.json);
}
