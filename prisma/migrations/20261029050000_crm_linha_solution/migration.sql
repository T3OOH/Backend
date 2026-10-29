-- CRM: linha de negócio (T3 OOH ou T3 Solution) e dados do projeto da Solution nos negócios.
-- IF NOT EXISTS: também aplicada direto no Supabase; rodar de novo não quebra.
ALTER TABLE "crm_deals" ADD COLUMN IF NOT EXISTS "line" TEXT NOT NULL DEFAULT 'OOH';
ALTER TABLE "crm_deals" ADD COLUMN IF NOT EXISTS "solution" JSONB;
CREATE INDEX IF NOT EXISTS "crm_deals_line_idx" ON "crm_deals"("line");
