import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/auth.middleware';
import { meetingOrStaffAuth } from '../middlewares/meeting-auth.middleware';
import { MEETING_ROLES } from '../services/meeting.service';
import { MeetingController } from '../controllers/meeting.controller';

const meetingRoutes = Router();

/** Só token de acesso da equipe (o token de reunião é recusado pelo authMiddleware). */
const staffOnly = [authMiddleware, requireRoles(...MEETING_ROLES)];
/** Token de acesso da equipe ou token de reunião (a rota confere se o token é da mesma reunião). */
const staffOrMeeting = [meetingOrStaffAuth];

// Rotas fixas antes das com :id
meetingRoutes.get('/users', ...staffOnly, MeetingController.users);
meetingRoutes.get('/ice', ...staffOrMeeting, MeetingController.ice);
meetingRoutes.get('/', ...staffOnly, MeetingController.list);
meetingRoutes.post('/', ...staffOnly, MeetingController.create);

meetingRoutes.get('/:id', ...staffOrMeeting, MeetingController.get);
meetingRoutes.post('/:id/end', ...staffOrMeeting, MeetingController.end);
meetingRoutes.delete('/:id', ...staffOnly, MeetingController.cancel);
meetingRoutes.get('/:id/messages', ...staffOrMeeting, MeetingController.messages);
meetingRoutes.post('/:id/token', ...staffOnly, MeetingController.token);

export { meetingRoutes };
