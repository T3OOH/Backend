import { z } from 'zod';

/*
 * Opções da T3 Solution (venda e instalação de painéis de LED), usadas no formulário do site
 * e no CRM. Mesma lista do frontend (src/lib/solution.ts): ao mudar aqui, mude lá também.
 */
export const SOLUTION_APPLICATIONS = ['Residências', 'Condomínios', 'Empresas', 'Comércio', 'Empreendimentos', 'Sob medida'] as const;
export const SOLUTION_ENVIRONMENTS = ['indoor', 'outdoor'] as const;
export const SOLUTION_SERVICES = ['fornecimento', 'estrutura', 'instalacao', 'conteudo', 'manutencao'] as const;

export const DEAL_LINES = ['OOH', 'SOLUTION'] as const;

const meters = z.coerce.number().min(0).max(200).optional().nullable();

/** Projeto do negócio da Solution. Tudo opcional: o lead chega só com a aplicação. */
export const solutionDetailsSchema = z.object({
    application: z.enum(SOLUTION_APPLICATIONS).optional().nullable(),
    environment: z.enum(SOLUTION_ENVIRONMENTS).optional().nullable(),
    /** Largura e altura da tela, em metros. */
    width: meters,
    height: meters,
    /** Distância entre pixels (mm): P2,5, P3,9, P6... */
    pitch: z.coerce.number().min(0.5).max(40).optional().nullable(),
    services: z.array(z.enum(SOLUTION_SERVICES)).max(SOLUTION_SERVICES.length).optional(),
    notes: z.string().trim().max(3000).optional().nullable(),
}).strict();

export type SolutionDetails = z.infer<typeof solutionDetailsSchema>;
