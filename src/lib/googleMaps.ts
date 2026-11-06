/**
 * Localização a partir de um link do Google Maps (cadastro de painéis): aceita o link curto do
 * botão "Compartilhar" (maps.app.goo.gl), o link longo da barra de endereço e "lat, lng".
 * Sem API do Google (nem chave, nem custo): o link curto só redireciona para o longo, que já traz
 * as coordenadas. Só segue endereços do próprio Google, para a rota não virar um proxy aberto.
 */

export interface LocalGoogle {
    lat: number;
    lng: number;
    /** pino = marcador do lugar (!3d!4d), busca = q/query/ll, centro = centro da câmera (@lat,lng). */
    fonte: 'pino' | 'busca' | 'centro' | 'texto';
    /** Nome do lugar (/place/Nome/), quando o link traz. */
    nome?: string;
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const valido = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const arredondar = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Coordenadas de um link longo (ou texto), da mais exata para a menos exata:
 * marcador do lugar (!3d lat !4d lng), parâmetro de busca (q, query, ll, destination, center),
 * centro da câmera (@lat,lng) e, por último, "lat, lng" solto no texto.
 */
export function lerCoordenadas(texto: string): LocalGoogle | null {
    let t = texto.trim();
    try { t = decodeURIComponent(t); } catch { /* texto com % solto: usa como veio */ }
    const nome = t.match(/\/place\/([^/@?]+)/)?.[1]?.replace(/\+/g, ' ').trim();
    const com = (lat: number, lng: number, fonte: LocalGoogle['fonte']): LocalGoogle | null =>
        valido(lat, lng) ? { lat: arredondar(lat), lng: arredondar(lng), fonte, ...(nome ? { nome } : {}) } : null;

    // Marcador do lugar: o último par !3d/!4d é o do local escolhido
    const pinos = [...t.matchAll(new RegExp(`!3d${NUM}!4d${NUM}`, 'g'))];
    for (const m of pinos.reverse()) {
        const r = com(Number(m[1]), Number(m[2]), 'pino');
        if (r) return r;
    }
    const busca = t.match(new RegExp(`[?&](?:q|query|ll|destination|center)=(?:loc:)?${NUM}\\s*,\\s*${NUM}`));
    if (busca) {
        const r = com(Number(busca[1]), Number(busca[2]), 'busca');
        if (r) return r;
    }
    const centro = t.match(new RegExp(`@${NUM},${NUM}`));
    if (centro) {
        const r = com(Number(centro[1]), Number(centro[2]), 'centro');
        if (r) return r;
    }
    const solto = t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    return solto ? com(Number(solto[1]), Number(solto[2]), 'texto') : null;
}

/** Endereços que a rota aceita abrir: links do Google Maps e o desvio de consentimento do Google. */
export function hostDoGoogle(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    if (h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co') return true;
    // google.com, google.com.br, maps.google.com, www.google.com.br, consent.google.com...
    return /^([a-z0-9-]+\.)*google\.(com|com\.br|[a-z]{2,3}(\.[a-z]{2})?)$/.test(h);
}

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export class LinkInvalido extends Error {}
export class SemCoordenadas extends Error {}

type Buscar = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Resolve o link: segue até 6 redirecionamentos (só do Google), lê as coordenadas do endereço
 * final e, se ele não tiver, do começo da página (os 512 KB iniciais trazem o lugar em !3d!4d).
 */
export async function resolverLinkGoogle(link: string, buscar: Buscar = fetch): Promise<LocalGoogle> {
    // "lat, lng" colado (sem link): não precisa abrir nada
    if (!/^https?:\/\//i.test(link.trim())) {
        const texto = lerCoordenadas(link);
        if (texto) return texto;
        throw new LinkInvalido('Cole o link do Google Maps (Compartilhar → Copiar link) ou "latitude, longitude".');
    }
    let atual: URL;
    try { atual = new URL(link.trim()); } catch { throw new LinkInvalido('Cole o link do Google Maps (Compartilhar → Copiar link) ou "latitude, longitude".'); }
    if (!hostDoGoogle(atual)) throw new LinkInvalido('O link precisa ser do Google Maps.');

    const opcoes: RequestInit = {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (T3 LED; cadastro de paineis)', 'Accept-Language': 'pt-BR,pt;q=0.9' },
        signal: AbortSignal.timeout(8000),
    };
    for (let salto = 0; salto < 7; salto++) {
        const achado = lerCoordenadas(atual.toString());
        if (achado && achado.fonte !== 'texto') return achado;
        // Tela de consentimento do Google: o destino real vem em "continue"
        const continuar = atual.hostname.startsWith('consent.') ? atual.searchParams.get('continue') : null;
        if (continuar) {
            const prox = new URL(continuar);
            if (!hostDoGoogle(prox)) throw new LinkInvalido('O link precisa ser do Google Maps.');
            atual = prox;
            continue;
        }
        const res = await buscar(atual.toString(), opcoes);
        const destino = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && destino) {
            const prox = new URL(destino, atual);
            if (!hostDoGoogle(prox)) throw new LinkInvalido('O link leva para fora do Google Maps.');
            atual = prox;
            continue;
        }
        if (!res.ok) throw new SemCoordenadas('Não foi possível abrir o link do Google Maps.');
        // Endereço final sem coordenadas (ex.: busca por nome): procura o lugar no começo da página
        const html = (await res.text()).slice(0, 512 * 1024);
        const trecho = html.match(/!3d-?\d+\.\d+!4d-?\d+\.\d+/)?.[0] ?? html.match(/@-?\d{1,2}\.\d+,-?\d{1,3}\.\d+/)?.[0];
        const naPagina = trecho ? lerCoordenadas(trecho) : null;
        const nome = achado?.nome ?? atual.pathname.match(/\/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ');
        if (naPagina) return { ...naPagina, ...(nome ? { nome: safeDecode(nome) } : {}) };
        break;
    }
    throw new SemCoordenadas('O link não traz a posição. No Google Maps, clique no local exato, use Compartilhar → Copiar link e cole de novo.');
}
