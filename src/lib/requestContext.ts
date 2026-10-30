import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Dados da requisição em andamento, disponíveis em qualquer ponto do código (registro de auditoria). */
export interface RequestContext {
    requestId: string;
    ip?: string;
    method: string;
    path: string;
    actor?: { id: string; role: string };
    /** Último erro registrado com console.error nesta requisição. */
    error?: { message: string; stack?: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
    get: () => storage.getStore(),

    /** Middleware: abre o contexto da requisição. */
    middleware(req: Request, res: Response, next: NextFunction) {
        const ctx: RequestContext = {
            requestId: randomUUID(),
            ip: req.ip,
            method: req.method,
            path: req.originalUrl.split('?')[0].slice(0, 300),
        };
        res.setHeader('X-Request-Id', ctx.requestId);
        storage.run(ctx, next);
    },

    /** Executa dentro de um contexto já criado (ex.: ao terminar a resposta). */
    run<T>(ctx: RequestContext, fn: () => T) {
        return storage.run(ctx, fn);
    },

    setActor(actor: { id: string; role: string }) {
        const ctx = storage.getStore();
        if (ctx) ctx.actor = actor;
    },
};
