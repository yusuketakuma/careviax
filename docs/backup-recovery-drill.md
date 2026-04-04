# CareViaX バックアップ復旧実地訓練 手順書

> 3省2ガイドライン（MHLW v6.0 §8.3 / METI/MIC v1.1 §5.4）準拠
> 訓練周期: 年2回以上（本番復旧実施後は追加で1回）

---

## 1. RTO / RPO 目標値

| 区分 | 目標値 | 根拠 |
|------|--------|------|
| **RTO** (Recovery Time Objective) | **4 時間以内** | 在宅訪問業務への影響許容上限 |
| **RPO** (Recovery Point Objective) | **1 時間以内** | RDS 自動バックアップ間隔（5分スナップショット + WAL連続アーカイブ） |

---

## 2. RDS スナップショットリストア手順

### 前提条件

- AWS マネジメントコンソールへのアクセス権（`AdministratorAccess` または `AmazonRDSFullAccess`）
- 復旧先 VPC・サブネットグループの確認
- 接続先を切り替えるための `DATABASE_URL` 更新手段（Secrets Manager ロールアクセス）

### 2-1. 復旧ポイントの特定

```bash
aws rds describe-db-snapshots \
  --db-instance-identifier careviax-prod \
  --query 'DBSnapshots[?Status==`available`].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output table \
  --region ap-northeast-1
```

- 障害発生時刻の直前のスナップショットを選択する
- 自動スナップショット識別子例: `rds:careviax-prod-2026-04-04-03-00`

### 2-2. スナップショットからの復元

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier careviax-prod-restored \
  --db-snapshot-identifier rds:careviax-prod-2026-04-04-03-00 \
  --db-instance-class db.t3.medium \
  --vpc-security-group-ids sg-xxxxxxxx \
  --db-subnet-group-name careviax-prod-subnet-group \
  --no-publicly-accessible \
  --region ap-northeast-1
```

### 2-3. ポイントインタイムリカバリ（PITR）

スナップショットより細かい時点に戻す場合:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier careviax-prod \
  --target-db-instance-identifier careviax-prod-pitr \
  --restore-time 2026-04-04T02:30:00Z \
  --db-instance-class db.t3.medium \
  --vpc-security-group-ids sg-xxxxxxxx \
  --db-subnet-group-name careviax-prod-subnet-group \
  --no-publicly-accessible \
  --region ap-northeast-1
```

### 2-4. 復元完了待機

```bash
aws rds wait db-instance-available \
  --db-instance-identifier careviax-prod-restored \
  --region ap-northeast-1
```

完了後、エンドポイントを確認:

```bash
aws rds describe-db-instances \
  --db-instance-identifier careviax-prod-restored \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region ap-northeast-1
```

### 2-5. 接続先の切り替え

```bash
# Secrets Manager の DATABASE_URL を新エンドポイントで更新
aws secretsmanager put-secret-value \
  --secret-id careviax/production/app-secrets \
  --secret-string "$(
    aws secretsmanager get-secret-value \
      --secret-id careviax/production/app-secrets \
      --query SecretString --output text \
    | jq --arg new_url "postgresql://careviax:PASSWORD@NEW_ENDPOINT:5432/careviax" \
        '.DATABASE_URL = $new_url'
  )" \
  --region ap-northeast-1
```

### 2-6. マイグレーション確認

```bash
# アプリケーション側でスキーマバージョン確認
pnpm db:migrate deploy
```

### 2-7. サービス再起動

AWS Amplify コンソール または CLI で再デプロイを実行し、新しい接続文字列を反映させる。

### 2-8. 動作確認チェックリスト

- [ ] `/api/health` が 200 を返す
- [ ] DB 接続数が正常範囲内（CloudWatch `DatabaseConnections` < 80）
- [ ] 最新データが参照できる（管理画面で直近の処方箋を確認）
- [ ] 監査ログが書き込まれている（`audit_logs` テーブルの最終行タイムスタンプ）

### 2-9. 旧インスタンスの削除（復旧確認後）

```bash
aws rds delete-db-instance \
  --db-instance-identifier careviax-prod \
  --skip-final-snapshot \
  --region ap-northeast-1

# 復元済みインスタンスをリネーム（任意）
aws rds modify-db-instance \
  --db-instance-identifier careviax-prod-restored \
  --new-db-instance-identifier careviax-prod \
  --apply-immediately \
  --region ap-northeast-1
```

---

## 3. S3 バージョニングオブジェクト復元手順

### 前提条件

- バケット名の確認（`S3_BUCKET_NAME` 環境変数または Secrets Manager 参照）
- `s3:GetObjectVersion`, `s3:RestoreObject`, `s3:PutObject` 権限

### 3-1. オブジェクトのバージョン一覧表示

```bash
# 特定プレフィックス配下のバージョン一覧
aws s3api list-object-versions \
  --bucket careviax-prod-files \
  --prefix prescriptions/2026/ \
  --query 'Versions[*].[Key,VersionId,LastModified,IsLatest]' \
  --output table \
  --region ap-northeast-1
```

削除済みオブジェクト（削除マーカー）の確認:

```bash
aws s3api list-object-versions \
  --bucket careviax-prod-files \
  --prefix prescriptions/ \
  --query 'DeleteMarkers[*].[Key,VersionId,LastModified]' \
  --output table \
  --region ap-northeast-1
```

### 3-2. 特定バージョンの復元（削除マーカーの除去）

```bash
# 削除マーカーを削除することで最新バージョンが復元される
aws s3api delete-object \
  --bucket careviax-prod-files \
  --key prescriptions/2026/04/example.pdf \
  --version-id DELETE_MARKER_VERSION_ID \
  --region ap-northeast-1
```

### 3-3. 旧バージョンを最新として復元

```bash
# 旧バージョンをコピーして新しい最新バージョンとして上書き
aws s3api copy-object \
  --bucket careviax-prod-files \
  --copy-source careviax-prod-files/prescriptions/2026/04/example.pdf?versionId=TARGET_VERSION_ID \
  --key prescriptions/2026/04/example.pdf \
  --region ap-northeast-1
```

### 3-4. Object Lock 保護オブジェクトの確認

Object Lock (COMPLIANCE モード) が設定されたオブジェクトは上書き・削除不可。
リテンション期間の確認:

```bash
aws s3api get-object-retention \
  --bucket careviax-prod-files \
  --key prescriptions/2026/04/example.pdf \
  --region ap-northeast-1
```

### 3-5. 復元確認

```bash
# オブジェクトの存在と内容確認
aws s3api head-object \
  --bucket careviax-prod-files \
  --key prescriptions/2026/04/example.pdf \
  --region ap-northeast-1
```

---

## 4. 訓練実施チェックリスト

### 事前準備

- [ ] 訓練日時・担当者・立会人を記録（訓練記録票に記入）
- [ ] 訓練環境（staging）への権限を確認
- [ ] 訓練前のスナップショットIDを記録
- [ ] 訓練前の S3 オブジェクトバージョンIDを記録
- [ ] 通知先（Slack / メール）を訓練モードに切り替え

### RDS 復旧訓練

- [ ] スナップショット一覧を取得し、復旧ポイントを特定
- [ ] staging インスタンスからリストア実行（`careviax-staging-drill`）
- [ ] リストア完了までの時間を計測（RTO 測定）
- [ ] 復元データの整合性確認（件数・最終レコード日時）
- [ ] アプリケーション接続切り替え（`DATABASE_URL` 更新）
- [ ] `/api/health` と基本動作確認
- [ ] 訓練用インスタンスを削除

### S3 復旧訓練

- [ ] 訓練用オブジェクトをアップロード（`drill/test-$(date +%F).txt`）
- [ ] オブジェクトを削除（削除マーカー作成）
- [ ] バージョン一覧で削除マーカーを確認
- [ ] 削除マーカーを除去して復元
- [ ] 復元確認（`head-object` でレスポンス確認）
- [ ] 訓練用オブジェクトをクリーンアップ

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
  選択スナップショットID  :
  リストア開始時刻        :
  サービス復旧確認時刻    :
  実測 RTO               : ___分
  実測 RPO (データ損失)  : ___分
  データ整合性確認        : □ 正常  □ 異常（内容: ）

【S3復旧】
  対象オブジェクトキー   :
  削除日時               :
  復元完了時刻           :
  実測復旧時間           : ___分

【評価】
  RTO目標(4h) 達成       : □ 達成  □ 未達成（理由: ）
  RPO目標(1h) 達成       : □ 達成  □ 未達成（理由: ）

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
