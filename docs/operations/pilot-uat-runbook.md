# Pilot UAT Runbook

## 目的
パイロット薬局での 1 週間実運用テストを、readiness 確認・フィードバック記録・Phase 2 入口判断まで一貫して運用する。

## 開始前チェック
1. `corepack pnpm pilot:readiness -- --org <org_id>` を実行する
2. `corepack pnpm pilot:org-audit -- --org <org_id>` を実行する
3. `corepack pnpm pilot:dossier -- --org <org_id>` を実行し、Phase 2 判定と外部前提を一枚にまとめる
4. `/admin/uat` で readiness 要約と `Pilot Launch Dossier` card を確認する
5. 施設患者数とセット pilot 対象件数を確認する
6. blocker がある場合は先に修正する

## 日次運用
1. 実運用中に発生した問題・改善要望を `/admin/uat` へ登録する
2. 重大度は `critical / high / medium / low` の 4 段階で揃える
3. checklist を押して、実際に通ったフローを記録する
4. 日次終業時に `corepack pnpm uat:summary -- --org <org_id>` を実行する

## 週次まとめ
1. `corepack pnpm uat:summary -- --org <org_id> --format markdown` を出力する
2. `corepack pnpm pilot:dossier -- --org <org_id> --format markdown` を出力して、店舗構成 / 16km 圏 / PMDA / backup / ISMS の残課題を同時確認する
3. `critical/high` を先に並べ、Phase 2 進行可否を判断する
4. 施設患者 0 件なら FacilityVisitBatch / 自動ルート最適化を Phase 2 へ送る
5. セット pilot 対象 0 件ならセット本格機能を Phase 2 へ送る

## 参照 API / 画面
- `GET /api/admin/pilot-readiness`
- `GET /api/admin/pilot-launch-dossier`
- `GET /api/admin/uat-feedback`
- `GET /api/admin/uat-feedback/summary`
- `/admin/uat`
- `docs/operations/target-pharmacy-onboarding-checklist.md`

## 完了条件
- 1 週間の運用ログが UAT フィードバックとして記録されている
- summary に基づく優先順位付けが終わっている
- Facility / Set の pilot 適用可否が明文化されている
