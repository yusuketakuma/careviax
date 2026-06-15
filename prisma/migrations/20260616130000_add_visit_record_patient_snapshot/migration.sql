-- 訪問記録作成時点の患者詳細スナップショット。
-- 過去訪問を患者詳細の更新で上書きしないための不変参照であり、
-- 訪問前確認ビュー(前回訪問以降の差分)の基準点となる。
ALTER TABLE "VisitRecord" ADD COLUMN "patient_state_snapshot" JSONB;
