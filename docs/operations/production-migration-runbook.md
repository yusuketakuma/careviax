# 本番 Migration 適用 Runbook

本番 Amazon RDS PostgreSQL への Prisma migration 適用手順書。承認付き手動実行を正とし、
CI/CD への自動組み込みは将来提案として扱う（本ドキュメントはコマンド提案のみ、
`.github/workflows/ci.yml` 自体は変更しない — 本番デプロイ設定は承認レーン）。

---

## 1. 現状のギャップ

`.github/workflows/ci.yml` には次の 2 つのジョブが存在するが、**本番 DB への
migration 適用を行うジョブは存在しない**。

| ジョブ                | 内容                                                                                            | 対象 DB                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `migration-gate`      | `prisma migrate deploy` を実行し、`db:verify-ph-os-audit-migration` で監査トリガー/RLS を検証   | CI ワーカー内の使い捨て `postgres:17` サービスコンテナ（`ph_os_migration`、`main` push でも PR でも同一・毎回ゼロから作成） |
| `medical-ui-e2e-gate` | 本番相当ビルド + Playwright/axe E2E                                                             | CI ワーカー内の使い捨て `postgres:17`（`ph_os_e2e`）                                                                        |
| `deploy-production`   | `aws amplify start-job --job-type RELEASE` のみ。`environment: production` で reviewer 承認必須 | なし（アプリケーションコードのデプロイのみ）                                                                                |

つまり CI は「migration SQL がエフェメラル DB に対してエラーなく適用できること」
と「監査トリガー/RLS が機能すること」は証明するが、**本番 RDS のスキーマは
`deploy-production` では一切更新されない**。これまでは本番 RDS への
`prisma migrate deploy` は本ドキュメント作成時点で手順化されておらず、
実施者・タイミング・ロールバック手順が暗黙知だった。本ドキュメントはこのギャップを埋める。

補足: `docs/phase5-migration-serialization.md` は Phase 5 期間中の migration
直列化戦略（タイムスタンプ予約・ブランチ戦略）であり、本番適用そのものの手順書ではない。
`docs/phase5-rollback-playbook.md` は Phase 5 スキーマ変更専用のロールバック SQL 集であり、
汎用の migration ロールバック手順ではない（本書 §5 で参照する）。

---

## 2. 本番 DB への migrate deploy — 承認付き手動手順

### 2.1 前提条件

- 本番 RDS は private-db サブネットに配置され、直接到達不可
  （`docs/compliance/network-security-design.md` I-02、`docs/compliance/rds-configuration.md` I-05）。
  DB へのアクセスは **SSM Session Manager 経由の踏み台（bastion）** または
  Amplify ランタイムの VPC 内からのみ可能。ローカル PC から直接 `DATABASE_URL` を
  RDS エンドポイントに向けて実行することはできない。
- 実施者は SSM Session Manager 経由で bastion にポートフォワードし、
  `localhost` 経由で RDS へ到達させる（`aws ssm start-session --target <bastion-instance-id>
--document-name AWS-StartPortForwardingSessionToRemoteHost --parameters
'{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'`)。
- 接続文字列・認証情報は AWS Secrets Manager から取得する。環境変数へ平文で
  貼り付けない（シェル履歴・ログに残さない）。`.env` への恒久保存は禁止。
- 実施は**変更管理チケット + 承認者 1 名以上**を前提とする（`deploy-production`
  の GitHub Environment 承認と同様、DB migration も口頭合意のみで進めない）。
- 実施タイミング: アプリケーションコードのデプロイ（`deploy-production` ジョブ）
  **より前**に完了させる。新しいコードが未適用スキーマを前提にクエリすると
  実行時エラーになるため、migration → コードデプロイの順を厳守する
  （破壊的変更・カラム削除を伴う migration は expand/contract で分割し、
  旧コードが動いたまま新カラムを追加するステップを先行させる）。

### 2.2 事前検証（read-only、DB を変更しない）

```bash
# 1. ドリフト確認: 本番スキーマと migration 履歴の整合性
DATABASE_URL='<production database url via SSM port-forward>' \
DIRECT_URL='<production direct database url via SSM port-forward>' \
pnpm exec prisma migrate status --schema=prisma/schema/

# 2. Migration precondition verifier（read-only）
DATABASE_URL='<production database url>' \
DIRECT_URL='<production direct database url>' \
pnpm --config.verify-deps-before-run=false db:verify-migration-preconditions

# 3. CareReport 重複チェック（該当 migration が unique index を追加する場合）
DATABASE_URL='<production database url>' \
DIRECT_URL='<production direct database url>' \
pnpm --config.verify-deps-before-run=false db:check-care-report-duplicates

# 4. Visit route_order 競合チェック（route_order 関連 migration の場合）
DATABASE_URL='<production database url>' \
DIRECT_URL='<production direct database url>' \
pnpm --config.verify-deps-before-run=false db:check-visit-route-order-conflicts
```

`db:verify-migration-preconditions` が `severity:"error"` を1件でも報告した場合、
または重複/競合チェックが 0 以外を返した場合は **migration を中止**し、
`docs/operations/medical-ui-safety-release-runbook.md` の該当セクションに従って
対象データを先に解消する。

### 2.3 バックアップ確認

本番 RDS の自動バックアップ（`docs/compliance/rds-configuration.md` §3）が
直近で成功していることを AWS コンソールまたは CLI で確認する。
破壊的 migration（カラム削除・型変更・NOT NULL 制約追加）の場合は、
適用直前に手動スナップショットを追加取得する:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier <production-rds-instance-id> \
  --db-snapshot-identifier "pre-migration-$(date -u +%Y%m%d%H%M%S)"
```

### 2.4 migration 適用

```bash
DATABASE_URL='<production database url via SSM port-forward>' \
DIRECT_URL='<production direct database url via SSM port-forward>' \
pnpm exec prisma migrate deploy --schema=prisma/schema/
```

適用直後、監査トリガー/RLS を追加・変更する migration が含まれる場合のみ:

```bash
DATABASE_URL='<production database url>' \
DIRECT_URL='<production direct database url>' \
pnpm --config.verify-deps-before-run=false db:verify-ph-os-audit-migration
```

### 2.5 適用後の確認クエリ

```sql
-- migration 履歴が最新であること
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY finished_at DESC
LIMIT 5;
-- rolled_back_at が NULL であることを確認

-- 対象テーブルのスキーマが期待通りであること（例: 新規カラム追加時）
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = '<対象テーブル>'
ORDER BY ordinal_position;

-- 行数が想定レンジ内であること（データ損失がないこと）
SELECT COUNT(*) FROM "<対象テーブル>";
```

`prisma migrate status` を再実行し、`Database schema is up to date!` を確認する。

### 2.6 コードデプロイ

事前検証・migration 適用・適用後確認がすべて成功したら、`main` への push を
契機に `deploy-production` ジョブ（GitHub Environment `production` の reviewer 承認）
を進める。migration が失敗、または適用後確認で異常が見つかった場合は
`deploy-production` を承認しない。

---

## 3. 失敗時のロールバック

- Phase 5 で導入されたスキーマ変更（P-01/P-04/P-06/P-07/P-08）のロールバック SQL・
  判断基準・30 分復旧タイムラインは `docs/phase5-rollback-playbook.md` を参照する。
- Phase 5 対象外の migration については、原則として **前方修正（forward-fix）** の
  新規 migration を作成して対応する。DOWN migration は Prisma の標準機能に含まれず、
  本プロジェクトでも DOWN migration ファイルは管理していないため、
  「巻き戻し migration を新規に書いて `migrate deploy` する」運用とする。
- 破壊的 migration（カラム削除等）で forward-fix が間に合わない場合は、
  §2.3 で取得した手動スナップショットからの point-in-time restore を検討する。
  この場合は **本番デプロイ設定変更・DB リストアに該当し承認レーン**（詳細手順は
  インフラ責任者と個別調整。本ドキュメントの範囲外）。
- ロールバック後は §2.5 の確認クエリと同等の整合性チェックを実施し、
  `docs/phase5-rollback-playbook.md` のインシデント記録テンプレートに準じて記録する。

---

## 4. 将来 `deploy-production` へ組み込む場合の提案 diff

現状は §2 の手動手順で運用するが、将来的に自動化する場合の提案を以下に示す。
**この diff は提案であり、`ci.yml` への適用は別途承認を要する**
（本番 DB migration の自動実行は auth/security/破壊的 migration/本番デプロイに該当し、
`.agent-loop` の hard-stop 対象。実装は人間承認後、別チケットで行う）。

想定する変更点:

1. `deploy-production` の**前**に新規ジョブ `migrate-production` を挿入し、
   `environment: production` の承認を migration 適用にも適用する
   （Amplify デプロイと同じ reviewer ゲートを共有）。
2. RDS が private サブネットにあるため、GitHub-hosted runner から直接
   接続できない。`aws-actions/aws-cloudformation-github-deploy` 等ではなく、
   SSM `Session Manager` の `port forwarding` を CI 上で張るか、または
   RDS Proxy 経由 + Lambda 実行に切り替えるかは要検討（本 diff は
   「runner から到達可能になっている」前提の骨格のみ示す）。
3. §2.2 の read-only precheck を `migrate-production` 内のステップとして
   組み込み、`severity:"error"` があれば `exit 1` でジョブを止める。

```yaml
# ─────────────────────────────────────────────────────────────
# [PROPOSED — not yet enabled] Production migration gate
# 本番 RDS への prisma migrate deploy を承認付きで実行する
# ─────────────────────────────────────────────────────────────
migrate-production:
  name: Migrate Production Database
  runs-on: ubuntu-latest
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  needs: [ci, medical-ui-e2e-gate]
  environment: production # ← Amplify デプロイと同じ reviewer 承認を共有
  timeout-minutes: 15

  steps:
    - uses: actions/checkout@v4

    - uses: pnpm/action-setup@v4
      with:
        version: ${{ env.PNPM_VERSION }}

    - uses: actions/setup-node@v4
      with:
        node-version: ${{ env.NODE_VERSION }}
        cache: pnpm

    - name: Install dependencies
      run: pnpm install --frozen-lockfile

    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ap-northeast-1

    # NOTE: RDS is private-subnet only. This step is a placeholder for
    # whatever reachability mechanism is approved (SSM port forwarding,
    # RDS Proxy + VPC-connected runner, self-hosted runner in VPC, etc).
    - name: Establish tunnel to production RDS
      run: echo "TODO — approve and implement VPC reachability strategy"

    - name: Read-only migration precondition check
      run: pnpm --config.verify-deps-before-run=false db:verify-migration-preconditions
      env:
        DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        DIRECT_URL: ${{ secrets.PRODUCTION_DIRECT_URL }}

    - name: Apply Prisma migrations to production
      run: pnpm exec prisma migrate deploy --schema=prisma/schema/
      env:
        DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        DIRECT_URL: ${{ secrets.PRODUCTION_DIRECT_URL }}

    - name: Verify PH-OS audit migration
      run: pnpm --config.verify-deps-before-run=false db:verify-ph-os-audit-migration
      env:
        DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        DIRECT_URL: ${{ secrets.PRODUCTION_DIRECT_URL }}

deploy-production:
  name: Deploy to Production
  runs-on: ubuntu-latest
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  needs: [ci, medical-ui-e2e-gate, migrate-production] # ← add migrate-production
  environment: production
  timeout-minutes: 10
  # ...unchanged
```

留意点（自動化する場合の未解決事項）:

- private RDS への runner 到達性が最大の未解決課題（上記 TODO ステップ）。
  self-hosted runner を VPC 内に置くか、`aws ssm start-session` の
  port-forwarding を CI ステップとして張るかの選定が必要。
- `PRODUCTION_DATABASE_URL` / `PRODUCTION_DIRECT_URL` を新規 GitHub Secret
  として登録する必要がある（Secrets Manager からの動的取得に置き換えることも検討）。
- `migrate-production` が失敗した場合、`deploy-production` は `needs` により
  自動的にスキップされる（コードと未整合なスキーマへのデプロイを防止）。
- forward-fix 前提の運用（§3）と自動適用は相性が悪い場合がある
  （誤った migration が自動で本番に流れるリスク）。自動化する場合は
  §2.2 の precheck 群に加えて、破壊的 DDL（`DROP COLUMN` / `DROP TABLE` /
  型変更）を検出したら自動実行せず手動承認ステップへフォールバックする
  ガードを追加することを推奨する。

---

## 5. Migration 順序と `.agent-loop` 運用の注意

- Migration ファイルのタイムスタンプは `prisma/migrations/` 内で
  ファイルシステム順 = 適用順になる。複数の feature ブランチが並行して
  migration を追加する場合、`main` へのマージ順によってはタイムスタンプが
  意図した依存順と食い違う可能性がある。マージ前に必ず
  `pnpm exec prisma migrate status --schema=prisma/schema/` で
  ドリフトがないことを確認する（`docs/phase5-migration-serialization.md`
  と同じ直列化の考え方は Phase 5 以外の大型スキーマ変更にも適用する）。
- `.agent-loop` の maker/checker ループでは、migration ファイルの追加自体は
  通常のレビュー対象だが、**本番 RDS への `migrate deploy` 実行そのものは
  hard-stop 対象**（`CLAUDE.md` 「auth/billing/payments/security/破壊的
  migration/本番 deploy は承認なしに触らない」）。Claude/Codex どちらが
  migration ファイルを書いた場合も、本ドキュメント §2 の実施は
  人間オペレーターが行う。ループはブロッカーとして
  `.agent-loop/BLOCKED.md` に退避し、承認後に人間が本ドキュメントの手順で
  適用する。
- 複数 migration をまとめて 1 回のリリースで適用する場合、
  `prisma migrate deploy` は `prisma/migrations/` 内の未適用分をタイムスタンプ順に
  すべて一括適用する（個別選択はできない）。分割適用したい場合は
  リリースブランチ自体を分割する必要がある。
- migration 適用後に `db:generate`（`prisma generate` + Prisma Client リンク）が
  必要なのはビルド時であり、本番 DB 適用そのものには不要。ただし
  `deploy-production` のビルドで使う Prisma Client のスキーマバージョンと
  本番 DB のスキーマが一致している必要があるため、§2.1 の「migration →
  コードデプロイ」の順序を崩さないこと。
