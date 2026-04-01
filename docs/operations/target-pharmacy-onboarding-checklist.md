# Target Pharmacy Onboarding Checklist

## 目的
初期ターゲット薬局の店舗数・組織構成・訪問カバレッジ・pilot 対象を、ヒアリングではなく repo 内の同じ手順で確認できるようにする。

## 実行コマンド
1. `corepack pnpm pilot:org-audit -- --org <org_id>`
2. `corepack pnpm pilot:readiness -- --org <org_id>`
3. `corepack pnpm uat:summary -- --org <org_id> --format markdown`
4. `corepack pnpm pilot:dossier -- --org <org_id> --format markdown`

## 確認項目
- 店舗数と店舗名
- 各店舗の active member 数
- owner / admin / pharmacist / clerk の役割別人数
- active case 数
- facility_linked_case_count
- set_pilot_case_count
- service area 未設定の店舗有無
- 16km 圏外患者と位置情報未設定患者

## 判定ルール
- `facility_linked_case_count = 0`
  - FacilityVisitBatch と自動ルート最適化は Phase 2 候補として扱う
- `set_pilot_case_count = 0`
  - セット本格機能は pilot 対象明示後に有効化する
- `uncovered > 0`
  - 16km 圏外の患者住所を対象店舗・運用体制と照合する
- `review_required > 0`
  - 緯度経度または facility 紐付けを先に補完する
- `flagged_patients_truncated = true`
  - CLI と画面には先頭 20 件のみ表示されているため、残件数を別途洗い出して確認する

## 完了条件
- 対象薬局の店舗数・組織構成が確定している
- 16km 圏外患者と要確認患者の扱いが決まっている
- Facility / Set の pilot 適用可否が `Plans.md` に反映されている
- Phase 2 判定と外部 blocker を `pilot:dossier` 出力で共有できる
