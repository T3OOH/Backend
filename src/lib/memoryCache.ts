/**
 * Cache em memória com validade, para leituras públicas que mudam pouco (lista de painéis, mapa).
 * Quem altera os dados chama invalidate() com o prefixo da chave.
 */
type Entry = { value: unknown; expiresAt: number };

/**
 * Teto de entradas: a chave pode vir de parâmetros da URL pública (filtros dos painéis), então
 * sem limite um robô variando "?city=" faria a memória crescer até derrubar o processo.
 */
export const MAX_ENTRIES = 500;

const store = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();

/** Tira as vencidas e, se ainda passar do teto, as mais antigas (o Map guarda a ordem de inserção). */
function abrirEspaco(now: number) {
    if (store.size < MAX_ENTRIES) return;
    for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
    while (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
    }
}

export const memoryCache = {
    /** Devolve o valor guardado ou carrega uma vez (pedidos simultâneos esperam a mesma consulta). */
    async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
        const hit = store.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.value as T;

        const running = pending.get(key);
        if (running) return running as Promise<T>;

        const promise = load()
            .then((value) => {
                const now = Date.now();
                store.delete(key);
                abrirEspaco(now);
                store.set(key, { value, expiresAt: now + ttlMs });
                return value;
            })
            .finally(() => pending.delete(key));
        pending.set(key, promise);
        return promise;
    },

    /** Quantas entradas estão guardadas (para testes e diagnóstico). */
    size() {
        return store.size;
    },

    invalidate(prefix: string) {
        for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
    },
};
