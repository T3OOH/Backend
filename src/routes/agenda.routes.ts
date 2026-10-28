import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authMiddleware, requireRoles, STAFF_ROLES } from '../middlewares/auth.middleware';

export const agendaRoutes = Router();

agendaRoutes.use(authMiddleware, requireRoles(...STAFF_ROLES));

const TASK_TYPES = ['call', 'meeting', 'message', 'task'] as const;
const TASK_STATUSES = ['pending', 'completed'] as const;

const taskSchema = z.object({
    title: z.string().trim().min(1, 'Informe o título.').max(160),
    client: z.string().trim().max(160).default(''),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM).'),
    date: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Data inválida.'),
    type: z.enum(TASK_TYPES).default('task'),
});

const statusSchema = z.object({ status: z.enum(TASK_STATUSES) });

const invalid = (res: import('express').Response, error: z.ZodError) =>
    res.status(400).json({ error: error.issues[0]?.message ?? 'Dados inválidos.', details: error.issues });

// Listar tarefas (ordenadas por dia e horário)
agendaRoutes.get('/', async (req, res) => {
    try {
        const tasks = await prisma.agendaTask.findMany({
            orderBy: [{ date: 'asc' }, { time: 'asc' }]
        });
        return res.json(tasks);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar tarefas' });
    }
});

// Criar nova tarefa
agendaRoutes.post('/', async (req, res) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
        const { date, ...rest } = parsed.data;
        const task = await prisma.agendaTask.create({ data: { ...rest, date: new Date(date) } });
        return res.status(201).json(task);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao criar tarefa' });
    }
});

// Editar tarefa
agendaRoutes.put('/:id', async (req, res) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
        const { date, ...rest } = parsed.data;
        const task = await prisma.agendaTask.update({ where: { id: req.params.id }, data: { ...rest, date: new Date(date) } });
        return res.json(task);
    } catch (error) {
        return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
});

// Alternar status (Pendente <-> Concluído)
agendaRoutes.patch('/:id/toggle', async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
        const task = await prisma.agendaTask.update({
            where: { id: req.params.id },
            data: { status: parsed.data.status }
        });
        return res.json(task);
    } catch (error) {
        return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
});

// Excluir tarefa
agendaRoutes.delete('/:id', async (req, res) => {
    try {
        await prisma.agendaTask.delete({ where: { id: req.params.id } });
        return res.status(204).end();
    } catch (error) {
        return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
});
