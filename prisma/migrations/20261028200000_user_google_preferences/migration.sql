-- Login com Google e personalização visual salva por usuário
-- IF NOT EXISTS: a migração também foi aplicada direto no Supabase; rodar de novo não quebra
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
