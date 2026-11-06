import { PanelStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { padronizarLocal } from '../lib/localidades';

const panelBaseSchema = z.object({
    name: z.string().trim().min(1, 'O nome é obrigatório.').max(160),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    size: z.string().trim().min(1, 'O tamanho é obrigatório.').max(80),
    px: z.string().trim().min(1, 'A resolução é obrigatória.').max(80),
    impacts: z.string().trim().min(1, 'Os impactos são obrigatórios.').max(80),
    // Tempo de reprodução de cada inserção, em segundos (opcional; null apaga)
    playbackSeconds: z.number().int('Use segundos inteiros.').min(1, 'O tempo de reprodução é de pelo menos 1 segundo.').max(3600, 'O tempo de reprodução vai até 3600 segundos.').nullable().optional(),
    price: z.number().nonnegative('O valor não pode ser negativo').nullable().optional(),
    status: z.nativeEnum(PanelStatus).default(PanelStatus.AVAILABLE),
    description: z.string().trim().max(3000).optional(),
    address: z.string().trim().max(250).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    categoryId: z.string().uuid().optional(),
    images: z.array(z.string().url()).max(8).default([]),
    // Foco de cada foto (0-100% na horizontal e na vertical): os cards centralizam o telão e o movimento
    imageFocus: z.record(z.string().url(), z.object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        fonte: z.enum(['auto', 'manual']),
        objetos: z.array(z.string().max(40)).max(30).optional(),
        // Pino marcado à mão em cima do telão (edição): a IA procura o telão em volta dele
        pino: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict().optional(),
    }).strict()).nullable().optional()
        // null apaga os focos (o Prisma pede JsonNull em campo JSON)
        .transform((v) => (v === null ? Prisma.JsonNull : v)),
}).strict();

// Cidade e UF saem padronizadas pela lista do IBGE (grafia oficial e UF preenchida)
export const createPanelSchema = panelBaseSchema.transform(padronizarLocal);

export const updatePanelSchema = panelBaseSchema
    .partial()
    .extend({
        status: z.nativeEnum(PanelStatus).optional(),
        // Sem padrão na edição: "images" ausente mantém as fotos. Com .default([]) do cadastro,
        // uma edição parcial (ex.: só imageFocus) apagava todas as fotos do painel.
        images: z.array(z.string().url()).max(8).optional(),
    })
    .strict()
    .transform(padronizarLocal);