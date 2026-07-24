import { Router } from 'express';
import { prisma } from '../database/prisma';

export const agendaRoutes = Router();

// Listar tarefas de um mês/dia específico
agendaRoutes.get('/', async (req, res) => {
    try {
        const tasks = await prisma.agendaTask.findMany({
            orderBy: { time: 'asc' }
        });
        return res.json(tasks);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar tarefas' });
    }
});

// Criar nova tarefa
agendaRoutes.post('/', async (req, res) => {
    try {
        const { title, client, time, date, type } = req.body;
        const task = await prisma.agendaTask.create({
            data: { title, client, time, date: new Date(date), type }
        });
        return res.status(201).json(task);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao criar tarefa' });
    }
});

// Alternar status (Pendente <-> Concluído)
agendaRoutes.patch('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const task = await prisma.agendaTask.update({
            where: { id },
            data: { status }
        });
        return res.json(task);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao atualizar tarefa' });
    }
});