-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE INDEX "panels_categoryId_idx" ON "panels"("categoryId");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_companyId_idx" ON "orders"("companyId");

-- CreateIndex
CREATE INDEX "orders_sellerId_idx" ON "orders"("sellerId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_panelId_idx" ON "order_items"("panelId");

-- CreateIndex
CREATE INDEX "crm_clients_sellerId_idx" ON "crm_clients"("sellerId");

-- CreateIndex
CREATE INDEX "crm_deals_clientId_idx" ON "crm_deals"("clientId");

-- CreateIndex
CREATE INDEX "crm_deals_sellerId_idx" ON "crm_deals"("sellerId");

-- CreateIndex
CREATE INDEX "crm_deal_items_dealId_idx" ON "crm_deal_items"("dealId");

-- CreateIndex
CREATE INDEX "crm_deal_items_panelId_idx" ON "crm_deal_items"("panelId");

-- CreateIndex
CREATE INDEX "crm_messages_dealId_idx" ON "crm_messages"("dealId");

-- CreateIndex
CREATE INDEX "crm_messages_clientId_idx" ON "crm_messages"("clientId");

-- CreateIndex
CREATE INDEX "crm_activities_clientId_idx" ON "crm_activities"("clientId");

-- CreateIndex
CREATE INDEX "crm_activities_sellerId_idx" ON "crm_activities"("sellerId");

-- CreateIndex
CREATE INDEX "crm_notes_clientId_idx" ON "crm_notes"("clientId");

-- CreateIndex
CREATE INDEX "crm_notes_authorId_idx" ON "crm_notes"("authorId");

-- CreateIndex
CREATE INDEX "crm_coupons_creatorId_idx" ON "crm_coupons"("creatorId");

-- CreateIndex
CREATE INDEX "crm_coupons_usedById_idx" ON "crm_coupons"("usedById");

-- CreateIndex
CREATE INDEX "analytics_events_panelId_idx" ON "analytics_events"("panelId");

