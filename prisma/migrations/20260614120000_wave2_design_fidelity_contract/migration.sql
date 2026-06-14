-- Wave 2 デザイン忠実 残ギャップ実装の共通スキーマ contract。
-- すべて additive(nullable / 新規テーブル)で後方互換。既存行・既存 API は変更なしで動作する。

-- CommunicationChannel: PH-OS 内共有チャネル（送付方法の既定・推奨。FAX 明示化 / 送付先編集の前提）
ALTER TYPE "CommunicationChannel" ADD VALUE IF NOT EXISTS 'ph_os_share';

-- VisitVehicleResource: 車検/点検期限の専用カラム（master-hub の鮮度判定を notes 正規表現から列読みへ）
ALTER TABLE "VisitVehicleResource" ADD COLUMN IF NOT EXISTS "next_inspection_date" DATE;

-- HandoffItem: 薬剤師に相談 / 事務へ戻す 相談解決フロー (p0_27)。全 nullable・legacy 行は consult_status=NULL。
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "consult_status" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "resolution_action" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "resolution_note" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "resolved_by" TEXT;
ALTER TABLE "HandoffItem" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "HandoffItem_consult_status_idx" ON "HandoffItem"("consult_status");

-- SetAudit: セット監査 3ペイン再構築 (p0_15) — 写真確認 + 6項目チェックリスト
ALTER TABLE "SetAudit" ADD COLUMN IF NOT EXISTS "checklist" JSONB;
ALTER TABLE "SetAudit" ADD COLUMN IF NOT EXISTS "photo_asset_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- SavedView: 保存ビュー (p1_01) — ユーザー別の名前付きフィルタ組合せ
CREATE TABLE IF NOT EXISTS "SavedView" (
    "id"         TEXT NOT NULL,
    "org_id"     TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "scope"      TEXT NOT NULL,
    "filters"    JSONB NOT NULL,
    "sort"       JSONB,
    "is_shared"  BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SavedView_org_id_user_id_scope_name_key" ON "SavedView"("org_id", "user_id", "scope", "name");
CREATE INDEX IF NOT EXISTS "SavedView_org_id_user_id_scope_idx" ON "SavedView"("org_id", "user_id", "scope");
CREATE INDEX IF NOT EXISTS "SavedView_org_id_scope_is_shared_idx" ON "SavedView"("org_id", "scope", "is_shared");

-- RLS: org_id によるテナント分離（withOrgContext の SET LOCAL app.current_org_id と対）
ALTER TABLE "SavedView" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SavedView";
CREATE POLICY tenant_isolation ON "SavedView"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "SavedView" FORCE ROW LEVEL SECURITY;
