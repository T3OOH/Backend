-- Login com Google e personalização visual salva por usuário
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "preferences" JSONB;

CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
