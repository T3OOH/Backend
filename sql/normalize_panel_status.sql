-- Execute uma única vez no banco, após fazer backup e antes de publicar o schema Prisma atualizado.
DO $$
BEGIN
  CREATE TYPE "PanelStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "PanelStatus" ADD VALUE IF NOT EXISTS 'OCCUPIED';
ALTER TYPE "PanelStatus" ADD VALUE IF NOT EXISTS 'MAINTENANCE';

ALTER TABLE "panels" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "panels"
  ALTER COLUMN "status" TYPE "PanelStatus"
  USING (
    CASE "status"::text
      WHEN 'Disponível' THEN 'AVAILABLE'
      WHEN 'Ocupado' THEN 'OCCUPIED'
      WHEN 'Manutenção' THEN 'MAINTENANCE'
      WHEN 'RESERVED' THEN 'OCCUPIED'
      WHEN 'AVAILABLE' THEN 'AVAILABLE'
      WHEN 'OCCUPIED' THEN 'OCCUPIED'
      WHEN 'MAINTENANCE' THEN 'MAINTENANCE'
      ELSE 'MAINTENANCE'
    END
  )::"PanelStatus";

ALTER TABLE "panels"
  ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
