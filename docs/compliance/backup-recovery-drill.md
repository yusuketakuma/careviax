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
3. 患者、訪問記録、報告書、監査ログのサンプル整合性を確認する。
4. S3 の対象キーを過去版から復元し、署名付き URL で閲覧確認する。
5. 監査ログアーカイブバケットのライフサイクルと Object Lock を確認する。
6. Cognito User Pool の Advanced Security が `ENFORCED` であることを確認する。
7. 結果、所要時間、失敗点、改善策を記録する。

## 自動化補助

- 前提チェック: `corepack pnpm backup:drill:check`
- AWS Backup IaC 契約チェック: `corepack pnpm aws:rds-backup:template:validate`
- AWS CloudFormation live template validation: `corepack pnpm aws:rds-backup:template:validate -- --live-aws --strict`
- admin ヘルスチェック: `/api/health` に管理者としてアクセスし、`checks.backups.awsBackupVault`、`checks.backups.awsBackupRecoveryPoint`、`checks.backups.rdsInstanceBackupConfiguration`、`checks.backups.rdsSnapshot` が stale/error でないことを確認する。
- 机上訓練の記録追記: `corepack pnpm backup:drill:check --append --mode tabletop --result "机上訓練完了" --operator "運用担当" --duration "45分" --notes "RDS/S3/Cognito の確認"`
- 実地復旧の記録追記: `corepack pnpm backup:drill:check --append --mode live --result "live drill 完了" --operator "運用担当" --duration "120分" --notes "RDS PITR + S3 バージョン復元 + Cognito 確認"`
- このスクリプトは文書・IaC・必須環境変数の存在確認と、試験結果の Markdown 追記を補助する。実際の復旧操作は本番権限を持つ担当者が実施する。

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
