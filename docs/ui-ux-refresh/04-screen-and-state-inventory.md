# Phase 3 統合: 画面・状態インベントリ（Screen & State Inventory）

作成日: 2026-07-11 / 作成方法: `docs/ui-ux-refresh/phase3/` 配下の inv-01〜inv-10・ssot-discovery.md・user-journeys.md の統合（read-only、コード実行検証なし）。
本書は**マスター索引**であり、per-route の詳細行は各 inv ファイルが正。矛盾時は inv ファイル（およびコード実体）を優先すること。不明は「未確認」。

---

## 1. サマリ

### 1.1 ルート総数の検算

- `page.tsx` 実測 **128**（`find src/app -name page.tsx`、本日再実測で一致。phase0 `phase0/02-app-router-structure.md:7` の 128 とも一致）。
- バケット別内訳（合計 128 で一致）:

| バケット | ルート数 |
| --- | ---: |
| inv-01 Auth/Legal/Entry | 13 |
| inv-02 Platform/組織管理 | 16 |
| inv-03 Admin マスターデータ | 14 |
| inv-04 Admin 運用・監視 | 11 |
| inv-05 Patients コア | 12 |
| inv-06 処方・服薬 | 15 |
| inv-07 調剤4工程・ワークフロー・タスク・検索 | 11 |
| inv-08 Schedules/Visits/My-Day | 14 |
| inv-09 Reports/Billing/Statistics | 10 |
| inv-10 Communications/Home | 12 |
| **合計** | **128** |

### 1.2 layout / loading / error / not-found の被覆率

phase0 `phase0/02-app-router-structure.md` の実測値を引用（本日再実測で全数値一致）:

| ファイル | 件数 | 被覆の要点 |
| --- | ---: | --- |
| `page.tsx` | 128 | — |
| `layout.tsx` | 5 | root / (auth) / (legal) / (dashboard) / platform |
| `loading.tsx` | 60 (47%) | `(dashboard)` 直下と admin 配下ほぼ全ページ・patients/[id] サブページ等。**`(auth)`/`(legal)`/`platform` はゼロ** |
| `error.tsx` | 22 (17%) | root + `(dashboard)` 直下 + 主要セクション単位（admin/patients/prescriptions/reports/billing/visits/schedules/dispense 系ほか）。colocated per-route error.tsx はほぼ皆無（親セグメント継承が意図設計） |
| `not-found.tsx` | 1 | root 直下のみ。セグメント別なし（`notFound()` 呼出は movement-fixture 等コード内に存在） |

補助: root には `unauthorized.tsx` / `forbidden.tsx` / `global-error.tsx` あり（`src/app/`）。

### 1.3 認証境界の構造

- **Edge 層**: `src/proxy.ts` の `PROTECTED_ROUTE_PREFIXES`（:42-66）。前方一致は `=== prefix || startsWith(prefix+'/')` のため **`/dashboard-preview` は `/dashboard` に守られず edge 公開**（inv-01）。`/password/change`・`/mfa/setup` も edge 公開で API 側認可依存。
- **Server 層**: `(dashboard)/layout.tsx:12-19` で `auth()` → 未認証 `unauthorized()` / org 未解決 `forbidden()`。`platform/layout.tsx` は PlatformOperator ゲート（inv-02）。
- **ルート内 SSR ゲートは例外的**: `visits/[id]/capture`（auth+canVisit+assignment scope+PHI read 監査、inv-08）と `statistics`（hasPermission サーバ判定、inv-09）のみ。他は org-wide access model（意図的仕様）+ API 側強制。
- **公開系**: (auth)/(legal)/offline/shared/[token]（トークン+OTP）は未認証到達可（inv-01）。

---

## 2. 画面台帳マスター（バケット別索引）

詳細行は各 inv ファイルが正。以下は 3 行以内の要約のみ。

| # | 台帳 | 要約 |
| --- | --- | --- |
| 01 | [inv-01 Auth/Legal/Entry](phase3/inv-01-auth-legal-entry.md) | 認証 7 画面+法務 2+入口系 4。監査は family 行のみ（per-screen 行なし）。主な逸脱: パスワード強度/6桁入力の 3 重コピー、auth カード手組み反復、legal 2 画面が本文 TBD、mfa 等セキュリティ画面の unit test ゼロ。 |
| 02 | [inv-02 Platform/組織管理](phase3/inv-02-platform-org-admin.md) | platform 2（break-glass 含む）+ admin 系 14。監査は family 単位のみ（notification-settings に T4 個別言及）。主な逸脱: platform 配下 loading/error.tsx ゼロ、service-areas の 'use client' 巨大 page、client 側 capability ゲート不統一、users 停止操作に確認ダイアログなし疑い。 |
| 03 | [inv-03 Admin マスターデータ](phase3/inv-03-admin-master-data.md) | 薬剤/施設/医療機関/算定ルール等 14 ルート。UI_AUDIT_MATRIX 言及は 7/14、残り 7 は監査記録ゼロ。主な逸脱: エラー表示 4 系統分裂、loading.tsx 欠落 4、drug-master-content 2,506 行の 2 ルート兼務、権限 UI 出し分けの非対称。 |
| 04 | [inv-04 Admin 運用・監視](phase3/inv-04-admin-ops-monitoring.md) | analytics/audit-logs/realtime/performance 等 11 ルート。テーマ行（T4-T7）での言及が中心、一部 stale。主な逸脱: ページ骨格 4 流派、performance 最上段帯の false-zero 残存、KPI カード 4 重ローカル実装、uat 下書き非永続。 |
| 05 | [inv-05 Patients コア](phase3/inv-05-patients-core.md) | 患者一覧/詳細(CardWorkspace 5,979 行)/編集/同意/共有/safety-check 等 12 ルート。監査言及は約半数（一部 stale）。主な逸脱: 患者文脈ヘッダ 3 流儀（PatientHeader は 2 画面のみ）、edit の取得エラー=EmptyState 畳み込み（retry なし）、safety-check の E2E ゼロ。 |
| 06 | [inv-06 処方・服薬](phase3/inv-06-prescriptions-medications.md) | 処方受付/QR/患者別服薬/印刷 3 ルート等 15 ルート。監査明示は new/qr-drafts/[id] 等少数。主な逸脱: 印刷 3 ルートのフェッチ+auto-print コピー 3 重化、局所 StatusDot の SSOT 偽装命名、患者名常時表示なしのサブページ多数。 |
| 07 | [inv-07 調剤4工程・WF・タスク・検索](phase3/inv-07-dispense-audit-workflow.md) | workbench 4 画面（protected・独自 CSS/--wb- トークン）+ workflow/handoff/tasks/search 等 11 ルート。監査は P-B（4 画面配色）等で記録。主な逸脱: /views のエラー表示 SSOT 逸脱（retry なし）、状態バッジ 4 方式並存、pharmacy-cooperation content 3,894 行。 |
| 08 | [inv-08 Schedules/Visits/My-Day](phase3/inv-08-schedules-visits.md) | スケジュール 5+訪問系 8+my-day の 14 ルート。offline 対応が最も厚い（record はフル対応）。主な逸脱: capture のみ SSR 権限ゲート+PHI 監査（brief/record 等は非対称）、確認ダイアログ 2 実装併存、E2E 空白 7 ルート（mutation 持ちの conflicts/emergency-route 含む）。 |
| 09 | [inv-09 Reports/Billing/Statistics](phase3/inv-09-reports-billing.md) | 報告書 WS/詳細/印刷/共有+請求+統計の 10 ルート。印刷は監査 POST→print の fail-closed が確立。主な逸脱: reports/analytics の PageScaffold 不使用、billing/candidates の状態遷移 mutation に確認ダイアログなし、error 表現 4 流儀、reports/[id] 1,948 行肥大。 |
| 10 | [inv-10 Communications/Home](phase3/inv-10-communications-home.md) | dashboard コックピット+受信/依頼/カンファ+offline-sync+入口選択 12 ルート。cockpit は SegmentStaleBanner 等 stale-refetch 提示の最良実装。主な逸脱: offline-sync が PageScaffold/metadata.title 不使用（SSOT 明文違反候補）、inbound の URL query-state 欠如、E2E 空白 5 ルート。 |

---

## 3. 状態被覆の横断集計

各 inv の States 列・逸脱節からの横断集計。個別の行レベル詳細は inv ファイル参照。

### 3.1 loading.tsx なし（colocated）

- **セグメント丸ごとゼロ**: `(auth)` 全 7、`(legal)` 2、`/offline`、`/dashboard-preview`、`/shared/[token]`、**`/platform` 配下 2**（inv-01/02）。
- **(dashboard) 内の欠落**（親 loading.tsx 継承で動作はする）: admin 系 = operating-hours / capacity / inventory-forecast / packaging-methods / pharmacy-cooperation / dispense-audit-stats / incidents / operations-insights（inv-02/03/04）。patients 系 = new / compare / collaboration / safety-check / residual-adjustment / [id]/edit（inv-05）。その他 = prescriptions/intake（親の master-detail スケルトンと**形状不一致**、inv-06）、search / views / clerk-support / workflow/pharmacy-cooperation（inv-07）、schedules/conflicts / emergency-route / route-compare、visits/[id] 配下 6 サブルート（inv-08）、reports/[id] 系 3・billing/candidates 等（inv-09）、inbound / requests / external / referrals/new / offline-sync / select-mode / select-site（inv-10）。
- 逆パターン: redirect スタブなのに loading.tsx が残存 = admin/professionals、patients/[id]/management-plan、visit-records（死にファイル、inv-02/06）。

### 3.2 error boundary なし（colocated error.tsx）

- error.tsx は 22 件のみで、**セクション単位境界+親継承が意図設計**（全て `createRouteErrorBoundary` ファクトリで統一 — inv-07）。ただし:
  - `/platform` 配下は loading/error とも皆無で root 依存（admin 側の 2 層構えと非対称、inv-02）。
  - `(auth)`/`(legal)` も root `src/app/error.tsx` のみ。
  - 画面内クエリ単位エラーは概ね実装済みだが、**表示部品が 4 系統以上に分裂**: ErrorState / SegmentError / DataTable errorMessage / 手組み destructive box（mcs、medication-calendar、interprofessional-share、reports/[id] — inv-03/05/06/09）。
  - **retry 導線なしの逸脱**: /views の viewsQuery（素テキストのみ、inv-07）、patients/[id]/edit（エラーと未存在を同一 EmptyState に畳む、inv-05）、select-mode（toast のみ、inv-10）。
  - **false-zero 残存**: admin/performance 最上段「要対応シグナル」帯（error/loading 中も `?? 0` 描画、inv-04）。

### 3.3 empty state 未設計・表現不統一

- 空状態は 3 流派: `EmptyState` 部品 / DataTable `emptyMessage` / 素の `<p>` 文言（inv-03/04/10）。requests・dispense-audit-stats・performance・realtime・alert-rules・contact-profiles 等は素テキスト。
- data-explorer は空状態の明示コンポーネント未確認（inv-04）。0 件 KPI は「中立色」慣行がコメント散在（SSOT 未文書化、inv-03）。

### 3.4 offline 表示なし

- 明示的 offline ハンドリングを持つのは限定的: workbench 4 画面（useNetworkOnline インジケータ）、visits/[id]/record（useOfflineStore フル: 未同期バナー/件数/競合）、capture・voice-memo・evidence（draft 保存）、visits-today（note のみ）、schedules（専用 panel）、notifications（未同期合成行）、offline-sync（本丸）、dashboard の offline バナー（inv-07/08/10）。
- **patients コアバケットは offline 分岐 grep 0 件**（inv-05）。admin/platform/reports/billing 系も専用 offline UI なし（staleTime 設定のみ、inv-03/09）。オフライン UX の共通語彙（未同期バッジ/橙バナー）は record 起点で部分伝播に留まる（inv-08）。

### 3.5 stale-refetch 提示の格差

- 実装最良: dashboard-cockpit / visits-today / reports / billing candidates（SegmentStaleBanner + useStaleAfterRefetchError）、analytics/metrics（stale バナー併記）、statistics（dataUpdatedAt 表示）。patients-board は独自実装。**他の大多数は初回エラー処理のみ**（inv-04/05/08/09/10）。

### 3.6 その他の横断欠落

- **確認ダイアログの穴**: admin/users の停止操作（疑い）、jobs の再実行、billing/candidates の confirm/exclude/reopen、packaging-methods の is_active 停止（inv-02/03/04/09）。ConfirmDialog / AlertDialog 直組みの 2 実装併存（inv-03/08）。
- **入力の非永続**: admin/uat のチェックリスト・下書きが useState のみ（リロード消失、CLAUDE.md 自動保存原則からの逸脱候補、inv-04）。
- **E2E 空白の主要画面**（unit はあるが実ブラウザ経路ゼロ）: safety-check・compare・residual-adjustment（inv-05）、medication-calendar（inv-06）、views・search・clerk-support（inv-07）、conflicts・emergency-route・brief・capture・facility-packet・voice-memo・evidence（inv-08）、reports/[id]/share・reports/analytics・reports/print・statistics（inv-09）、inbound・referrals/new・offline-sync・select-mode/site（inv-10）、platform 2 ルート・admin 大多数（inv-02/03/04）。

---

## 4. SSOT Discovery 要約

詳細: [phase3/ssot-discovery.md](phase3/ssot-discovery.md)

- **Normative（規範）**: `docs/ui-ux-design-guidelines.md`（1,223 行）が唯一の規範 SSOT（§1.1 で自己宣言）。`state-color-migration-map.md` / `uiux-design-system.md` はリダイレクトスタブ化済み。CLAUDE.md の UI 節は一部**旧規則**。
- **Executable（コードで強制）**: `src/app/globals.css`（トークン実体・44px media query 強制・A4 印刷契約）、`src/lib/constants/status-tokens.ts` + `status-labels.ts`（6 軸 StatusRole・26 個の `*_ROLE` 定数）、`button-variants.ts`（44px 契約）、ガード 3 本（`colors:check` 0 drift pass 実測 / `boundaries:check` / `frontend-contract:check`）、shell typography test-lock。
- **De facto（事実上の標準、実測件数）**: PageScaffold 159 / Skeleton 140 / ErrorState 84 / StateBadge 58 / DataTable 45（`ui/table` 直 import 0 = DataTable 経由が事実上強制）。**エラー表現の第一選択は実は toast（601 箇所）**で、toast vs ErrorState の使い分け規範は薄い。
- **主要矛盾**（ssot-discovery §1.3/§4）:
  1. CLAUDE.md 旧状態色規則（患者=緑/橙/灰 等）vs 実装 6 軸トークン — コード側で「不採用」明記済みだが CLAUDE.md 本文未修正。
  2. CLAUDE.md「shadcn/ui」表記 vs 実体 `@base-ui/react`（radix import 0 件）。
  3. guidelines §7.3「StateBadge/StatusDot のみ」vs 旧 `*_VARIANTS` 消費 2 ファイル残存、§7.2 vs ローカル MetricCard/KpiCard 4 件、§3.2 vs 全彩度 `bg-state-*` 76 箇所。
  4. 生 hex 152 行/10 ファイル（workbench CSS 85 + PDF 38 + レガシー phos 島 15 ほか）、`min-h-[44px]` 直書き 458 箇所（三重化。sm: 系 232 箇所は test-locked で削除禁止）。
  5. ラベル分散: `*_LABELS` が constants 外 113 ファイル、「完了」系ラベル 4 揺れ。アイコン 2 義/3 義（Clock・Eye 等）の非明文。
  6. 「SSOT」自称文書の乱立（design-fidelity-mapping / frontend-screen-contracts / decisions.md）で優先順位が文書名から判別不能。

---

## 5. ユーザージャーニー一覧

詳細: [phase3/user-journeys.md](phase3/user-journeys.md)。実在検証済み 17 本 + 実在せず 6 候補。

| ID | ジャーニー | E2E |
| --- | --- | --- |
| J-01 | サインイン→Cognito チャレンジ→MFA→初期画面 | あり（e2e-auth-flow） |
| J-02 | セッション失効→unauthorized→再ログイン復帰 | 部分（失効→復帰の直接シナリオなし） |
| J-03 | 患者検索→選択→詳細 | あり（ui-patient-flow） |
| J-04 | 一覧→フィルタ/保存ビュー→詳細（横断） | あり |
| J-05 | 処方受付(QR/手入力)→調剤→監査→セット→セット監査 | あり（最厚） |
| J-06 | 前回処方との差分レビュー | なし（unit のみ） |
| J-07 | CDS アラート確認→対応→理由記録 | 部分 |
| J-08 | 報告書 draft→confirmed→finalize→送付 | あり（finalize 自体は unit のみ） |
| J-09 | 訪問準備→記録（施設一括）→次患者 | あり |
| J-10 | オフライン編集→ローカル保存→復帰→同期 | route-mocked のみ |
| J-11 | 同期競合→差分確認→解決 | route-mocked のみ（実 409 なし） |
| J-12 | ファイル検証→presigned アップロード→完了 | なし（unit のみ） |
| J-13 | 外部共有発行→/shared/[token] 閲覧→セルフレポート | route-mocked |
| J-14 | 報告書メール送付→メール内リンク→/shared 到達 | なし |
| J-15 | break-glass（運営者テナント横断） | なし（unit のみ） |
| J-16 | スケジュール→ルート提案→適用 | あり |
| J-17 | 事務(clerk) read-all + 作成遮断 | なし（契約テスト中心） |

実在せず（仕様段階/未実装）: 確定後修正の版管理、代理入力→承認、429 待機 UI、CSR 中セッション失効検知、アップロード失敗再試行 UI、「交付」独立画面（set-audit に統合）。

---

## 6. 実画面ブラウザ確認の状況

**本フェーズ（Phase 3）では実画面のブラウザ確認は未実施。** 全棚卸しは静的コード読解（read-only）による。

- **理由**: Phase 3 の目的はコード棚卸しによる全 128 ルートの台帳化であり、dev server + seed 環境（local 5433 postgres、`careviax-e2e-local-db` 手順）を要する実機確認は Phase 5（重点監査）/ Phase 9（ビジュアル検証）で使用する計画のため、先行させなかった。実行時挙動（Responsive 実測・ダークテーマ・実 offline 遷移）はコードから断定できない旨を各 inv に明記済み。
- **代替証拠**（本フェーズで採用した実挙動の根拠）:
  - unit/契約テスト: 各ルートの `page.test.tsx` / `*-content.test.tsx` / `.shared.test`（inv 各表の Unit tested 列）、shell typography test-lock、`workbench-color-tokens.test.ts` 等。
  - E2E spec: `tools/tests/*.spec.ts`（ui-major-screens / ui-mobile-layout / ui-route-mocked-smoke / e2e-prescription-dispensing-flow ほか。inv 各表の E2E tested 列）。
  - ui-contract/ガード: `colors:check`（本調査で実行し pass 確認）、`frontend-contract:check`、`ui-visual-regression.spec.ts` の既存 snapshot、`design-screen-map.ts` のスクショ収集定義（ただし stale selector 3 件を検出済み — inv-02）。
- **Phase 9 スクリーンショット計画**: dev server + seed（`pnpm db:migrate`/`db:seed`、E2E local DB 手順）を立ち上げ、(1) 本書 §7 の優先候補画面から順に light/dark × mobile/desktop の 4 条件でキャプチャ、(2) `design-screen-map.ts` の capture 対象を修復（stale selector 3 件）した上で ui-design-fidelity を実走、(3) §3 で列挙した状態欠落（error/empty/offline）を route-mock で再現撮影し、コード棚卸しの記述と実画面の突合結果を台帳（UI_AUDIT_MATRIX の stale 記載修正含む）へ反映する。

---

## 7. Phase 5 監査対象の優先候補

患者安全 > 状態被覆欠落 > 逸脱密度の順で選定（根拠は各 inv の逸脱節）。

### P1: 患者安全に直結

1. **patients/[id]/safety-check** — CDS 中核なのに E2E ゼロ。4xx=空扱いの degraded 設計の妥当性検証（inv-05, J-07）。
2. **患者識別ヘッダの 3 流儀統一判断** — PatientHeader SSOT に対し使用 2 画面のみ。服薬/処方/訪問サブページの患者名常時表示なし＝取り違えリスク（inv-05/06/08）。
3. **admin/performance の false-zero 残存帯**（承認待ち/緊急影響が「0=問題なし」に見える偽 all-clear、inv-04）+ /views・patients/[id]/edit・select-mode の retry なしエラー逸脱（inv-05/07/10）。
4. **visits 配下の SSR 権限ゲート非対称** — capture のみ auth+scope+PHI 監査、brief/record/facility-packet/voice-memo は API 依存（未確認）（inv-08）。
5. **確認ダイアログの穴**: admin/users 停止・billing/candidates 状態遷移・jobs 再実行（CLAUDE.md 破壊的操作原則との突合、inv-02/03/04/09）。

### P2: 認証境界・状態被覆

6. **/dashboard-preview の edge 公開**（proxy prefix ギャップ）+ legal 2 画面の本文 TBD + destructive Alert の重大度誤用（inv-01）。
7. **platform 配下の loading/error 皆無**（break-glass という高リスク動線で root 依存、inv-02, J-15）。
8. **auth 系のテスト密度逆転**（mfa/first-login/password 系 unit ゼロ vs 静的 lockout に 6 件、inv-01）。
9. **offline UX の格差**（record フル対応 vs patients コア 0 件。共通語彙の横展開、inv-05/08）。

### P3: 逸脱密度・保守性

10. **エラー/空状態部品の 4 系統分裂**の使い分け基準明文化（ErrorState/SegmentError/DataTable/手組み、inv-03/04/09 ほか全バケット）。
11. **巨大 client component 群**: card-workspace 5,979 / pharmacy-cooperation 3,894 / prescription-intake-form 3,396 / schedule-proposals 3,499 / visit-record-form 3,112 / drug-master-content 2,506 行（inv-05〜08）。
12. **UI_AUDIT_MATRIX の stale 記載の一括更新**（dispense-audit-stats・visits/[id]・consent・qr-drafts・conflicts 等で実装済み事項が未反映、inv-04/05/06/08）+ E2E stale selector 3 件（inv-02）。
13. **重複実装の統合候補**: 印刷 3 ルートのフェッチ+auto-print、パスワード強度/6桁入力×3、KPI カード×4、select-mode/site カード、loading.tsx コピペ群（inv-01/04/06/09/10）。
