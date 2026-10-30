-- Registro de auditoria: alterações pelo sistema, direto no banco, no repositório e erros.
-- IF NOT EXISTS / OR REPLACE: rodar de novo não quebra.
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'info',
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "ip" TEXT,
    "method" TEXT,
    "path" TEXT,
    "status" INTEGER,
    "requestId" TEXT,
    "externalId" TEXT,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_externalId_key" ON "audit_logs"("externalId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_level_createdAt_idx" ON "audit_logs"("level", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_source_createdAt_idx" ON "audit_logs"("source", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_createdAt_idx" ON "audit_logs"("entity", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- Mesma regra das demais tabelas: a API pública do Supabase não lê nada (o backend ignora RLS)
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Alterações feitas direto no banco (painel do Supabase, SQL, ferramentas externas).
-- A API se identifica com application_name = 't3-api' e registra as próprias alterações
-- com o autor; o que chega por ela é ignorado aqui. Dados sensíveis nunca são copiados.
CREATE OR REPLACE FUNCTION "audit_direct_change"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    app TEXT := coalesce(current_setting('application_name', true), '');
    hidden TEXT[] := ARRAY['password', 'refreshHash', 'previousHash', 'googleId'];
    old_row JSONB;
    new_row JSONB;
    diff JSONB := '{}'::jsonb;
    k TEXT;
    row_id TEXT;
BEGIN
    IF app = 't3-api' THEN
        RETURN NULL;
    END IF;

    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD) - hidden; END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW) - hidden; END IF;
    row_id := coalesce(new_row ->> 'id', old_row ->> 'id');

    IF TG_OP = 'UPDATE' THEN
        FOR k IN SELECT jsonb_object_keys(new_row) LOOP
            IF k <> 'updatedAt' AND (old_row -> k) IS DISTINCT FROM (new_row -> k) THEN
                diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_row -> k, 'to', new_row -> k));
            END IF;
        END LOOP;
        -- Só o updatedAt mudou: nada a registrar
        IF diff = '{}'::jsonb THEN
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO "audit_logs" ("id", "createdAt", "level", "source", "action", "entity", "entityId", "summary", "changes", "actorName")
    VALUES (
        gen_random_uuid()::text,
        -- Sempre em UTC, como o Prisma grava
        (now() AT TIME ZONE 'UTC'),
        'warning',
        'database',
        CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
        TG_TABLE_NAME,
        row_id,
        CASE TG_OP WHEN 'INSERT' THEN 'Inclusão' WHEN 'UPDATE' THEN 'Alteração' ELSE 'Exclusão' END
            || ' direto no banco em ' || TG_TABLE_NAME,
        CASE TG_OP WHEN 'INSERT' THEN jsonb_build_object('after', new_row)
                   WHEN 'UPDATE' THEN jsonb_build_object('fields', diff)
                   ELSE jsonb_build_object('before', old_row) END,
        nullif(concat_ws(' · ', nullif(app, ''), current_user), '')
    );
    RETURN NULL;
END;
$$;

-- Tabelas acompanhadas (ficam de fora: o próprio registro, eventos de visita, sessões e mensagens de chat)
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'companies', 'users', 'panels', 'institutional', 'categories', 'orders', 'order_items',
        'crm_clients', 'crm_deals', 'crm_deal_items', 'crm_activities', 'crm_notes', 'crm_coupons',
        'agenda_tasks', 'banners', 'solution_portfolio', 'contacts', 'system_settings', 'security_events'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS audit_direct_change ON %I', t);
        EXECUTE format('CREATE TRIGGER audit_direct_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "audit_direct_change"()', t);
    END LOOP;
END $$;

-- A função só roda como gatilho: ninguém da API pública do Supabase pode chamá-la
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION "audit_direct_change"() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION "audit_direct_change"() FROM anon, authenticated;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
