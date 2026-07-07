# バックアップ・復旧試験手順

## 目的

PH-OS の RDS / S3 / 監査ログ保管の復旧可能性を定期確認するための机上・実地手順を定義する。

## 試験対象

- AWS Backup による RDS continuous backup / daily recovery point / restore testing
- RDS 自動バックアップからのポイントインタイム復旧
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
3. 復元済みDBへ接続し、`backup:drill:integrity` で患者、訪問、報告、請求/タスク、添付、監査ログ、他職種受信、残数管理の SELECT-only 整合監査を実行する。
4. S3 の対象キーを過去版から復元し、署名付き URL で閲覧確認する。
5. 監査ログアーカイブバケットのライフサイクルと Object Lock を確認する。
6. Cognito User Pool の Advanced Security が `ENFORCED` であることを確認する。
7. 結果、所要時間、失敗点、改善策を記録する。

## 自動化補助

- 前提チェック: `corepack pnpm backup:drill:check`
- 復元済みDBの整合監査: `DATABASE_URL=<restored-or-staging-db-url> corepack pnpm backup:drill:integrity -- --format markdown --expected-latest-at "2026-07-08T10:00:00+09:00" --rpo-minutes 60`
- 復旧専用RDSなど AWS endpoint を持つ復元DBは production-like と判定される。担当者承認後にのみ `--allow-production` を付ける: `DATABASE_URL=<restored-rds-url> corepack pnpm backup:drill:integrity -- --format markdown --allow-production --expected-latest-at "2026-07-08T10:00:00+09:00" --rpo-minutes 60`
- AWS Backup IaC 契約チェック: `corepack pnpm aws:rds-backup:template:validate`
- AWS CloudFormation live template validation: `corepack pnpm aws:rds-backup:template:validate -- --live-aws --strict`
- admin ヘルスチェック: `/api/health` に管理者としてアクセスし、`checks.backups.awsBackupVault`、`checks.backups.awsBackupRecoveryPoint`、`checks.backups.rdsInstanceBackupConfiguration`、`checks.backups.rdsSnapshot` が stale/error でないことを確認する。
- 机上訓練の記録追記: `corepack pnpm backup:drill:check --append --mode tabletop --result "机上訓練完了" --operator "運用担当" --duration "45分" --environment "recovery-drill" --ticket "DRILL-YYYYMMDD" --approver "運用責任者" --notes "RDS/S3/Cognito の手順確認"`
- 実地復旧の記録追記: `corepack pnpm backup:drill:check --append --mode live --environment "recovery-drill" --result "live drill 完了" --operator "運用担当" --duration "120分" --ticket "DRILL-YYYYMMDD" --approver "運用責任者" --started-at "2026-07-08T10:00:00+09:00" --completed-at "2026-07-08T12:00:00+09:00" --rto-minutes "120" --rpo-minutes "30" --health-status "passed" --redaction-check "passed" --sample-counts "patients:10,reports:5,audit:20" --notes "RDS PITR + S3 version restore + Cognito 確認"`
- このスクリプトは文書・IaC・必須環境変数の存在確認と、試験結果の Markdown 追記を補助する。実際の復旧操作は本番権限を持つ担当者が実施する。
- `backup:drill:integrity` は SELECT-only で、DB restore、migration、UPDATE/DELETE/INSERT、AWS restore call、Secrets書換は行わない。production-like な `DATABASE_URL` は `--allow-production` なしで停止する。
- `backup:drill:integrity` の出力は件数、status、timestamp、issue count、RPO補助に限定し、患者名、薬剤名、住所、電話、free text、storage key、ARN、endpoint、provider raw error を出さない。
- `--allow-production` は本番DBへ通常接続してよいという意味ではない。復元専用RDSなど production-like endpoint へ、人間承認済みで接続するための明示フラグとして扱う。
- 復元DB監査は read-only DB role で実行する。CLI側も session を `default_transaction_read_only=on` に固定するが、RLSやorg contextの影響で0件に見える場合は、復旧監査用の読み取り専用ロールまたは対象org明示の運用方針を別途確認する。
- `backup:drill:integrity` の PASS は復元DBの業務リンク整合の補助証跡であり、復旧全体の合格証跡ではない。RDS restore、S3 version restore、Object Lock、監査ログアーカイブ、Cognito、admin health check、live drill record を別途確認する。
- RPO補助は `audit_logs` だけでは合格にしない。患者、ケース、訪問、報告、請求/タスク、添付、他職種受信、残数管理などの critical operational categories の latest timestamp を basis として扱う。
- `--notes` と各構造化フラグには患者名、電話番号、raw AWS ARN、AWS account id、署名付きURL、DB接続文字列、RDS endpoint、security group/subnet/vpc id、raw S3 URI、token/password を入れない。検出時は追記を拒否する。
- 構造化証跡の各値には `;`、`[`、`]` を入れない。`|` は Markdown table safety のため `/` に正規化する。
- live drill は `[mode:live]` だけでは合格証跡にしない。environment、ticket、approver、started/completed、RTO/RPO、health status、redaction check、sample counts が揃い、health/redaction が `passed` の行だけを live recovery evidence として扱う。

## AWS Backup 構成

- IaC: `tools/infra/rds-aws-backup-template.yaml`
- Backup vault: KMS CMK 暗号化、`DeletionPolicy: Retain`
- Backup plan: RDS continuous backup / PITR と daily recovery point
- Retention: 既定 35 日
- Restore testing: コスト・訓練時間帯の承認後に `EnableRestoreTesting=true`
  - `RestoreTestingDbSubnetGroupName`: 復旧専用の非公開DB subnet group
  - `RestoreTestingVpcSecurityGroupIdsJson`: 復旧専用security group IDのJSON配列文字列
  - `RestoreTestingDbInstanceClass`: 復旧試験用のRDS instance class
- Cross-region copy: PHI locality のため既定 OFF。法務・顧客・リージョン承認後のみ有効化
- Vault Lock compliance mode: irreversible なため既定 OFF。環境単位の明示承認後のみ有効化

アプリケーション実行ロールには `backup:StartRestoreJob`、`backup:DeleteRecoveryPoint`、`backup:UpdateRecoveryPointLifecycle`、`rds:RestoreDBInstanceToPointInTime`、`rds:DeleteDBInstance`、`rds:ModifyDBInstance`、`secretsmanager:PutSecretValue`、`iam:PassRole` を付与しない。復旧は運用担当者がAWS権限で新DBへ復元し、検証後に承認済み手順で接続先を切り替える。

AWS Backup / RDS backup assurance 監視に使う環境変数:

```text
AWS_BACKUP_VAULT_NAME=ph-os-prod-rds-backup-vault
AWS_BACKUP_RDS_RESOURCE_ARN=arn:aws:rds:ap-northeast-1:<account-id>:db:ph-os-prod
AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS=26
RDS_DB_INSTANCE_ID=ph-os-prod
RDS_BACKUP_MIN_RETENTION_DAYS=7
```

アプリケーション実行ロールに付与する read-only 監視権限:

```text
backup:DescribeBackupVault
backup:ListRecoveryPointsByBackupVault
rds:DescribeDBInstances
rds:DescribeDBSnapshots
```

health response、log、audit には AWS account id、raw ARN、RDS endpoint、KMS key ARN、security group、subnet、provider raw error を出さない。

参照する AWS read-only API:

- AWS Backup `DescribeBackupVault`
  - https://docs.aws.amazon.com/aws-backup/latest/APIReference/API_DescribeBackupVault.html
- AWS Backup `ListRecoveryPointsByBackupVault`
  - https://docs.aws.amazon.com/aws-backup/latest/APIReference/API_ListRecoveryPointsByBackupVault.html
- Amazon RDS `DescribeDBInstances`
  - https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DescribeDBInstances.html

## 合格基準

- RTO 4 時間以内で主要データ参照が再開できる。
- RPO 1 時間以内のデータ復旧が可能である。
- 患者情報、訪問記録、報告書、監査ログの整合性が確認できる。
- 認証、監査、アーカイブ設定に重大な欠落がない。

## 試験記録

| 実施日     | 実施者 | 結果                 | 所要時間 | 備考                                                                                     |
| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |
| 2026-03-31 | Codex  | 机上訓練前提確認完了 | 5分      | [mode:tabletop] 必須ファイル確認。DATABASE_URL/AWS_REGION 未設定のため実地復旧は未実施。 |
