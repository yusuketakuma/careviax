# I-05 — Amazon RDS 構成定義書

## 概要

PH-OS の主データベースである Amazon RDS PostgreSQL の構成を明文化する。
3省2ガイドライン（MHLW v6.0 + METI/MIC v1.1）が求める可用性・完全性・機密性要件を満たすことを確認するための設計基準書。

---

## 1. インスタンス構成

| 項目               | 設定値                                                                | 根拠                                                 |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------- |
| エンジン           | PostgreSQL 16.x                                                       | Row Level Security (RLS) 対応、Prisma 7 サポート済み |
| インスタンスクラス | `db.r7g.large`（本番）/ `db.t4g.medium`（ステージング）               | PHI ワークロードに対する適切なメモリ確保             |
| ストレージタイプ   | gp3 SSD                                                               | IOPS 安定性、コスト効率                              |
| ストレージ容量     | 200 GB（本番）/ 50 GB（ステージング）、Auto Scaling 有効（最大 2 TB） | 5 年保持要件に対応                                   |
| リージョン         | ap-northeast-1（東京）固定                                            | ISMAP 準拠、医療情報の国内保管要件                   |

---

## 2. Multi-AZ 構成

| 項目                 | 設定値                                                       |
| -------------------- | ------------------------------------------------------------ |
| Multi-AZ             | **有効**（Standby インスタンスを別 AZ に配置）               |
| 読み取りレプリカ     | 本番環境のみ 1 台（ap-northeast-1c）、レポート・分析クエリ用 |
| フェイルオーバー目標 | RTO: 60-120 秒、RPO: 0（同期レプリケーション）               |

フェイルオーバー発生条件:

- プライマリ AZ の障害
- DB インスタンスの異常終了
- 定期メンテナンスウィンドウ中のパッチ適用

---

## 3. 自動バックアップ

| 項目                          | 設定値                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| 自動バックアップ              | **有効**                                                       |
| バックアップ保持期間          | **35 日**（最大値）                                            |
| バックアップウィンドウ        | 17:00-18:00 UTC（JST 02:00-03:00、低負荷時間帯）               |
| Point-in-Time Recovery (PITR) | 有効（35 日以内の任意の時点へ復元可能）                        |
| 最終スナップショット          | 削除時に自動作成（名称: `ph-os-prod-final-snapshot-YYYYMMDD`） |
| スナップショット暗号化        | KMS キーで暗号化（aws/rds マネージドキー）                     |

バックアップ保持期間を 35 日とする理由: 月次バッチによる物理削除処理の対象期間（最大 31 日）を超えた復旧を可能にするため。

### 3.1 AWS Backup 管理

RDS 自動バックアップに加え、AWS Backup で本番RDSの復旧ポイントを一元管理する。

| 項目                       | 設定値                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| IaC                        | `tools/infra/rds-aws-backup-template.yaml`                                                                                 |
| 検証コマンド               | `pnpm aws:rds-backup:template:validate`                                                                                    |
| Backup Vault               | CMK暗号化、`DeletionPolicy: Retain`                                                                                        |
| Backup Plan                | RDS continuous backup / PITR + daily recovery point                                                                        |
| Backup Selection           | `RdsDbInstanceArn` を明示指定                                                                                              |
| Restore Testing            | 既定OFF。実地訓練ウィンドウとコスト承認後に有効化。ONにする場合は復旧専用 DB subnet group と security group を明示指定する |
| Cross-region copy          | PHI locality のため既定OFF。法務・顧客・リージョン承認後のみ有効化                                                         |
| Vault Lock compliance mode | irreversible なため既定OFF。環境単位の明示承認後のみ有効化                                                                 |

アプリケーション実行ロールには `backup:StartRestoreJob`、`backup:DeleteRecoveryPoint`、`backup:UpdateRecoveryPointLifecycle`、`rds:RestoreDBInstanceToPointInTime`、`rds:DeleteDBInstance`、`rds:ModifyDBInstance`、`secretsmanager:PutSecretValue`、`iam:PassRole` を付与しない。復旧は運用担当者がAWS上で新DBへ復元し、検証後に変更管理で接続先を切り替える。

### 3.2 AWS Backup / RDS backup assurance 監視

`/api/health` の admin 詳細チェックは、RDS 自動スナップショットに加えて AWS Backup vault、RDS recovery point 鮮度、RDS instance の backup retention / latest restorable time / deletion protection / storage encryption を read-only で確認する。

必要な環境変数:

```text
AWS_BACKUP_VAULT_NAME
AWS_BACKUP_RDS_RESOURCE_ARN
AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS=26
RDS_DB_INSTANCE_ID
RDS_BACKUP_MIN_RETENTION_DAYS=7
```

監視ロールには以下の読み取り権限のみを付与する。

```text
backup:DescribeBackupVault
backup:ListRecoveryPointsByBackupVault
rds:DescribeDBInstances
rds:DescribeDBSnapshots
```

監視結果には AWS account id、raw ARN、RDS endpoint、KMS key ARN、security group、subnet、provider raw error を出さない。復旧開始・削除・Secret更新権限は付与しない。

---

## 4. 削除保護

| 項目                   | 設定値                                            |
| ---------------------- | ------------------------------------------------- |
| 削除保護               | **有効**（本番環境）                              |
| 削除前スナップショット | 必須（IaC で `skip_final_snapshot = false` 設定） |

削除保護を無効化するには CloudFormation / Terraform スタックの更新が必要であり、意図しない削除を防止する。

---

## 5. パラメータグループ定義

パラメータグループ名: `ph-os-pg16-production`

### タイムゾーン設定

```
TimeZone = Asia/Tokyo
```

日本標準時（JST）で `created_at` / `updated_at` を記録し、監査ログの可読性を確保する。

### SSL 強制

```
rds.force_ssl = 1
```

TLS なしの接続を拒否。Prisma の `DATABASE_URL` に `sslmode=require` を設定し、二重に強制する。

### ログ設定

| パラメータ                   | 値               | 目的                                        |
| ---------------------------- | ---------------- | ------------------------------------------- |
| `log_connections`            | `1`              | 接続ログ（不正接続の検知）                  |
| `log_disconnections`         | `1`              | 切断ログ                                    |
| `log_duration`               | `0`              | 全クエリの実行時間ログ（負荷時は無効化可）  |
| `log_min_duration_statement` | `1000`           | 1 秒以上のスロークエリをログ出力            |
| `log_statement`              | `ddl`            | DDL 操作（CREATE/ALTER/DROP）を必ずログ出力 |
| `log_lock_waits`             | `1`              | ロック待機ログ（デッドロック検知）          |
| `pgaudit.log`                | `write,ddl,role` | pgAudit による DML・DDL・権限変更の監査ログ |

### RLS 関連設定

| パラメータ           | 値                     | 目的                         |
| -------------------- | ---------------------- | ---------------------------- |
| `row_security`       | `on`                   | Row Level Security を有効化  |
| `app.current_org_id` | （アプリ側で動的設定） | テナント分離のセッション変数 |

### 接続管理

| パラメータ                            | 値                           | 目的                                            |
| ------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `max_connections`                     | `200`                        | Amplify デプロイ環境の Node.js プロセス数に対応 |
| `shared_preload_libraries`            | `pg_stat_statements,pgaudit` | パフォーマンス統計・監査ログ拡張                |
| `idle_in_transaction_session_timeout` | `30000`                      | 30 秒間アイドルのトランザクションを強制終了     |
| `statement_timeout`                   | `60000`                      | 60 秒を超えるクエリを強制終了                   |

---

## 6. サブネットグループ定義

サブネットグループ名: `ph-os-rds-subnet-group`

| サブネット          | AZ              | タイプ                                         |
| ------------------- | --------------- | ---------------------------------------------- |
| `subnet-private-1a` | ap-northeast-1a | プライベート（インターネットゲートウェイなし） |
| `subnet-private-1c` | ap-northeast-1c | プライベート（インターネットゲートウェイなし） |
| `subnet-private-1d` | ap-northeast-1d | プライベート（インターネットゲートウェイなし） |

アクセス制限:

- RDS はプライベートサブネットのみに配置し、パブリックアクセスを無効化
- セキュリティグループ: Amplify ランタイム（Lambda / ECS）の VPC エンドポイントからのポート 5432 のみ許可
- Bastion Host 経由のアクセス: SSM Session Manager を使用（踏み台サーバーへの SSH ポート開放不要）

---

## 7. 暗号化設定

| 項目                   | 設定値                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| 保存時暗号化           | **有効**（KMS at rest）                                                                 |
| KMS キー               | AWS マネージドキー `aws/rds`（初期構成）、カスタマーマネージドキー（CMK）への移行を計画 |
| 暗号化アルゴリズム     | AES-256                                                                                 |
| スナップショット暗号化 | 自動バックアップ・手動スナップショットともに暗号化を継承                                |
| レプリカ暗号化         | 読み取りレプリカも同一 KMS キーで暗号化                                                 |
| 転送中暗号化           | TLS 1.3（`rds.force_ssl = 1` による強制）                                               |

カスタマーマネージドキー（CMK）運用方針（今後導入予定）:

- キーローテーション: 年 1 回自動ローテーション
- キーポリシー: セキュリティ担当者のみ `kms:Disable*` / `kms:Delete*` を許可
- キー使用ログ: CloudTrail で全 API 呼び出しを記録

---

## 8. Performance Insights

| 項目                 | 設定値                               |
| -------------------- | ------------------------------------ |
| Performance Insights | **有効**                             |
| データ保持期間       | 7 日（無料枠）/ 本番は 93 日（有償） |
| 対象メトリクス       | Top SQL、Wait Events、DB Load        |

活用方針:

- スロークエリの特定（`log_min_duration_statement` と併用）
- 月次のパフォーマンスレビューで上位 SQL を確認
- Prisma クエリのインデックス最適化に活用

---

## 9. Enhanced Monitoring

| 項目                | 設定値                                         |
| ------------------- | ---------------------------------------------- |
| Enhanced Monitoring | **有効**                                       |
| 収集間隔            | **60 秒**                                      |
| 送信先              | CloudWatch Logs（`RDSOSMetrics` ロググループ） |

収集メトリクス（OS レベル）:

- CPU 使用率（全コア）
- メモリ使用量・スワップ
- ディスク I/O（読み取り/書き込み IOPS・レイテンシ）
- ネットワーク I/O
- ファイルシステム使用量
- プロセス一覧（接続プロセスの可視化）

CloudWatch アラート設定:

- CPU 使用率 > 80%（5 分間継続）→ High アラート
- 空きストレージ < 20 GB → High アラート
- データベース接続数 > 180 → Warning アラート
- レプリカラグ > 60 秒 → Warning アラート

---

## 10. メンテナンスウィンドウ

| 項目                         | 設定値                                                    |
| ---------------------------- | --------------------------------------------------------- |
| メンテナンスウィンドウ       | 水曜 17:00-18:00 UTC（JST 木曜 02:00-03:00）              |
| 自動マイナーバージョンアップ | 有効（パッチ適用は C-02 変更管理プロセス対象外とする）    |
| メジャーバージョンアップ     | C-02 変更管理プロセスに従い、ステージング検証後に本番適用 |

---

## 11. 構成確認チェックリスト

デプロイ後および四半期点検時に以下を確認する。

- [ ] Multi-AZ が `Yes` であること
- [ ] 削除保護が `Enabled` であること
- [ ] バックアップ保持期間が `35` 日であること
- [ ] AWS Backup plan が本番RDS ARNを明示選択し、continuous backup が有効であること
- [ ] Backup Vault / KMS key が `Retain` され、cross-region copy と Vault Lock は承認状態に合っていること
- [ ] `/api/health` admin 詳細で AWS Backup recovery point と RDS automated snapshot の両方が stale でないこと
- [ ] Restore Testing を有効化した環境では、復旧専用 subnet group / security group metadata が指定され、直近の復旧テストが成功していること
- [ ] `rds.force_ssl = 1` であること
- [ ] サブネットがプライベートのみであること
- [ ] パブリックアクセス可能 = `No` であること
- [ ] 保存時暗号化が `Enabled` であること
- [ ] Performance Insights が `Enabled` であること
- [ ] Enhanced Monitoring が `60` 秒間隔であること
- [ ] `pgaudit.log` が `write,ddl,role` に設定されていること

---

## 更新履歴

| 日付       | 更新内容      | 承認者 |
| ---------- | ------------- | ------ |
| 2026-03-29 | I-05 初版作成 | —      |
