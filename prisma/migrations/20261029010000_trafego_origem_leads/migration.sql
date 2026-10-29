-- Tráfego do site e origem dos leads
-- IF NOT EXISTS: também aplicada direto no Supabase; rodar de novo não quebra
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "medium" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "campaign" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "landingPage" TEXT;
CREATE INDEX IF NOT EXISTS "analytics_events_createdAt_idx" ON "analytics_events"("createdAt");

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "attribution" JSONB;
ALTER TABLE "crm_deals" ADD COLUMN IF NOT EXISTS "attribution" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "attribution" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attribution" JSONB;
