-- Painéis: tempo de reprodução de cada inserção, em segundos (opcional).
-- Coluna nova e opcional: não trava a tabela nem muda linhas existentes. Idempotente.
ALTER TABLE "panels" ADD COLUMN IF NOT EXISTS "playbackSeconds" INTEGER;
