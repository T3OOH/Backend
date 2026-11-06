-- Indicadores e processos do CRM + foco das fotos dos painéis.
-- Tudo aditivo e idempotente: tabela nova, coluna opcional e uma configuração padrão.

-- ============================================================================
-- 1. Eventos do funil: cada mudança de etapa, status ou responsável de um negócio.
--    Base do lead time, do tempo por etapa, do SLA de primeira resposta e do
--    tempo de processo por comercial. Gravado por gatilho: vale para qualquer
--    caminho (API, BackendJS, painel do Supabase).
-- ============================================================================
CREATE TABLE IF NOT EXISTS "crm_deal_events" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "dealId"    TEXT NOT NULL REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- CREATED | STAGE | STATUS | SELLER
    "type"      TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "crm_deal_events_dealId_createdAt_idx" ON "crm_deal_events" ("dealId", "createdAt");
CREATE INDEX IF NOT EXISTS "crm_deal_events_type_createdAt_idx" ON "crm_deal_events" ("type", "createdAt");
-- Mesma regra das demais tabelas: a API pública do Supabase não lê nada (o backend ignora RLS)
ALTER TABLE "crm_deal_events" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION "crm_deal_event"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    agora TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "crm_deal_events" ("dealId", "type", "toValue", "createdAt") VALUES (NEW."id", 'CREATED', NEW."stage"::text, NEW."createdAt");
        IF NEW."sellerId" IS NOT NULL THEN
            INSERT INTO "crm_deal_events" ("dealId", "type", "toValue", "createdAt") VALUES (NEW."id", 'SELLER', NEW."sellerId", NEW."createdAt");
        END IF;
        IF NEW."status"::text <> 'OPEN' THEN
            INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt") VALUES (NEW."id", 'STATUS', 'OPEN', NEW."status"::text, NEW."createdAt");
        END IF;
        RETURN NULL;
    END IF;

    IF NEW."stage" IS DISTINCT FROM OLD."stage" THEN
        INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt") VALUES (NEW."id", 'STAGE', OLD."stage"::text, NEW."stage"::text, agora);
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
        INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt") VALUES (NEW."id", 'STATUS', OLD."status"::text, NEW."status"::text, agora);
    END IF;
    IF NEW."sellerId" IS DISTINCT FROM OLD."sellerId" THEN
        INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt") VALUES (NEW."id", 'SELLER', OLD."sellerId", NEW."sellerId", agora);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS crm_deal_event ON "crm_deals";
CREATE TRIGGER crm_deal_event AFTER INSERT OR UPDATE ON "crm_deals" FOR EACH ROW EXECUTE FUNCTION "crm_deal_event"();

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION "crm_deal_event"() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION "crm_deal_event"() FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Histórico de antes desta migração, reconstruído do registro de auditoria (só na primeira vez)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "crm_deal_events") THEN
        -- Criação de cada negócio existente
        INSERT INTO "crm_deal_events" ("dealId", "type", "toValue", "createdAt")
        SELECT d."id", 'CREATED',
               coalesce((SELECT a."changes" -> 'fields' -> 'stage' ->> 'from' FROM "audit_logs" a
                          WHERE a."entity" = 'crm_deals' AND a."entityId" = d."id" AND a."action" = 'update'
                            AND a."changes" -> 'fields' ? 'stage' ORDER BY a."createdAt" LIMIT 1), d."stage"::text),
               d."createdAt"
          FROM "crm_deals" d;

        -- Mudanças de etapa, status e responsável registradas na auditoria
        INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt")
        SELECT a."entityId", f.tipo, a."changes" -> 'fields' -> f.campo ->> 'from', a."changes" -> 'fields' -> f.campo ->> 'to', a."createdAt"
          FROM "audit_logs" a
          JOIN (VALUES ('stage', 'STAGE'), ('status', 'STATUS'), ('sellerId', 'SELLER')) AS f(campo, tipo)
            ON a."changes" -> 'fields' ? f.campo
         WHERE a."entity" = 'crm_deals' AND a."action" = 'update'
           AND EXISTS (SELECT 1 FROM "crm_deals" d WHERE d."id" = a."entityId");

        -- Responsável definido na criação (sem troca registrada): conta desde a criação
        INSERT INTO "crm_deal_events" ("dealId", "type", "toValue", "createdAt")
        SELECT d."id", 'SELLER', d."sellerId", d."createdAt"
          FROM "crm_deals" d
         WHERE d."sellerId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "crm_deal_events" e WHERE e."dealId" = d."id" AND e."type" = 'SELLER');

        -- Status final sem troca registrada (ganho/perdido antes da auditoria): conta na última alteração
        INSERT INTO "crm_deal_events" ("dealId", "type", "fromValue", "toValue", "createdAt")
        SELECT d."id", 'STATUS', 'OPEN', d."status"::text, d."updatedAt"
          FROM "crm_deals" d
         WHERE d."status"::text <> 'OPEN'
           AND NOT EXISTS (SELECT 1 FROM "crm_deal_events" e WHERE e."dealId" = d."id" AND e."type" = 'STATUS');
    END IF;
END $$;

-- ============================================================================
-- 2. Metas de SLA dos processos (editáveis em Gestão → Indicadores)
-- ============================================================================
INSERT INTO "system_settings" ("id", "key", "value", "group", "updatedAt")
VALUES (gen_random_uuid()::text, 'crm_sla',
        '{"primeiraRespostaHoras":2,"propostaHoras":48,"fechamentoDias":30,"paradoDias":7,"pedidoAprovacaoHoras":24,"contatoRespostaHoras":24}',
        'processos', (now() AT TIME ZONE 'UTC'))
ON CONFLICT ("key") DO NOTHING;

-- ============================================================================
-- 3. Fotos dos painéis: ponto de foco de cada foto ({ "<url>": { "x": 0-100, "y": 0-100, "fonte": "auto"|"manual" } })
--    O site usa como object-position para os cards mostrarem o telão e o movimento.
-- ============================================================================
ALTER TABLE "panels" ADD COLUMN IF NOT EXISTS "imageFocus" JSONB;
