import { z } from 'zod';

const MAX_PARTICIPANTS = 7;
const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;

const isoDate = z.string({ error: 'Data inválida.' })
    .regex(/^\d{4}-\d{2}-\d{2}T/, 'Informe a data no formato ISO.')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida.');

export const createMeetingSchema = z.object({
    title: z.string({ error: 'Informe o título.' }).trim().min(1, 'Informe o título.').max(120, 'O título aceita até 120 caracteres.'),
    scheduledAt: isoDate.optional(),
    participantIds: z.array(z.string().min(1).max(64), { error: 'Convidados inválidos.' })
        .max(MAX_PARTICIPANTS, `Uma reunião aceita até ${MAX_PARTICIPANTS} convidados.`)
        .default([]),
    instant: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
    if (new Set(data.participantIds).size !== data.participantIds.length) {
        ctx.addIssue({ code: 'custom', path: ['participantIds'], message: 'Há convidados repetidos.' });
    }
    if (data.instant) return;
    if (!data.scheduledAt) {
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Informe a data e a hora da reunião.' });
        return;
    }
    const when = Date.parse(data.scheduledAt);
    if (when <= Date.now()) {
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'A reunião precisa ser agendada para o futuro.' });
    } else if (when > Date.now() + ONE_YEAR_MS) {
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'A reunião pode ser agendada em até 1 ano.' });
    }
});

export const listMeetingsSchema = z.object({
    scope: z.enum(['upcoming', 'past'], { error: 'Escopo inválido.' }).default('upcoming'),
});

// ---- Socket ----

export const estadoSchema = z.object({
    mic: z.boolean(),
    cam: z.boolean(),
    tela: z.boolean(),
}).strict();

export const entrarSchema = z.object({
    meetingId: z.string().min(1).max(64),
    estado: estadoSchema,
}).strict();

export const mensagemSchema = z.object({
    texto: z.string().trim().min(1, 'Escreva uma mensagem.').max(2000, 'A mensagem aceita até 2000 caracteres.'),
}).strict();

/** Tamanho máximo de um sinal WebRTC (SDP ou candidato) em bytes. */
export const MAX_SIGNAL_BYTES = 64 * 1024;

export const sinalSchema = z.object({
    para: z.string().min(1).max(64),
    dados: z.object({
        description: z.object({ type: z.enum(['offer', 'answer', 'pranswer', 'rollback']), sdp: z.string().optional() }).passthrough().optional(),
        candidate: z.object({}).passthrough().nullable().optional(),
    }).passthrough(),
}).strict();
