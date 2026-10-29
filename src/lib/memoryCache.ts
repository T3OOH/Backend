/**
 * Cache em memória com validade, para leituras públicas que mudam pouco (lista de painéis, mapa).
 * Quem altera os dados chama invalidate() com o prefixo da chave.
 */
type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();

export const memoryCache = {
    /** Devolve o valor guardado ou carrega uma vez (pedidos simultâneos esperam a mesma consulta). */
    async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
        const hit = store.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.value as T;

        const running = pending.get(key);
        if (running) return running as Promise<T>;

        const promise = load()
            .then((value) => {
                store.set(key, { value, expiresAt: Date.now() + ttlMs });
                return value;
            })
            .finally(() => pending.delete(key));
        pending.set(key, promise);
        return promise;
    },

    invalidate(prefix: string) {
        for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
    },
};
