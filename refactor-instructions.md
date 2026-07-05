# refactor-instructions.md — PH-OS Pharmacy リファクタリング指示書

> 実装担当モデルへ: この文書は読み取り専門の分析エージェントが 2026-06-12 時点のコードベースを実測して作成した。
> あなたの仕事は「既存仕様を壊さず、ここに列挙された負債を、指定された順序と制約の中で減らす」こと。
> 全面書き換え・大規模削除・見た目だけの整理は仕事ではない。証拠なく挙動を変えることも仕事ではない。

---

## 1. Objective

- 既存挙動を一切変えずに、以下を達成する:
  1. 認可・監査ログ・日付境界・ステータス表示ラベルの「書き方の分散」を共通ヘルパーへ収斂させる(段階移行。新規コードが迷わない状態を作る)
  2. 参照ゼロを証明できた死コードを削除する
  3. 壊れやすいテスト(AWS SDK 内部フィールドへの deep-equal)を安定化し、ベースラインを green にする
  4. 肥大モジュールのうち、安全に切り出せる純関数・定数を抽出してテスト可能にする
- 「8. Implementation Phases」の順に進め、各フェーズで検証する。
- 大きな設計変更(DB schema、API 統合、旧 UI 撤去)は **実装せず提案に留める**(Phase 7)。

## 2. Project Understanding(証拠ベースの現状理解)

### 何のプロダクトか

在宅訪問に強い保険薬局向けの業務・連携プラットフォーム(PH-OS)。3省2ガイドライン準拠の医療情報システム。
処方箋応需 → 入力 → 判断(疑義照会)→ 調剤 → 監査 → セット → 訪問 → 報告 → 算定 の 9 工程を 1 リポジトリで扱う。
根拠: `CLAUDE.md`(技術スタック・コンプライアンス)、`README.md`、`docs/ph-os_pharmacy_workflow_spec_project_context.md`。

### 主要ワークフロー / UI

- UI は `design/images/new/`(14 画面)を最優先ターゲットとするデザイン忠実実装が直近完了(`Plans.md` の「デザイン忠実実装トラック」、`docs/design-gap-analysis-new.md`)。
- 各画面は「ビューポート上部 = 新デザイン、下部 = 旧 UI を機能温存」の二層構成(意図的。例: `/patients` の `patients-board.tsx` + 下部 `#patients-classic` の `patients-table.tsx`)。
- カード = 1 処方サイクル(RX)の作業台。`/patients/[id]` の既定ビューは `card-workspace.tsx`、`?view=profile`(旧 `?tab=` 互換)で旧タブ UI(`patient-detail-tabs.tsx`)。

### エントリーポイントと主要モジュール

| 領域                    | 場所                                                                                                                                                                                                                           | 備考                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| ページ                  | `src/app/(dashboard)/` `(auth)/`                                                                                                                                                                                               | App Router。レイアウトは `src/components/layout/`(`app-shell` `sidebar` `app-header` `navigation-config`) |
| API                     | `src/app/api/`(150+ route)                                                                                                                                                                                                     | 認可ラッパー 2 系統(後述 D1)                                                                              |
| サーバーロジック        | `src/server/services/`(集約・projection)、`src/server/jobs/`(daily/evening/monthly/next-day/webhook、`runner.ts`)、`src/server/adapters/`(fhir / e-prescription / line / sms / claims-export / qualification-check / realtime) |                                                                                                           |
| 認証                    | `src/lib/auth/`(`context.ts` の `requireAuthContext` に集約。Cognito+NextAuth、`x-org-id` 切替は AuditLog 記録)                                                                                                                |                                                                                                           |
| DB                      | `prisma/schema/`(分割スキーマ)+ `prisma/rls-policies.sql`(org_id RLS、アプリ層 where と二重防御)                                                                                                                               |                                                                                                           |
| オフライン              | `src/lib/stores/offline-db.ts` `sync-engine.ts`(dexie、AES-GCM 暗号化、409 競合保持)                                                                                                                                           |                                                                                                           |
| ストレージ              | `src/server/services/file-storage.ts`(S3 presigned、purpose 別 KMS/Object Lock)                                                                                                                                                |                                                                                                           |
| PH-OS v1.1 レガシー API | `src/phos/`(API Gateway + Lambda 所有。**Next.js 配下に実装しない** — `docs/phos-legacy-api-isolation.md`)                                                                                                                     |                                                                                                           |
| デモ seed               | `prisma/seed.ts` → `prisma/seed-design-demo.ts`(冪等 upsert、`@db.Date` は UTC midnight)                                                                                                                                       |                                                                                                           |
| E2E / 撮影              | `tools/tests/`(`ui-design-fidelity.spec.ts` + `helpers/design-screen-map.ts` = デザイン撮影ループ)                                                                                                                             |                                                                                                           |

### データフロー(代表)

画面 → 画面別 BFF(例 `/api/dashboard/cockpit`、`/api/patients/board`、`/api/dispense-tasks/[id]/workbench`)→ `withAuthContext`(session+org 検証)→ Prisma(アプリ層 `where org_id` + RLS)→ 整形 projection を返却。書き込みは `withOrgContext(tx => { mutation + tx.auditLog.create })` で監査と同一トランザクション。

### 外部依存

AWS(Cognito / RDS PostgreSQL / S3 / SES / KMS / Secrets Manager / CloudWatch / EventBridge / Lambda+API Gateway(phos)/ DynamoDB(rate-limit 検証スクリプト))、Web Speech API(音声入力)。外部医療連携は `src/server/adapters/` 経由。

### 実測済みの強み(壊さない・「直そう」としないこと)

以下は 2026-06-12 の実測で**健全**と確認済み。リファクタ対象ではない:

- レスポンスヘルパーの統一度が高い: `@/lib/api/response` 利用 290 ファイル vs `NextResponse.json` 直書きは 8 ファイルのみ。
- 型規律: 非テストコードの `: any` は**リポジトリ全体で 1 件**。
- 入力検証: zod(`safeParse`/`z.object`)を 205 route が使用(残りは主に GET)。
- ジョブの重複実行ガードあり: `src/server/jobs/runner.ts` が `status='running'` + `locked_at`(stale lock 解決付き)でスキップ判定。
- マルチテナント・監査・rate-limit(fail-closed)・監査ログ redaction(`src/lib/audit-logs/redaction.ts`)は既に具体的な統制がある(`docs/repository-audit-2026-06-10.md` の Strengths と一致)。
- E2E/撮影基盤: `ui-design-fidelity` 撮影ループ + ローカル E2E 一式が整備済み。
- セキュリティ(2026-06-12 追加実測): `dangerouslySetInnerHTML` **0 件**・`eval`/`new Function` **0 件**・ハードコード secret **検出なし**・`.env` は example のみ git 管理。CSP(per-request nonce)+セキュリティヘッダーは `src/proxy.ts` に一元実装。外部共有トークンは JWT + `expires_at` + `revoked_at`(DB 失効)の三重。`callbackUrl` は `useSafeCallbackUrl`(`src/lib/auth/browser-auth-state.ts`)で検証済み。唯一の `$queryRawUnsafe`(`src/server/services/data-explorer.ts` 4 箇所)も Prisma モデル allowlist 検証+`sanitizeRow`+`redactRowForResponse` で統制済み。
- 命名: 本体(src/phos 以外)のファイル名は kebab-case で**完全統一**(PascalCase 29 件はすべて隔離領域 `src/phos/` 内)。

### セキュリティ上、変更時に特に慎重を要する境界(壊すと影響が全域に及ぶ)

- `src/proxy.ts`: CSP nonce 生成・セキュリティヘッダー・API/非 API の振り分けが**ここ一箇所**。リファクタで関数を動かす場合もレスポンスヘッダーの内容を変えない(変更時は E2E でコンソールの CSP violation ゼロを確認)。
- `src/server/services/data-explorer.ts`: 動的 SQL の identifier は allowlist 由来のみ。文字列組み立てに新たな入力経路を足さない。
- `src/server/services/external-access.ts`: トークン検証 3 条件(署名・期限・失効)のいずれも省略不可。
- `src/lib/auth/context.ts` の `requireAuthContext`: org 切替(x-org-id)の Membership 検証と AuditLog 記録。

### 検証コマンド(CI と同一系列)

`.github/workflows/ci.yml` 準拠:

```bash
pnpm install --frozen-lockfile
pnpm lint                      # ESLint flat config
pnpm format:check              # Prettier(CI で必須)
pnpm date-slices:check         # 日付スライス分類チェック(tools/scripts/check-date-slices.mjs)
pnpm eventbridge-schedules:check
pnpm typecheck                 # tsc --noEmit
pnpm test                      # Vitest(全 ~5,850 tests)
pnpm build                     # Next build(重い。フェーズ最後に)
```

ローカル E2E(任意だが UI 変更時は必須):

```bash
pnpm db:e2e:prepare && pnpm db:e2e:seed      # localhost:5433/ph_os_e2e
pnpm dev:e2e:local                            # localhost:3012(別プロセスで常駐)
pnpm test:e2e:local <spec> --project=chromium
# デザイン撮影ループ: DESIGN_SCREEN_IDS=new_06 pnpm test:e2e:local ui-design-fidelity --project=chromium
```

## 3. Behaviors To Preserve(絶対に壊してはいけない挙動)

1. **マルチテナント分離**: 全クエリの `org_id` スコープと RLS(`withOrgContext` の `SET LOCAL app.current_org_id`)。1 行たりとも org 境界を緩めない。
2. **監査ログ**: 書き込み系 API の `tx.auditLog.create`(同一トランザクション)。リファクタで監査が落ちる・トランザクション外に出ることは不可。`changes` に PHI 本文(自由記述・患者名)を新たに入れない。
3. **認可**: 各 route の permission キー(`hasPermission`)と担当スコープ(`resolveDashboardAssignmentScope` / `buildCareCaseAssignmentWhere` 系)。
4. **楽観ロック**: `VisitRecord`/`VisitSchedule` 等の body `version` / `expected_version` 方式(409 + `details.existing_record`)。If-Match へ勝手に変えない。
5. **オフライン同期**: dexie キュー(暗号化 payload)、409 時に draft を破棄しない挙動、`conflict_state` の維持。
6. **`@db.Date` の UTC 日付規約**: 書き込みは UTC midnight、当日クエリは `src/lib/utils/date-boundary.ts`(`todayUtcRange`)。JST 環境で当日を取りこぼさないこと(2026-06-12 に統一済み。逆行させない)。
7. **新デザイン 14 画面の撮影合格状態**: `tools/tests/ui-design-fidelity.spec.ts` + `design-screen-map.ts` の new_01〜new_14 が撮影可能で、各画面の構成(セクション・文言・状態色・主操作 1 つ)が `design/images/new/` と一致していること。
8. **旧 UI 温存セクション**: 各画面下部の従来 UI(`#patients-classic` 等)と `?view=profile` / 旧 `?tab=` ディープリンク互換。承認なく撤去しない。
9. **URL 互換**: `/notifications?type=` → category への互換マッピング、`/prescriptions/new`(手動取込)等の既存 URL。
10. **seed の冪等性**: `pnpm db:e2e:seed` を 2 回実行してもカウントが増えない(固定 ID upsert)。
11. **文言ルール**: 「止まっている理由」「次にやること」「算定チェック」等(`design/README_Codex.md`)。危険タグ(麻薬/冷所/一包化)を隠さない。主操作(青)は 1 画面 1 つ。

## 4. Non-Negotiables(交渉不可の制約)

- 最初に `git status` を確認する。**作業ツリーが汚れている場合は自分の変更と混ぜず、停止して人間に確認する**(このリポジトリは並行作業が走ることがある)。
- 変更は小さく戻しやすい単位でコミットする(このリポジトリは main 直コミットが慣例。コミットメッセージは英語)。
- 編集前にベースライン検証結果(§6)を記録する。
- 無関係な整形・ついでのリファクタをしない(`pnpm format:check` が CI にあるため、**自分が触ったファイル以外の整形差分を作らない**)。
- 既存挙動を勝手に変えない。正しさが不明なら止めて質問する(§5)。
- 各フェーズ完了ごとに §9 の検証を実行する。
- `src/phos/` 配下と `docs/phos-legacy-api-isolation.md` の境界(PH-OS v1.1 API は API Gateway 所有)を変更しない。
- `prisma/schema/`・`prisma/migrations/`・保存済みデータ形式の変更は本指示書の範囲では行わない(提案のみ)。
- `node_modules/next/dist/docs/` の Next.js ガイドに反する書き方をしない(`AGENTS.md` 要求)。
- テストを「通すために緩める」のは §7 D10 で指定したアサーション安定化のみ。それ以外でアサーションを弱めない。

## 5. Stop And Ask Conditions(実装を止めて質問する条件)

以下に該当したら、そのフェーズを中断し、質問を書き出して人間の回答を待つ:

1. 削除候補のコードに、grep で検出できない参照(動的 import、文字列ルーティング、E2E セレクタ、外部ドキュメントからのリンク)がありうると疑われるとき。
2. テストと実装が矛盾しており、どちらが正かコードと docs から判断できないとき。
3. 変更が公開 API のレスポンス形、DB schema、保存済みデータ(Setting JSON 等)、URL に影響しうるとき。
4. 認可・監査ログ・通知・外部連携(adapters)・課金(billing)に挙動差が出うるとき。
5. 文言・表示の「統一」がデザイン仕様の変更を意味するとき(例: 画面ごとに異なる cycle status ラベル)。
6. ベースラインで green だったテストが自分の変更で red になり、5 分調べて原因が特定できないとき(revert して報告)。
7. 本指示書の Debt Map に無い大きな問題を見つけたとき(勝手に直さず、発見として報告)。

## 6. Baseline Commands(開始時に必ず実行・記録)

```bash
git status --short | head -30        # 汚れていたら停止(§4)
git log --oneline -5
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test 2>&1 | tail -5             # 結果を記録
```

**既知のベースライン失敗(2026-06-12 時点・あなたの変更起因ではない)**: 全 ~5,851 tests 中、以下 3 ファイル 6 件が AWS SDK のコンストラクタ引数 deep-equal(SDK 内部フィールド `handlerProtocol` 等)で失敗する。これは D10 の修正対象。

- `src/lib/config/secrets.test.ts`(2)
- `src/server/services/collaboration-room-token.test.ts`(2)
- `src/phos/backend/lambda-observability-aws-client.test.ts`(2)

これ以外の失敗が出たら、あなたの環境または直近変更の問題。先に解消してから進む。

## 7. Debt Map(負債一覧)

> 各項目: 【根拠】実測箇所 /【負債である理由】/【影響】/【リスク】/【改善案】/【検証】/【実装可否】

### D1. 認可ラッパーの二重系統(withAuth 93 ファイル / withAuthContext 61 ファイル)

- 【根拠】`src/lib/auth/middleware.ts`(`withAuth`、`AuthenticatedRequest` 注入)と `src/lib/auth/context.ts`(`withAuthContext`、`(req, ctx, routeContext)`)。route ファイル実測: withAuth=93、withAuthContext=61。両者とも `requireAuthContext` に集約済みで意味的差は薄い。
- 【負債である理由】新規 API を書くたびにどちらか迷う。シグネチャ差でヘルパー共有が阻害される。
- 【影響】`src/app/api` 全域。 【リスク】一括変換はシグネチャ差(req 拡張 vs ctx 引数)があり、機械置換は事故りやすい。
- 【改善案】(a) `docs/api-conventions.md`(新設)に「新規・改修は withAuthContext 標準」と明文化し、`context.ts` の JSDoc に `@preferred`、`middleware.ts` に `@deprecated`(削除はしない)を付す。(b) 一括移行は **しない**(提案のみ)。
- 【検証】tsc / lint / 既存 route テスト(2,457 件)green。
- 【実装可否】(a) は今実装してよい。(b) は提案に留める。

### D2. AuditLog 書き込みのインライン分散(54 ファイル)

- 【根拠】`tx.auditLog.create` を直接呼ぶ非テストファイル実測 54。フィールド(ip_address / user_agent)の付け漏れが既に散見される(`docs/design-gap-analysis.md` バックエンド調査 5 章)。
- 【負債である理由】監査はコンプライアンス必須(Audit by Default)。書式の分散は付け漏れ・action 命名ゆれの温床。
- 【影響】全書き込み API。 【リスク】置換ミス = 監査欠落(重大)。トランザクション内であることを崩さないこと。
- 【改善案】`src/lib/audit/audit-entry.ts` を新設: `createAuditLogEntry(tx, ctx, { action, targetType, targetId, changes })`(org_id/actor_id/ip/user_agent を ctx から自動)。**新設 + 代表 10 ファイル以内の置換**に留め、残りは後続タスク化。置換対象は「ctx を持つ withAuthContext ルート」から選ぶ(機械的に安全)。
- 【検証】置換した各 route の既存テストが green であること。テストが auditLog.create の引数を検証している場合、同一引数になることを確認。
- 【実装可否】ヘルパー新設+10 ファイル以内の置換は今実装してよい。全 54 置換は提案に留める。

### D3. 日付ヘルパーの併存と setHours(0,0,0,0) 残存 13 ファイル

- 【根拠】`src/lib/date-key.ts`(`formatDateKey`)と `src/lib/utils/date-boundary.ts`(2026-06-12 新設。`localDateKey` は date-key を再利用)。`setHours(0, 0, 0, 0)` が非テスト 13 ファイルに残存(grep 実測)。API 層の `@db.Date` 比較は統一済みだが、サービス/旧 UI 層に未判定の残りがある。
- 【負債である理由】`@db.Date` カラムへのローカル深夜比較は JST で 1 日ズレる実証済みバグパターン。
- 【影響】当日系の表示・ジョブ。 【リスク】**DateTime カラム比較や UI 表示用の setHours は正しい用法**であり、無差別置換は逆に壊す。
- 【改善案】13 ファイルを 1 件ずつ開き、「比較相手が `@db.Date` カラム(scheduled*date / visit_deadline_date / medication_start_date / start_date / end_date / target_period*\* / prescribed_date 等)か」を判定した監査表を作る。@db.Date 比較と確定したものだけ `todayUtcRange`/`utcDateFromLocalKey` へ置換。判定不能は Stop-and-ask。
- 【検証】各置換に JST 固定の単体テスト(`date-boundary.test.ts` のパターン踏襲)を追加。
- 【実装可否】監査表の作成と「確定分のみ」の置換は今実装してよい。

### D4. 死コード候補(参照ゼロ証明の上で削除)

- 【根拠/候補】
  1. `src/components/layout/global-search-modal.tsx` — `@deprecated` 付与済み(2026-06-11 に /search へ移行)。app-shell からの参照は除去済み。
  2. `src/components/layout/breadcrumb.tsx` + `src/lib/navigation/route-labels.ts` — app-header からパンくず削除済み(新デザイン)。実測で UI からの参照は route-labels↔breadcrumb の相互のみ。E2E も「パンくずが無いこと」を検証する側に書き換え済み(`ui-dashboard-nav.spec.ts`)。
  3. `src/lib/stores/ui-store.ts` の `globalSearchOpen` / `setGlobalSearchOpen` — 実測でストア定義以外の参照なし。
  4. `src/app/(dashboard)/dashboard/dashboard-content-legacy.tsx` — 参照有無は未確定。**削除前に必ず import 元を grep**。
  5. `src/app/(dashboard)/patients/[id]/process-tab.tsx` — 旧 8 工程定義。ただし `?view=profile` の旧タブから到達しうる(**確認必須**。Q2 参照)。
- 【負債である理由】新規参加者が「どちらが現役か」を誤認し、deprecated 側を改修する事故が起きる。
- 【影響/リスク】削除自体は低リスクだが、動的参照・E2E セレクタ・ドキュメントリンクの見落としに注意。
- 【改善案】各候補について (1) `grep -rn "<シンボル/ファイル名>" src tools docs` で参照ゼロを記録 → (2) 削除 → (3) tsc/lint/test。1〜3 は今削除してよい。4 は参照ゼロ証明後に削除可。5 は削除ではなく **9 工程への置換**(Appendix Q2 の推奨回答。承認後 Phase 5 で実施)。
- 【検証】tsc(参照切れは即検出)+ 全 vitest + `ui-dashboard-nav` / `ui-major-screens` の E2E スポット。
- 【実装可否】1〜3 は今実装。4 は証明後。5 は Q2 承認後に Phase 5 で実装。

### D5. 壊れやすい AWS SDK モックテスト(ベースライン 10 失敗)

- 【根拠】§6 の 6 ファイル。失敗内容は「SDK クライアントのコンストラクタ引数 deep-equal が SDK 内部フィールド(`requestHandler.metadata.handlerProtocol` 等)まで比較」しているため、SDK パッチで壊れる。
- 【負債である理由】プロダクトの挙動と無関係にベースラインが赤く、本物の回帰を隠す。
- 【影響】CI の信頼性。 【リスク】低(テストのみ)。ただし「検証している意図(region / credentials / maxAttempts / timeout 設定)」は維持すること。
- 【改善案】deep-equal を `expect.objectContaining({ region, maxAttempts, ... })` 形式へ。requestHandler はインスタンス型 or 渡した timeout 値のみ検証。
- 【検証】対象 6 ファイルが green になり、意図フィールドの検証が残っていること。`pnpm test` 全体が **0 failed** になること(本指示書完遂後の必達)。
- 【実装可否】今実装してよい。

### D6. cycle status 表示ラベルの分散定義

- 【根拠】`src/app/api/patients/[id]/route.ts:117` 付近(`intake_received: '受付済'`)、`prescription-history-content.tsx:156`、`workflow-dashboard-view.tsx:38`(`応需受付`)、`prescriptions-workspace.tsx:37`(`受付`)、加えて正規の `src/lib/prescription/cycle-workspace.ts`(`CYCLE_WORKSPACE_ACTIONS.statusLabel`)。同じ enum に画面ごとに別ラベル。
- 【負債である理由】状態色・文言の SSOT(`docs/ui-ux-design-guidelines.md`)に反しやすく、文言ルール変更時に漏れる。
- 【影響】4+ 画面と 1 API。 【リスク】**ラベル文言が画面ごとに意図的に違う可能性**(一覧では短く等)。文言を勝手に統一すると表示仕様変更になる。
- 【改善案】`cycle-workspace.ts` に `CYCLE_STATUS_LABELS`(正: 受付済系)と `CYCLE_STATUS_SHORT_LABELS`(フィルタチップ用)を定義し、現役 3 箇所(patients API / prescription-history / prescriptions-workspace)を参照へ寄せる。`statusLabel`(〜待ち形)は別概念として維持。旧 UI(workflow-dashboard-view)は D8 撤去まで変更しない。詳細は Appendix Q3。
- 【検証】対象画面の unit テスト + スナップショットが文言不変であること(Q3 の推奨回答では実文言の変更はゼロ)。
- 【実装可否】Q3 承認後、Phase 5 で実装してよい。

### D7. 肥大モジュール(抽出はテスト確保後・小さく)

- 【根拠(実測行数)】`schedules/day-view.tsx` 5,005 / `admin/drug-masters/drug-master-content.tsx` 4,125 / `schedules/proposals/schedule-proposals-content.tsx` 2,958 / `prescriptions/new/prescription-intake-form.tsx` 2,757 / `server/jobs/daily.ts` 2,265 / `server/services/billing-evidence/core.ts` 2,195 / `api/patients/[id]/route.ts` 2,046 / `server/services/patient-detail.ts` 1,878。
- 【負債である理由】`docs/repository-audit-2026-06-10.md` の「Theme 1: shrink high-risk modules behind stable boundaries」と同一認識。変更影響が読めず、今回のトラックでも修正衝突が起きやすかった。
- 【影響】中核業務すべて。 【リスク】高。UI コンポーネント分割は描画順・hooks 順の崩れで挙動が変わりうる。
- 【改善案(この指示書での上限)】「**純関数・定数・型だけ**を `*.shared.ts` / `*.helpers.ts` へ移動 + re-export で互換維持」に限定する。既存前例: `day-view.shared.ts`、`dashboard-cockpit.helpers.ts`、`patient-detail-helpers.ts`。対象は day-view.tsx と patient-detail.ts の 2 つだけに絞り、それぞれ移動は 300 行以内/コミット。JSX 分割・hooks 抽出・サービス分割は提案に留める(Phase 7)。
- 【検証】移動した関数へ characterization テスト(現挙動の固定)を先に書く → 移動 → 既存テスト+新テスト green。
- 【実装可否】上記の限定範囲のみ今実装してよい。それ以上は提案。

### D8. 新旧二層 UI と旧ダッシュボード API 群の並立(意図的・撤去はプロダクト判断)

- 【根拠】各画面下部の旧 UI 温存(`#patients-classic`、`調剤キュー(全件一覧)`、`セット計画・鑑査(従来ビュー)` 等)。API も新 BFF(`/api/dashboard/cockpit`、`/api/patients/board` 等)と旧(`/api/dashboard/home/*`、`/api/dashboard/today` 等)が並立。
- 【負債である理由】長期的には二重保守。ただし**移行期の安全網として意図的に温存**された(Plans.md 記録)。
- 【改善案】今は触らない。撤去時期・条件(Q1)の回答を得てから別タスクで段階撤去。
- 【実装可否】**実装しない**(Out-of-scope)。質問のみ。

### D9. ファイルメタデータの Setting JSON 保存

- 【根拠】`src/server/services/file-storage.ts` がファイルメタを `Setting(scope='organization', key='file_asset:<id>')` の JSON で保存(`docs/design-gap-analysis.md` バックエンド 7 章で負債と認定済み)。
- 【負債である理由】一覧・検索・JOIN ができず、新機能(証跡写真管理・音声メモ)が同じ歪みを継承しかける。
- 【リスク】保存済みデータの移行を伴う(schema 変更+データ migration)。
- 【実装可否】**実装しない**。`FileAsset` モデル新設+移行計画の提案文(Phase 7)のみ。Q5。

### D10. その他 schema 起因(提案のみ)

- `WorkflowException` に `patient_id` 列が無く患者別絞り込みが常に cycle→case JOIN(`prisma/schema/prescription.prisma`)。
- `DrugAlertRule` に `org_id` が無くテナント別チューニング不可(`docs/design-gap-analysis.md` 横断ノート)。
- RX 番号が採番列なしの表示用合成(`src/lib/prescription/rx-number.ts` の JSDoc に明記)。業務番号化するなら採番列が必要(Q4)。
- 【実装可否】いずれも **実装しない**。提案のみ。

### D11. API レスポンス封筒の不統一({data} ラッパー vs 素 JSON)

- 【根拠】`src/app/(dashboard)/dashboard/dashboard-summary-badges.tsx:23` のコメント「/api/dashboard/today は success() で素の JSON を返す({data} ラッパー無し)」と、その下の**両対応パースコード**。一覧系 API は `{ data: [...] }`、集約系 BFF は素 JSON が混在。
- 【負債である理由】クライアントが API ごとに封筒形を覚える必要があり、両対応コードが増殖し始めている(増殖の初期段階)。
- 【影響】全フロント fetch。 【リスク】既存 API の封筒を変えると全クライアント・E2E が壊れる(**既存変更は禁止**)。
- 【改善案】`docs/api-conventions.md`(Phase 3 で新設)に現状の二形式を「仕様」として明文化: 一覧=`{data, total?, cursor?}` / 集約 BFF=素 JSON。新規 API はこの規約に従う。既存の封筒変更・クライアント両対応の削除はしない。
- 【検証】文書のみ(コード変更なし)。
- 【実装可否】文書化のみ今実装してよい。封筒の統一移行は提案にも入れない(費用対効果が低い)。

### D12. 環境変数 118 キー・起動時検証なし・危険ローカルスイッチ

- 【根拠】`process.env.*` のユニークキー実測 118。検証モジュール(`src/lib/env*` 等)は不存在。`ALLOW_LOCAL_AUTH_FALLBACK` / `ALLOW_LOCAL_DEMO_PASSWORD_LOGIN` という**本番で有効化されてはならないスイッチ**が存在する。
- 【負債である理由】必須キー欠落が実行時の深部エラーとして現れる。危険スイッチの本番混入を機械が止めない(医療システムとして重大)。
- 【影響】起動・全ランタイム。 【リスク】起動時 fail-fast は「新しい挙動」であり、誤実装するとデプロイを止める。
- 【改善案】(a) `src/lib/env/assert-env.ts` を新設: `assertProductionEnvSafety(env)`(本番判定時に ALLOW*LOCAL*\* が truthy なら throw、コア必須キーの存在を検査)+ 単体テスト。**関数とテストの新設まで**。(b) 実際の起動パス(instrumentation 等)への組み込みは、デプロイ挙動に影響するため提案(Phase 7)に留める。(c) 118 キーの一覧表(必須/任意/danger 分類)を `docs/env-catalog.md` に生成。
- 【検証】新設関数の単体テスト(本番+スイッチ ON で throw、開発では throw しない)。
- 【実装可否】(a)(c) は今実装してよい。(b) は提案。

### D13. fire-and-forget / エラー握りつぶしの分布(77 箇所)

- 【根拠】`.catch(() => {})` / `.catch(() => null)` / `void fetch` 等が非テスト 77 箇所(実測)。多くは意図的(SSE 切断、UI 先行更新、ベストエフォート通知)だが、**意図的か漏れかをコードから区別できない**。
- 【負債である理由】監査ログ・通知・同期系で「静かに失敗」が混ざると検知できない。
- 【影響】通知/同期/ログ周辺。 【リスク】一律に await 化すると UI ブロッキングや二重エラー表示など挙動が変わる(**一括修正禁止**)。
- 【改善案】`docs/async-fire-and-forget-audit.md` に 77 箇所の監査表(箇所 / 何を握りつぶすか / 意図的か要修正か / 根拠)を作成する**だけ**。「要修正」と判定した項目は表に残し、修正自体は提案(Phase 7)。conventions に「意図的な fire-and-forget は `// intentional: <理由>` コメントを付ける」規約を追加。
- 【検証】表の網羅性(grep 件数と一致)。コード変更なし。
- 【実装可否】監査表と規約文書化のみ今実装してよい。

### D14. server サービス型への client 参照(軽微)

- 【根拠】`'use client'` ファイル 3 件が `@/server/services/visit-route-engine` から `import type { VisitRoutePlan, ... }`(実測。すべて type-only で実行時混入は無い)。
- 【負債である理由】サーバー内部の型がクライアント契約になっており、サーバー側の型変更が UI を壊す経路が暗黙。
- 【改善案】`VisitRoutePlan` / `VisitRouteTravelMode` を `src/types/visit-route.ts` へ移し、server 側から re-export(互換維持)。または現状維持で conventions に「client が参照してよい型は src/types のみ」を明記し、この 3 件を既知の例外として記載。**どちらでも可、工数 15 分の前者を推奨**。
- 【検証】tsc + 対象 3 ファイルの unit/E2E スポット。
- 【実装可否】今実装してよい(Phase 6 に含める)。

### D15. ログ方針の不在(console 直書き 16 ファイル・logger 基盤なし)

- 【根拠】`src/lib/logger*` 不存在。`console.error/warn` が api/server の 16 ファイル(分布は限定的で規律はある)。監査ログ(AuditLog)と運用ログ(console)の使い分けは暗黙。
- 【負債である理由】PHI をうっかり console に出す事故を規約で防げない(redaction は AuditLog 側のみ)。
- 【改善案】conventions に「console.error には PHI(患者名・住所・自由記述)を渡さない / エラーは id・enum・件数で表現する」を明文化し、16 ファイルを目視レビューして違反があれば**その箇所だけ**修正。logger 基盤の新設は提案(Phase 7)に留める。
- 【検証】レビュー結果の記録。修正した場合は該当テスト green。
- 【実装可否】規約文書化+違反箇所の点検・最小修正は今実装してよい。

### D16. ドメイン文字列リテラルの型なし散在(severity / status)

- 【根拠】Prisma 上 String のドメイン値がリテラルで散在: `'critical'` 62 箇所、`status: 'open'` 系 34 箇所(実測、非テスト)。`WorkflowException.severity`(critical/warning/info)、`status`(open/resolved/dismissed)等に共有 union 型・定数が無く、タイポが型で捕まらない。
- 【負債である理由】医療安全に関わる severity の綴り間違いが実行時まで発見されない。enum 追加時に grep 漏れが起きる。
- 【影響】workflow-exceptions / 右レール / ジョブ等。 【リスク】低(型の追加は挙動不変)。ただし **Prisma schema の enum 化は migration を伴うため対象外**(型レイヤのみ)。
- 【改善案】`src/types/domain-literals.ts`(または既存の近接ファイル)に `ExceptionSeverity` / `ExceptionStatus` 等の union 型と `as const` 定数を定義し、**型注釈の追加だけ**を散在箇所へ適用(値の変更ゼロ)。全 96 箇所を一括せず、WorkflowException 関連(severity/status)に限定して 1 コミット。
- 【検証】tsc(タイポがあればここで発覚する=即価値)+ 既存テスト green。
- 【実装可否】WorkflowException 関連に限定して今実装してよい。他ドメイン値への展開は提案。

### D17. コーディング規約と実態の乖離(コメント言語・配置規則の暗黙化)

- 【根拠】`CLAUDE.md` は「Code / comments / variables: English」と規定するが、実測で **73/1,337 ファイル(非テスト)に日本語コメント**が存在(直近のデザイン忠実トラックで日本語ドメイン用語のコメントが定着)。また、コンポーネント配置は `src/components/features/`(73 ファイル)と各ページ配下(`*-content/-board/-workbench.tsx` 60 ファイル)に分かれるが、どちらに置くかの規則が文書化されていない。
- 【負債である理由】規約文書が現実と乖離していると、新規参加者・実装エージェントがどちらに従うべきか判断できず、レビュー基準もぶれる。
- 【影響】開発プロセス全体。 【リスク】コード変更ゼロ(文書と規約の問題)。ただし**コメント言語の方針自体はチーム判断**(Q7)。
- 【改善案】(a) Q7 の回答確定後、`CLAUDE.md` の言語規約を実態に合わせて改訂(推奨は「コメントは日本語可(ドメイン用語の正確性優先)、識別子は英語」)。(b) `docs/api-conventions.md`(Phase 3)に配置規則を明文化: 「単一画面専用 = ページ配下に colocate / 2 画面以上で再利用 = `src/components/features/<domain>/` / 純関数は `*.shared.ts`・`src/lib/`」+「ファイル名は kebab-case(`src/phos/` のみ歴史的例外)」。
- 【検証】文書のみ。
- 【実装可否】(b) は今実装してよい。(a) は Q7 承認後。

## 8. Implementation Phases(この順で。各フェーズ = 1〜数コミット)

### Phase 0: 現状確認

1. §6 を実行し、結果(コミットハッシュ、test 件数、既知失敗一覧)を作業ログに記録。
2. `git status` が汚れていたら停止(§4)。

### Phase 1: 安全網(壊れやすいテストの安定化)— D5

1. 6 ファイルのアサーションを `objectContaining` 化(意図フィールド検証は維持)。
2. `pnpm test` 全体 **0 failed** を達成・記録。以後これが回帰判定の基準線になる。

### Phase 2: 参照ゼロの死コード削除 — D4(1〜3 → 4)

1. 候補ごとに参照 grep の結果を記録 → 削除 → `pnpm typecheck && pnpm test`。
2. `dashboard-content-legacy.tsx` は参照ゼロを証明できた場合のみ。`process-tab.tsx` は Q2 回答まで触らない。
3. E2E スポット: `pnpm test:e2e:local ui-dashboard-nav --project=chromium`(9 tests green 維持)。

### Phase 3: 横断ヘルパーの新設と標準の明文化 — D1(a) / D2

1. `src/lib/audit/audit-entry.ts` 新設 + 単体テスト。
2. withAuthContext ルートから代表 10 ファイル以内で置換(1 コミット 3〜4 ファイル)。
3. `docs/api-conventions.md` 新設。内容: withAuthContext 標準・監査ヘルパー・rate-limit 登録・zod 検証・withOrgContext の標準形(`docs/design-gap-analysis.md` 5 章から要約)+ **レスポンス封筒の二形式仕様(D11)** + **ログ規約: console に PHI を渡さない(D15)** + **意図的 fire-and-forget の `// intentional:` コメント規約(D13)** + **client が参照してよい型は src/types のみ(D14)** + **コンポーネント配置規則と kebab-case 命名(D17b: 単一画面=ページ配下 colocate / 再利用=components/features / 純関数=shared・lib)**。
4. `middleware.ts` に `@deprecated`(削除しない)、`context.ts` に推奨 JSDoc。
5. D15 の点検: console.error/warn の 16 ファイルを目視レビューし、PHI 混入があればその箇所だけ修正(無ければ「違反なし」を記録)。

### Phase 4: 残存リスクの監査表と確定置換 — D3 / D12 / D13

1. 日付境界: 13 ファイルの監査表(ファイル / 行 / 比較相手カラム / @db.Date か / 判定)を `docs/date-boundary-audit.md` に作成。確定分のみ置換 + JST テスト追加。判定不能行は「要確認」とし Stop-and-ask。
2. env: `src/lib/env/assert-env.ts` + 単体テストを新設(D12a。**起動パスへの組み込みはしない**)。118 キーの分類表を `docs/env-catalog.md` に作成(D12c)。
3. 非同期: `docs/async-fire-and-forget-audit.md` に 77 箇所の監査表を作成(D13。コード変更なし。「要修正」判定は表に残し Phase 7 の提案へ)。

### Phase 5: 表示ラベル・ドメイン型の整備と工程タブの 9 工程化 — D6 / D4-5 / D16(2〜3 は Appendix Q2・Q3 の承認が前提)

1. `cycle-workspace.ts` に `CYCLE_STATUS_LABELS` / `CYCLE_STATUS_SHORT_LABELS` を追加(既存 `CYCLE_WORKSPACE_ACTIONS` は変更しない)。
2. 現役 3 箇所(patients API / prescription-history / prescriptions-workspace)を共通定数参照へ(実文言は不変)。旧 `workflow-dashboard-view` は触らない。
3. `process-tab.tsx` をローカル 8 工程配列から `ProcessChips` + `PROCESS_STEPS_9` 再利用へ置換し、タブ説明文を 9 工程へ更新(unit テスト追随)。
4. D16: `ExceptionSeverity` / `ExceptionStatus` の union 型 + `as const` 定数を新設し、WorkflowException 関連の散在リテラルへ**型注釈のみ**追加(値の変更ゼロ。tsc がタイポ検出器になる)。
5. Q2/Q3 が未承認の場合は 2〜3 をスキップし、Stop-and-ask として報告する(1・4 は承認不要で実施可)。

### Phase 6: 限定的な抽出と型境界 — D7 / D14

1. 対象関数に characterization テストを先に追加。
2. 純関数・定数・型のみを shared/helpers へ移動(1 コミット 300 行以内、re-export で互換)。対象は day-view.tsx と patient-detail.ts のみ。
3. D14: `VisitRoutePlan` / `VisitRouteTravelMode` を `src/types/visit-route.ts` へ移動し、`visit-route-engine.ts` から re-export(client 3 ファイルの import 先を src/types へ)。
4. 各コミットで tsc / lint / 対象 unit + `DESIGN_SCREEN_IDS=new_03,new_06 pnpm test:e2e:local ui-design-fidelity --project=chromium` で撮影が変わらないこと。

### Phase 7: 提案書(実装しない)

`docs/refactor-proposals.md` に以下を、それぞれ「動機 / 影響範囲 / 移行手順案 / ロールバック / 必要な承認」付きで記述:

- withAuth → withAuthContext の残り 93 ファイル移行計画(D1b)
- auditLog ヘルパーの残り ~44 ファイル展開(D2)
- 旧 UI 層・旧ダッシュボード API の撤去条件と手順(D8、Q1 連動)
- FileAsset モデル化と Setting JSON からの移行(D9、Q5)
- WorkflowException.patient_id / DrugAlertRule.org_id / RX 採番列(D10、Q4/Q6)
- 巨大 UI(drug-master-content / schedule-proposals / prescription-intake-form / daily.ts / billing-evidence/core)の分割設計案
- env 起動時検証(assert-env)の本番起動パスへの組み込み計画(D12b: instrumentation での呼び出し、段階導入とロールバック)
- fire-and-forget 監査表で「要修正」となった項目の個別修正計画(D13)
- 構造化 logger 基盤(PHI セーフな運用ログ)の導入要否(D15)

## 9. Verification Requirements

- 各コミット前: `pnpm lint && pnpm typecheck`、触った領域の `pnpm vitest run <paths>`。
- 各フェーズ完了時: `pnpm test`(Phase 1 以降は **0 failed** 必達)+ `pnpm format:check`。
- UI に触れたフェーズ(2, 5, 6): 上記 E2E スポット+撮影ループで対象画面の構成不変を確認。
- 最終: `pnpm date-slices:check && pnpm eventbridge-schedules:check && pnpm build` まで通す。
- 検証コマンドの出力(末尾サマリ)を都度ログに残す。

## 10. Reporting Format(完了報告の形式)

```markdown
## Refactor Report(YYYY-MM-DD)

### Baseline

- commit: <hash> / tests: <passed>/<failed>(既知失敗: ...)

### Phases

- Phase N: <やったこと 1-3 行> / commits: <hashes> / verification: <コマンドと結果>

### Skipped / Stop-and-ask

- <質問として残した項目と理由>

### Discovered (not fixed)

- <Debt Map 外で見つけた問題>

### Final Verification

- lint / format:check / typecheck / test(0 failed)/ date-slices / eventbridge / build: <結果>
- E2E spot: <spec と結果>
```

## 11. Out-of-scope Items(この指示書ではやらない)

- DB schema・migration・保存済みデータ形式の変更(D9 / D10 / RX 採番)
- 旧 UI 温存層・旧ダッシュボード API の撤去(D8)
- withAuth 全 93 ファイルの一括移行
- `src/phos/` 配下の変更(隔離境界)
- 新機能の追加、デザイン変更、文言変更
- `tools/infra/` のインフラ定義変更
- 依存パッケージの追加・更新(CLAUDE.md のバージョン固定方針)
- Plans.md の整理(別運用タスク)
- 既存 API のレスポンス封筒({data} ↔ 素 JSON)の統一移行(D11 — 文書化のみ行う)
- Prisma schema の String → enum 化(D16 は TypeScript 型レイヤのみ。schema enum 化は migration を伴うため対象外)
- 日本語コメントの英訳・一括書き換え(D17 — 規約改訂は Q7 の判断。コメントの言語変換作業は行わない)
- env 検証の本番起動パスへの組み込み(D12b — 関数新設まで)
- logger 基盤の新設(D15 — 規約文書化と点検まで)
- fire-and-forget 77 箇所の一括 await 化(D13 — 監査表まで)

---

## Appendix: 実装前の確認事項と推奨回答(2026-06-12 詳細調査済み)

> 各質問に、コード実測に基づく推奨回答を用意した。**人間は承認(または修正)だけすればよい。**
> 「承認時の扱い」が「本指示書で実装可」のものは、承認後に該当 Phase へ組み込んでよい。

### Q1(D8): 旧 UI 温存層と旧ダッシュボード API の撤去時期

- **推奨回答: 今は撤去しない。「機能パリティ条件リスト」を満たした画面から段階撤去する。**
- 根拠(実測): 旧 UI には新 UI に未移植の機能が現存する —
  (1) `patients-table.tsx` の CSV エクスポート列定義(`exportValue` 8+ 列)と詳細フィルタ/薬歴 PDF 一括出力、
  (2) `medication-sets-content.tsx` の計画作成・鑑査登録ダイアログ(新 `set-workspace.tsx` は読み取り中心)、
  (3) E2E 6 スペック(`ui-major-screens` / `ui-audit-extensions` / `ui-detail-layout` / `ui-mobile-layout` / `ui-patient-flow` ほか)が旧 UI 要素を検証中。
- 撤去条件(画面ごと): ① 旧 UI 固有操作の新 UI 移植完了 ② 該当 E2E の新 UI 置き換え ③ 新 UI の本番安定 2 週間。旧ダッシュボード API(`/api/dashboard/home/*`、`/api/dashboard/today`)は参照する旧 UI の撤去と同時に削除。
- 承認時の扱い: 本指示書では実装しない(Phase 7 の提案書に上記条件リストを転記する)。

### Q2(D4-5): `?view=profile` の「工程」タブ(旧 8 工程)

- **推奨回答: (a) 9 工程へ置換する。**
- 根拠(実測): `patient-detail-tabs.tsx:53` でタブ「工程」(`value: 'process'`、説明文「8 工程の進行と次にやること」)が現役到達可能。一方カードビュー(既定)は `PROCESS_STEPS_9` の `ProcessChips` を表示しており、**同一患者で開くビューによって工程数・語彙(調剤鑑査 vs 監査、算定の有無)が食い違う**。工程語彙の SSOT は新デザインの 9 工程(`design/images/new`、`cycle-workspace.ts` の `PROCESS_STEPS_9`)。
- 実装内容: `process-tab.tsx` のローカル 8 工程配列を削除し `ProcessChips`+`getProcessStepKeyForStatus` を再利用。タブ説明文を「9 工程の進行と次にやること」へ。下部の「現在の工程」カード(`CYCLE_WORKSPACE_ACTIONS` 使用)は既に共通定義のため不変。
- 承認時の扱い: **本指示書で実装可**(Phase 5 に追加。低リスク: タブ内 UI のみ、unit テスト `process-tab` 系を更新)。

### Q3(D6): cycle status 表示文言の統一

- **推奨回答: 「受付済」系(現行多数派)を正として統一する。ただし旧 UI(D8 対象)内は触らない。**
- 根拠(実測の対照表、`intake_received` の例):
  | 箇所 | 文言 | 現役/旧 |
  |---|---|---|
  | `api/patients/[id]/route.ts:118` | 受付済 | 現役 API |
  | `prescription-history-content.tsx:156` | 受付済 | 現役画面 |
  | `prescriptions-workspace.tsx:37` | 受付(フィルタチップ短縮) | 現役(「カード」ページ) |
  | `workflow-dashboard-view.tsx:38` | 応需受付 | 旧 UI(/workflow、新ナビ外) |
  | `cycle-workspace.ts` statusLabel | 処方構造化待ち(次アクション文脈) | 現役(右レール/カード) |
- 整理: ①「状態名」= `CYCLE_STATUS_LABELS`(正: 受付済系)と ②「フィルタ用短縮」= `CYCLE_STATUS_SHORT_LABELS` を `cycle-workspace.ts` に新設し、現役 3 箇所を参照へ寄せる。③ `statusLabel`(〜待ち形)は「いま何を待っているか」を表す別概念としてそのまま維持(統合しない)。④ 旧 `workflow-dashboard-view` は D8 撤去で消えるため変更しない。
- 承認時の扱い: **本指示書で実装可**(Phase 5 の作業を「参照共通化(文言不変)」から「上記 3 箇所の統一」へ拡張。文言が変わるのは現状ゼロ — 受付済/受付は定義位置が変わるだけ)。

### Q4(D10): RX 番号の正式採番化

- **推奨回答: 当面は表示用合成のまま(昇格しない)。昇格条件を明文化して待つ。**
- 根拠(実測): `formatPrescriptionCardNumber` の使用 8 箇所はすべて画面表示(cockpit / card-workspace / audit-workbench / intake-triage / search / 型定義)。**印刷物・外部共有(`src/app/shared`)・帳票(care-report)・外部連携(adapters)・運用スクリプトへの混入はゼロ**。合成は決定的(同一 intake は常に同一表示)なので画面間の不整合は起きない。
- 昇格条件(いずれかが要件化したら採番列+migration を計画): ① 印刷物/FAX/外部共有ポータルに RX 番号を記載する ② レセコン連携キーにする ③ 上部バー検索で RX 番号入力によるカード検索を提供する(現状の検索は患者名ベース)。
- 承認時の扱い: 実装なし。Phase 7 提案書に昇格条件と採番設計案(org_id+年スコープの連番、同時実行対策)を記載。

### Q5(D9): FileAsset モデル化(Setting JSON からの移行)

- **推奨回答: 次サイクルで実施を推奨(優先度: 中)。本指示書では提案のみ。**
- 根拠(実測): `file_asset:` プレフィックスの読み書きは `src/server/services/file-storage.ts` 1 ファイルに完全に閉じている(他参照ゼロ)→ 切替面が最小で移行容易。backfill の前例も `tools/scripts/backfill-webhook-registration-secrets.ts` にある。
- 移行手順案(無停止): ① `FileAsset` モデル追加(org_id+RLS、migration)② file-storage を二重書き込みに ③ backfill スクリプトで既存 Setting 行を移送 ④ 読み取りを FileAsset 優先へ切替 ⑤ 安定後に Setting 旧キー削除。ダウンタイム不要、二重書き込み期間は数日で十分。
- 位置づけ: 証跡写真管理(p0_33)・音声メモ(p1_11)の実装前提。これらに着手する前に完了させる。
- 承認時の扱い: 実装なし。Phase 7 提案書に上記手順を転記。

### Q6(D10): `WorkflowException.patient_id` / `DrugAlertRule.org_id` の列追加

- **推奨回答: 二つを分離する。`WorkflowException.patient_id` = 次の migration 枠で追加推奨。`DrugAlertRule.org_id` = p1_14(AI シグナル調整)実装まで保留。**
- 根拠(実測):
  - `workflowException.create` は **7 ファイルのみ**(dispense-tasks workbench / consent-records revoke / visit-records / dispense-results / dispense-audits / set-audits / prescription-intake-service)。全箇所で patient_id が文脈から即時取得可能 → nullable 列追加+7 箇所修正+backfill(cycle→case→patient)で完結する低リスク変更。患者別「止まっている理由」projection の JOIN 3 段を解消できる。
  - `DrugAlertRule` は CDS 本体(`src/server/cds/checker.ts`)と admin API・master-readiness が参照。org_id 追加は「グローバルルールと org ルールの優先関係」「誰が編集できるか」という**仕様設計を伴う**ため、要件が確定する p1_14 と同時に設計するのが手戻りがない。
- 承認時の扱い: いずれも本指示書では実装しない(Out-of-scope の schema 変更)。Phase 7 提案書に、patient_id 追加の具体手順(列追加 → 7 箇所修正 → backfill → projection 簡素化)を「次サイクル最初の migration 候補」として記載。

### Q7(D17): コメント言語規約(CLAUDE.md「comments: English」)と実態の乖離

- **推奨回答: CLAUDE.md を実態に合わせて改訂する —「コメント・ドキュメントは日本語可(医療ドメイン用語の正確性を優先)。識別子(変数・関数・型)は英語(camelCase)を維持」。既存コメントの言語変換作業は行わない。**
- 根拠(実測): 非テスト 1,337 ファイル中 73 ファイルに日本語コメントが定着(直近のデザイン忠実トラックの中核ファイル群: card-workspace / cycle-workspace / seed-design-demo / design-screen-map 等)。文言ルール(「止まっている理由」等)やデザイン仕様が日本語で定義されており、英訳コメントはかえって仕様との対応を曖昧にする。識別子の英語規約は実態も遵守されている(`: any` 1 件と同様に規律は高い)。
- 代替案(非推奨): 英語規約を維持し 73 ファイルを英訳 — 工数大・仕様トレーサビリティ低下・継続的に違反が再発する見込み。
- 承認時の扱い: CLAUDE.md の Language 節 1 行改訂のみ(Phase 3 に追加)。**本指示書ではコメントの書き換えは行わない**。
