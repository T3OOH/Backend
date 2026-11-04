-- Reuniões da equipe: vídeo, áudio, compartilhamento de tela e chat da chamada.
-- Idempotente: rodar de novo não quebra.
DO $$ BEGIN
    CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "meetings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "meeting_participants" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("meetingId", "userId")
);

CREATE TABLE IF NOT EXISTS "meeting_messages" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "meetings_hostId_idx" ON "meetings"("hostId");
CREATE INDEX IF NOT EXISTS "meetings_status_scheduledAt_idx" ON "meetings"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "meeting_participants_userId_idx" ON "meeting_participants"("userId");
CREATE INDEX IF NOT EXISTS "meeting_messages_meetingId_createdAt_idx" ON "meeting_messages"("meetingId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "meetings" ADD CONSTRAINT "meetings_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mesma regra das demais tabelas: a API pública do Supabase não lê nada (o backend ignora RLS)
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_messages" ENABLE ROW LEVEL SECURITY;
