# バックアップ・復旧試験手順

## 目的
CareViaX の RDS / S3 / 監査ログ保管の復旧可能性を定期確認するための机上・実地手順を定義する。

## 試験対象
- RDS 自動スナップショットからのポイントインタイム復旧
- S3 バージョニング / Object Lock を有効化した文書の復元確認
- 監査ログアーカイブバケットのライフサイクルと 5 年保持設定確認
- Cognito Advanced Security の強制状態確認

## 実施頻度
- 半年に 1 回の机上訓練
- 年 1 回の実地復旧試験
- 重大構成変更後の臨時再試験

## 手順
1. 復旧対象日時と対象データを決める。
2. 復旧専用環境へ RDS スナップショットをリストアする。
3. 患者、訪問記録、報告書、監査ログのサンプル整合性を確認する。
4. S3 の対象キーを過去版から復元し、署名付き URL で閲覧確認する。
5. 監査ログアーカイブバケットのライフサイクルと Object Lock を確認する。
6. Cognito User Pool の Advanced Security が `ENFORCED` であることを確認する。
7. 結果、所要時間、失敗点、改善策を記録する。

## 自動化補助
- 前提チェック: `corepack pnpm backup:drill:check`
- 机上訓練の記録追記: `corepack pnpm backup:drill:check --append --mode tabletop --result "机上訓練完了" --operator "運用担当" --duration "45分" --notes "RDS/S3/Cognito の確認"`
- 実地復旧の記録追記: `corepack pnpm backup:drill:check --append --mode live --result "live drill 完了" --operator "運用担当" --duration "120分" --notes "RDS PITR + S3 バージョン復元 + Cognito 確認"`
- このスクリプトは文書・IaC・必須環境変数の存在確認と、試験結果の Markdown 追記を補助する。実際の復旧操作は本番権限を持つ担当者が実施する。

## 合格基準
- RTO 4 時間以内で主要データ参照が再開できる。
- RPO 24 時間以内のデータ復旧が可能である。
- 患者情報、訪問記録、報告書、監査ログの整合性が確認できる。
- 認証、監査、アーカイブ設定に重大な欠落がない。

## 試験記録

| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |
|---|---|---|---|---|
| 2026-03-31 | Codex | 机上訓練前提確認完了 | 5分 | [mode:tabletop] 必須ファイル確認。DATABASE_URL/AWS_REGION 未設定のため実地復旧は未実施。 |
