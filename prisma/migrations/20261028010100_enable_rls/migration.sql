-- Ativa Row Level Security em todas as tabelas do schema public.
--
-- Sem políticas, a API pública do Supabase (PostgREST com as chaves anon/authenticated)
-- não acessa nenhuma linha. O backend não é afetado: ele conecta pelo Prisma com o
-- usuário postgres e usa a service role no Storage, e ambos ignoram RLS.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institutional" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_deals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_deal_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenda_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solution_portfolio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;
