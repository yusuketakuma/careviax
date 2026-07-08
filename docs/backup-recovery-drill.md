# PH-OS バックアップ復旧実地訓練 手順書

> 3省2ガイドライン（MHLW v6.0 §8.3 / METI/MIC v1.1 §5.4）準拠
> 訓練周期: 年2回以上（本番復旧実施後は追加で1回）

> 注意: 復旧運用の現行SSOTは `docs/compliance/backup-recovery-drill.md`。
> この文書は detailed / historical runbook として扱い、SSOTと矛盾する場合は compliance doc を優先する。
> 復旧証跡へ raw ARN、account id、endpoint、security group/subnet/vpc id、S3 key、患者名、
> 電話番号、token/password を貼り付けない。証跡追記は `pnpm backup:drill:check --append`
> の構造化フラグを使う。

---

## 1. RTO / RPO 目標値

| 区分                               | 目標値         | 根拠                                                                |
| ---------------------------------- | -------------- | ------------------------------------------------------------------- |
| **RTO** (Recovery Time Objective)  | **4 時間以内** | 在宅訪問業務への影響許容上限                                        |
| **RPO** (Recovery Point Objective) | **1 時間以内** | RDS 自動バックアップ間隔（5分スナップショット + WAL連続アーカイブ） |

---

## 2. RDS スナップショットリストア手順

本番の標準バックアップ基盤は `tools/infra/rds-aws-backup-template.yaml` で管理する AWS Backup と RDS PITR である。復旧はアプリケーションから実行しない。運用担当者がAWS権限で新しいDBインスタンスへ復元し、検証後に承認済みの接続先切替を行う。

事前にテンプレート契約を確認する:

```bash
pnpm aws:rds-backup:template:validate
pnpm aws:rds-backup:template:validate -- --live-aws --strict
```

AWS Backup / RDS backup assurance の運用監視は admin `/api/health` の詳細チェックで確認する。`checks.backups.awsBackupVault`、`checks.backups.awsBackupRecoveryPoint`、`checks.backups.rdsInstanceBackupConfiguration`、`checks.backups.rdsSnapshot` が stale/error でないことを復旧前提条件にする。

```text
AWS_BACKUP_VAULT_NAME=ph-os-prod-rds-backup-vault
AWS_BACKUP_RDS_RESOURCE_ARN=arn:aws:rds:ap-northeast-1:<account-id>:db:ph-os-prod
AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS=26
RDS_DB_INSTANCE_ID=ph-os-prod
RDS_BACKUP_MIN_RETENTION_DAYS=7
```

### 前提条件

- 変更管理チケット、復旧指揮者、承認者、対象時刻、対象環境が明確であること
- AWS 権限は復旧担当 role の least-privilege 権限に限定する。広範なAWS管理ポリシーを通常手順の前提にしない
- 復旧先は専用の非公開 VPC / DB subnet group / security group / disposable DB identifier を使う
- 接続先切り替えは Secrets Manager 書き込み権限をアプリケーション実行 role に付与せず、人間承認済みの break-glass / operations role で実施する
- AWS Backup Restore Testing を有効化する場合は、復旧専用の非公開 DB subnet group、security group、drill 用 DB instance class を CloudFormation parameter で指定する

### 2-1. 復旧ポイントの特定

AWS Backup の recovery point を確認する:

```bash
aws backup list-recovery-points-by-backup-vault \
  --backup-vault-name "$AWS_BACKUP_VAULT_NAME" \
  --query 'RecoveryPoints[?Status==`COMPLETED`].[RecoveryPointArn,CreationDate,ResourceType]' \
  --output table \
  --region ap-northeast-1
```

RDS 側の自動スナップショットも確認する:

```bash
aws rds describe-db-snapshots \
  --db-instance-identifier "$RDS_DB_INSTANCE_ID" \
  --query 'DBSnapshots[?Status==`available`].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output table \
  --region ap-northeast-1
```

- 障害発生時刻の直前のスナップショットを選択する
- raw recovery point ARN、snapshot id、account id は evidence log に貼らない。証跡には時刻、RPO補助、選定理由、承認情報だけを記録する

### 2-2. スナップショットからの復元

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "$DRILL_RESTORE_DB_INSTANCE_ID" \
  --db-snapshot-identifier "$APPROVED_DB_SNAPSHOT_IDENTIFIER" \
  --db-instance-class "$DRILL_DB_INSTANCE_CLASS" \
  --vpc-security-group-ids "$DRILL_DB_SECURITY_GROUP_ID" \
  --db-subnet-group-name "$DRILL_DB_SUBNET_GROUP_NAME" \
  --no-publicly-accessible \
  --region ap-northeast-1
```

### 2-3. ポイントインタイムリカバリ（PITR）

スナップショットより細かい時点に戻す場合:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$RDS_DB_INSTANCE_ID" \
  --target-db-instance-identifier "$DRILL_RESTORE_DB_INSTANCE_ID" \
  --restore-time "$APPROVED_RESTORE_TIME_UTC" \
  --db-instance-class "$DRILL_DB_INSTANCE_CLASS" \
  --vpc-security-group-ids "$DRILL_DB_SECURITY_GROUP_ID" \
  --db-subnet-group-name "$DRILL_DB_SUBNET_GROUP_NAME" \
  --no-publicly-accessible \
  --region ap-northeast-1
```

### 2-4. 復元完了待機

```bash
aws rds wait db-instance-available \
  --db-instance-identifier "$DRILL_RESTORE_DB_INSTANCE_ID" \
  --region ap-northeast-1
```

完了後、エンドポイントを確認:

```bash
aws rds describe-db-instances \
  --db-instance-identifier "$DRILL_RESTORE_DB_INSTANCE_ID" \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region ap-northeast-1
```

### 2-5. 接続先の切り替え

訓練ではアプリケーション本番接続先を切り替えない。接続先切り替えは実障害時のみ、変更管理チケットと復旧指揮者の承認後に行う。アプリケーション実行ロールに Secrets Manager 書き込み権限を付与しない。運用担当者が承認済みの手順で `DATABASE_URL` の参照先を復元済みDBへ切り替え、変更前後のSecretバージョン、実施者、承認者、時刻を記録する。

### 2-6. マイグレーション確認

```bash
# 復元DBに対する SELECT-only 整合監査。通常の訓練では migration apply は行わない。
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm backup:drill:integrity -- --format markdown --allow-production
```

migration apply が必要な場合は、復元DB整合監査、ロールバック方針、差分レビュー、変更管理承認後に別手順で実施する。訓練 runbook の標準手順には含めない。

### 2-7. サービス再起動

訓練ではサービス再起動や本番再デプロイを行わない。実障害時に接続先切り替えが承認された場合のみ、承認済み手順で再デプロイまたはタスク再起動を実施し、実施者・承認者・時刻を記録する。

### 2-8. 動作確認チェックリスト

- [ ] `/api/health` が 200 を返す
- [ ] DB 接続数が正常範囲内（CloudWatch `DatabaseConnections` < 80）
- [ ] 最新データが参照できる（管理画面で直近の処方箋を確認）
- [ ] 監査ログが書き込まれている（`audit_logs` テーブルの最終行タイムスタンプ）

### 2-9. 旧インスタンスの扱い（復旧確認後）

本番旧インスタンスは復旧直後に削除しない。削除が必要な場合は、削除保護解除、最終スナップショット作成、保持期間、監査記録を変更管理で承認してから実施する。

復元済みインスタンスを本番識別子へ寄せる必要がある場合も、DNS/Secret切替で安定稼働を確認した後に行う。これは実障害時の変更管理対象であり、訓練では実施しない。

```bash
aws rds modify-db-instance \
  --db-instance-identifier "$APPROVED_RESTORED_DB_INSTANCE_ID" \
  --new-db-instance-identifier "$APPROVED_PRODUCTION_DB_INSTANCE_ID" \
  --apply-immediately \
  --region ap-northeast-1
```

---

## 3. S3 バージョニングオブジェクト復元手順

### 前提条件

- 訓練は synthetic / drill-only prefix で実施する。患者・処方・報告書などの本番オブジェクト key を訓練対象にしない
- バケット名は `S3_BUCKET_NAME` / Secrets Manager / admin health の安全な状態確認で把握するが、証跡には bucket 名や object key を貼らない
- 訓練 role は `s3:ListBucketVersions`, `s3:GetObjectVersion`, `s3:HeadObject`, drill prefix への `s3:PutObject` に限定する
- 本番オブジェクトの削除マーカー除去、旧バージョン上書き、Object Lock 保護対象の変更は実障害時の承認済み break-glass 手順に限定する

### 3-1. オブジェクトのバージョン一覧表示

```bash
# drill-only prefix 配下のバージョン一覧
aws s3api list-object-versions \
  --bucket "$S3_BUCKET_NAME" \
  --prefix "$DRILL_S3_PREFIX" \
  --query 'Versions[*].[Key,VersionId,LastModified,IsLatest]' \
  --output table \
  --region ap-northeast-1
```

削除済みオブジェクト（削除マーカー）の確認:

```bash
aws s3api list-object-versions \
  --bucket "$S3_BUCKET_NAME" \
  --prefix "$DRILL_S3_PREFIX" \
  --query 'DeleteMarkers[*].[Key,VersionId,LastModified]' \
  --output table \
  --region ap-northeast-1
```

### 3-2. 特定バージョンの復元（削除マーカーの除去）

訓練では本番オブジェクトの削除マーカーを除去しない。削除マーカー除去は対象key、version、影響範囲、承認者、ロールバック方針が明確な実障害時のみ実施する。

```bash
# 実障害時のみ。訓練では DRILL_S3_PREFIX の synthetic object に限定する。
aws s3api delete-object \
  --bucket "$S3_BUCKET_NAME" \
  --key "$APPROVED_OBJECT_KEY" \
  --version-id "$APPROVED_DELETE_MARKER_VERSION_ID" \
  --region ap-northeast-1
```

### 3-3. 旧バージョンを最新として復元

訓練では本番オブジェクトを上書きしない。旧バージョンを最新化する操作は、Object Lock、法的保持、監査証跡、下流リンクへの影響を確認した実障害時のみ実施する。

```bash
# 実障害時のみ。訓練では DRILL_S3_PREFIX の synthetic object に限定する。
aws s3api copy-object \
  --bucket "$S3_BUCKET_NAME" \
  --copy-source "$S3_BUCKET_NAME/$APPROVED_OBJECT_KEY?versionId=$APPROVED_SOURCE_VERSION_ID" \
  --key "$APPROVED_OBJECT_KEY" \
  --region ap-northeast-1
```

### 3-4. Object Lock 保護オブジェクトの確認

Object Lock (COMPLIANCE モード) が設定されたオブジェクトは上書き・削除不可。
リテンション期間の確認:

```bash
aws s3api get-object-retention \
  --bucket "$S3_BUCKET_NAME" \
  --key "$APPROVED_OBJECT_KEY" \
  --region ap-northeast-1
```

### 3-5. 復元確認

```bash
# オブジェクトの存在と内容確認
aws s3api head-object \
  --bucket "$S3_BUCKET_NAME" \
  --key "$DRILL_S3_OBJECT_KEY" \
  --region ap-northeast-1
```

---

## 4. 訓練実施チェックリスト

### 事前準備

- [ ] 訓練日時・担当者・立会人を記録（訓練記録票に記入）
- [ ] 訓練環境（staging / recovery-drill）への権限を確認
- [ ] 訓練前のスナップショットIDを記録
- [ ] 訓練前の S3 synthetic object version IDを記録
- [ ] 通知先（Slack / メール）を訓練モードに切り替え

### RDS 復旧訓練

- [ ] スナップショット一覧を取得し、復旧ポイントを特定
- [ ] staging インスタンスからリストア実行（`ph-os-staging-drill`）
- [ ] リストア完了までの時間を計測（RTO 測定）
- [ ] 復元データの整合性確認（件数・最終レコード日時）
- [ ] 復元DBの SELECT-only 整合監査
- [ ] `/api/health` と基本動作確認
- [ ] 訓練用インスタンスの扱いを変更管理に記録する

### S3 復旧訓練

- [ ] synthetic object を drill-only prefix へアップロード（`drill/test-$(date +%F).txt`）
- [ ] synthetic object で削除マーカーを作成
- [ ] バージョン一覧で削除マーカーを確認
- [ ] synthetic object の削除マーカーを除去して復元
- [ ] 復元確認（`head-object` でレスポンス確認）
- [ ] synthetic object の後処理方針を記録する。Object Lock/retention 付きなら削除しない

### 事後処理

- [ ] 訓練記録票に実測 RTO / RPO を記入
- [ ] 目標値（RTO 4h / RPO 1h）との乖離を評価
- [ ] 問題点・改善事項を課題管理票に登録
- [ ] 手順書を更新（不明確な箇所・変更点があれば）
- [ ] 次回訓練予定日を決定

---

## 5. 訓練記録テンプレート

```
訓練記録票
---
実施日時     : YYYY-MM-DD HH:MM
訓練種別     : □ RDS復旧  □ S3復旧  □ 複合
訓練環境     : □ staging  □ 本番（障害時のみ）
担当者       :
立会人（管理者）:

【RDS復旧】
  障害想定日時           :
  復旧ポイント選定理由    :
  リストア開始時刻        :
  サービス復旧確認時刻    :
  実測 RTO               : ___分
  実測 RPO (データ損失)  : ___分
  データ整合性確認        : □ 正常  □ 異常（内容: ）

【S3復旧】
  対象                    : □ synthetic drill object  □ 実障害時承認済み対象
  対象カテゴリ            :
  復元完了時刻           :
  実測復旧時間           : ___分
  Object Lock確認         : □ enabled  □ default retention確認  □ per-object retention確認

【評価】
  RTO目標(4h) 達成       : □ 達成  □ 未達成（理由: ）
  RPO目標(1h) 達成       : □ 達成  □ 未達成（理由: ）
  redaction check         : □ passed  □ failed
  admin health            : □ passed  □ degraded

【課題・改善事項】
  1.
  2.

次回訓練予定日: YYYY-MM-DD
```

---

## 6. 関連ドキュメント

- `tools/infra/cloudwatch-alarms.ts` — RDS 監視アラーム設定
- `tools/infra/audit-log-archive-lifecycle.json` — 監査ログアーカイブポリシー
- `tools/infra/prescription-object-lock.json` — 処方箋 Object Lock 設定
- `docs/decisions.md` — バックアップ設計判断
