# Phase3 — SSOT Discovery（デザイン関連資産の3分類棚卸し）

調査日: 2026-07-11 / 起点: `docs/ui-ux-refresh/phase0/06-design-system.md`
読み取り専用調査。件数は grep/glob 実測（`.test.` 除外、対象 `src/**/*.{ts,tsx,css}`）。本段階では SSOT を変更しない。

---

## 1. Normative SSOT（規範文書）

### 1.1 正本と文書体系

| 文書 | 位置づけ | 根拠 |
| --- | --- | --- |
| `docs/ui-ux-design-guidelines.md`（1223行） | **唯一の規範 SSOT**。§1.1 で「規範（SSOT）は本書のみ」と宣言。§1〜§12: 位置づけ/設計原則/トークン/IA/操作性/状態設計/コンポーネント規範/a11y/AWS起因UX/状態色確定表/禁止事項/変更履歴 | 同ファイル L8-29（§1.1-1.3）。章構成の全量は phase0 `06-design-system.md` §4 |
| `docs/state-color-migration-map.md` | **リダイレクトスタブ**。2026-07-02 に guidelines §10 へ全量統合。「規範を追記しないこと」明記 | 同ファイル冒頭 L1-8 |
| `docs/uiux-design-system.md` | **リダイレクトスタブ**（同日統合、v2 で §3〜7 へ分散） | 同ファイル冒頭 |
| `docs/decisions.md`（31行） | 設計判断**索引**（D-01〜D-15）。UI 固有の規範はなし。テーブルの正本は `Plans.md`「設計判断」節と自己申告 | 同ファイル L4 |
| `CLAUDE.md`「UI Design: 医療システムデザイン方針」節 | プロジェクト指示。ただし一部は**旧規則**（下記 1.3） | CLAUDE.md |

規範側が指名する「実装の正本」: 状態色ロール = `src/lib/constants/status-labels.ts` の `*_ROLE` 定数、トークン実体 = `src/app/globals.css`（guidelines §1.1）。

### 1.2 非規範（作業文書）— guidelines §1.1 が明示列挙、衝突時は guidelines 優先

- `docs/color-token-remediation-plan.md` — 是正フェーズ台帳
- `docs/design-fidelity-mapping.md` / `docs/design-gap-analysis*.md`（+.json） — デザイン画像対応表
- `docs/uiux-audit.md` / `docs/uiux-improvement-plan.md` — 監査・計画
- `docs/frontend-brushup-plan.md`（RUN-20260702-FEBRUSH、全画面準拠引き上げ計画）
- `docs/frontend-screen-contracts.md` — FRONTEND-CONTRACT-001 の契約ゲート（`frontend-contract:check` の入力。「Active FE implementation SSOT」と自称）
- `docs/research/medical-uiux-research-2026-06-26.md`、`.agent-loop/UI_AUDIT_MATRIX.md` 等

### 1.3 古い / 重複 / 相互矛盾の具体列挙

1. **CLAUDE.md 旧状態色規則 vs 6軸トークン（矛盾・コード側で明示的に不採用）**
   - CLAUDE.md:「患者状態（稼働中=緑、保留=橙、終了=灰）、ワークフロー状態（待ち=青、進行中=緑、差戻し=赤、完了=灰）、優先度（緊急=赤、高=橙、中=青、低=灰）」
   - 実装/guidelines §3.1 は 6軸（blocked赤/done緑/confirm橙/waiting**紫**/readonly灰 + tag-hazard橙/tag-info青）。`src/lib/constants/status-labels.ts:13` に「CLAUDE.md 旧規則(患者: 稼働中=緑/保留=橙/終了=灰)は不採用」、実際 `CASE_STATUS_ROLE.active = 'neutral'`（L173-180）、「待ち」= waiting 紫（青ではない）。
2. **CLAUDE.md「警告色は赤/橙/黄の3段階のみ」 vs 実体 7 トークン**（waiting=紫、tag-info=青を含む）。guidelines §3.1/§7.5（アラート4段階: critical/warning/status/reminder — `src/components/ui/alert-tier.tsx`）が正。
3. **CLAUDE.md「shadcn/ui」記述 vs 実体は @base-ui/react**。primitive は `@base-ui/react` 1.5.0 で `@radix-ui/*` import は 0 件（phase0 06 §2、`src/app/shadcn-tailwind.css:1-4` は vendored CSS）。「shadcn/ui (latest)」表記は実態と乖離。
4. **二重間接**: メモリ/旧文書が指す「状態色台帳 = docs/state-color-migration-map.md」は現在ポインタのみ → 実体は guidelines §10 + `status-labels.ts`。旧参照経由の読者は 1 hop 増える。
5. **`docs/color-token-remediation-plan.md` の Status が stale の疑い**: 冒頭で「Phase 3b **実装中**（残留識別色 2 群: intake-lane 新 family + safety-board handling tones）」とあるが、`globals.css` には `--intake-lane-fax/online/walk-in` が既に定義済み（L152-184 帯、phase0 06 §1.2）で、`colors:check` は現在 0 drift で pass（実行確認、下記 2.4）。完了反映漏れの可能性（完了時期は未確認）。
6. **「SSOT」自称の多重化**: guidelines（規範SSOT）のほか、`design-fidelity-mapping.md`（進捗SSOT自称、最終更新 2026-06-17）、`frontend-screen-contracts.md`（FE contract SSOT自称）、`docs/decisions.md`（正本は Plans.md と自己申告）。役割は異なるが「SSOT」語の乱立で優先順位が文書名から判別できない。
7. **guidelines §7.3「状態は StateBadge/StatusDot のみ。ローカル statusVariant 経由禁止」 vs 旧 `*_VARIANTS` の温存**: `status-labels.ts:26-36` に `CASE_STATUS_VARIANTS` 等（Badge variant ベースの旧方式）が「消費者の移行が完了するまで温存」コメント付きで残存。非テスト消費ファイルは残り 2 件（例: `src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx`）。

---

## 2. Executable SSOT（コードとして強制される正）

### 2.1 トークン実体 — `src/app/globals.css`（468行）

- CSS-first Tailwind v4（`tailwind.config.*` 無し）。`@theme inline` でトークン公開（L7-88）。
- `--primary: oklch(0.38 0.09 252)` 深ネイビー（L102-103）、`--radius: 0.375rem`（L187）。
- 6軸状態色 `--state-blocked/done/confirm/waiting/readonly` + `--tag-hazard/info`（L133-140、dark 再定義 L224-231）。
- 慣習色 `--weekend-*`（L142-150）、識別トークン 23 種（route/intervention/role/time-slot/method/soap/intake-lane、L152-184、大面積塗り禁止コメント）。
- グローバル規範実装: 本文 14px/行間1.6（L277-281）、prefers-reduced-motion 全停止（L346-370）、**44px タッチターゲット media query 強制**（L372-394）、A4 印刷契約（L396-468）。

### 2.2 状態色・ラベルの実装正本

- `src/lib/constants/status-tokens.ts` — `StatusRole` union（`'blocked'|'done'|'confirm'|'waiting'|'readonly'|'hazard'|'info'`、L4-6）+ `STATUS_TOKENS`（role→label/lucide icon/badge/dot/accent クラス。色単独依存禁止を型と icon 必須で encode）。
- `src/lib/constants/status-labels.ts`（493行） — **26 個の `*_ROLE` 定数**（CASE/SCHEDULE/PRIORITY/REPORT/OFFLINE_SYNC/…/USER_ACCOUNT、L173-486）。`StatusRoleOrNeutral = StatusRole | 'neutral'`（L15）。`OFFLINE_SYNC_STATUS_ROLE` 等は `as const satisfies Record<...>` で型固定（L303-310）。
- `src/components/ui/state-badge.tsx` — `role: StatusRole` を必須 prop とする（L7）discriminated 消費点。`status-dot.tsx` も同様。

### 2.3 Button / タイポ契約

- `src/components/ui/button-variants.ts`（49行） — 全 size `min-h-[44px]` + `sm:` compact、variant 6種。「'use client' を付けない」build 制約コメント（phase0 06 §2 Button contract）。
- `src/components/layout/shared-shell-typography.test.ts` — 共有シェル 12 ファイル（app-header/sidebar/mobile-nav/patient-header/workflow-page-header 等）のタイポをファイル読取で test-lock。

### 2.4 ガードスクリプト（package.json:98-101）

| ガード | 実体 | 実測 |
| --- | --- | --- |
| `colors:check` | `tools/scripts/check-raw-state-colors.mjs`（FEUX-6、生 Tailwind 状態色禁止 + ratchet allowlist） | 本調査で実行: **pass、allowlist 19行/3ファイル、0 drift**（`soap-options.ts` 12 / `presence-contract.ts` 4 / `search/result-builders.ts` 3 — `tools/raw-state-color-allowlist.json`） |
| `boundaries:check` | `tools/scripts/check-module-boundaries.mjs` | モジュール境界 + ratchet |
| `frontend-contract:check` | `tools/scripts/check-frontend-contract.mjs` | `docs/frontend-screen-contracts.md` の screen ID/state matrix 語彙を ratchet 検証 |

### 2.5 テスト / 閾値

- UI 契約テスト: `data-table-export-policy.test.ts`（PHI export 遮断）、`alert-tier.test.tsx`、`expiry-badge.test.tsx`、`confirm-dialog.test.tsx` 等 `src/components/ui/*.test.tsx` 多数 + 上記 shell typography。
- E2E: `tools/tests/ui-design-fidelity.spec.ts` / `ui-visual-regression.spec.ts`（snapshot 付き）/ axe は `ui-audit-extensions.spec.ts`・`ui-route-mocked-smoke.spec.ts`。
- カバレッジ閾値: `vitest.config.ts:20-25` — statements 80 / branches 66 / lines 80 / functions 75（branches はコメント付き引き上げ前提 baseline）。

---

## 3. De facto SSOT（文書化の薄い事実上の標準 — 使用ファイル数実測）

page.tsx は 128 枚（`src/app` 配下 find 実測）。非テスト参照ファイル数:

| パターン | 件数 | 事実上の地位 |
| --- | --- | --- |
| `PageScaffold` | **159** | 全画面レイアウトの事実上標準（page 数 128 を超える普及。guidelines §7.1 に1行言及のみで規範記述は薄い） |
| `Skeleton`（loading.tsx） | 140 | ローディングの標準 |
| `ErrorState` | 84（`variant="server"` 122箇所 / `network` 1） | 画面内エラーの標準。**variant はほぼ server 一択**が実態 |
| `StateBadge` | 58 | 状態表示標準（`StatusDot` は 6 と少数） |
| `DataTable` | 45 | 一覧の標準。**`ui/table` 直 import は 0 件** = テーブルは DataTable 経由が事実上強制 |
| `AdminPageHeader` | 37 / `WorkflowPageIntro` 25 / `WorkflowPageHeader` 18 | ヘッダ3種（§4.4）。admin 系のコピー元は AdminPageHeader 画面群 |
| `EmptyState` 30 / `ConfirmDialog` 30 / `PageSection` 27 / `ActionRail` 22 / `FormErrorSummary` 18 / `StatCard` 14 / `LoadingButton` 13 / `HelpPopover` 12 | — | 定着済み共通部品 |
| base 部品直 import | Button 181 / Badge 111 / Card 87 / Select 55 | ベースレイヤ |
| lucide-react | 204 ファイル | 唯一のアイコンソース |

**エラー表現の事実上の第一選択は toast（sonner）**: `toast.*` 呼び出し 601 箇所 / import 153 ファイル。次点で ErrorState（84）、shadcn `<Alert>`（28）、DataTable 内蔵 errorMessage/onRetry。guidelines §6.3 は文言規範中心で「toast vs ErrorState の使い分け」の明文規範は薄い（未確認: §6.3 全文の使い分け記述有無は本調査では見出しレベルのみ確認）。

---

## 4. 逸脱の定量化

### 4.1 生 hex / 任意色

- 生 hex（6桁）: **src 全体 152 行 / 10 ファイル**。内訳: `dispensing-workbench.module.css` **85**（レセコン風 1540px 固定は §3.1 末尾で認可だが色はトークン化されていない）/ PDF サーバ系 38（`pdf-documents.tsx` 17 + `pdf-pharmacy-invoice.tsx` 13 + `pdf-pharmacy-contract-document.tsx` 8。React-PDF で CSS 変数不可の事情あり、規範対象かは guidelines に未定義）/ `src/phos/contracts/phos_design_tokens.ts` 15（**レガシー phos 島**、独自 SeverityToken を hex 定義）/ `visit-route-map.tsx` 8（地図）/ schedules 2画面 3 / `use-workbench-view.ts` 1 / `globals.css` 2（1 はコメント、1 は print 用 `#f0f0f0`:431）。
- 任意色 Tailwind クラス（`bg-[#…]` 等）: **0 件**。
- `colors:check` allowlist: 3 ファイル 19 行（ratchet、§2.4）— 生 Tailwind **状態色**はこれが全残存。

### 4.2 マジックナンバー

- `min-h-[44px]` 直書き **458 箇所**（globals.css L372-394 のグローバル強制 + Button contract と三重化。bare なものは redundant 候補 — ただし `sm:h-11`/`sm:min-h-[44px]`/`!h-11` 系 232 箇所は意図的 desktop 44px 保全で test-locked、無差別削除禁止）。
- `z-[…]` 任意 z-index 3 箇所、`1540` 3 箇所（workbench、文書化済み）。

### 4.3 複製コンポーネント / ローカル再実装

- ローカル `MetricCard`/`KpiCard` 実装 4 件: `admin/metrics/metrics-dashboard-content.tsx:75`、`admin/performance/page.tsx:205`、`workflow/workflow-dashboard-view.tsx:1522`、`admin/analytics/analytics-content.tsx:571` — §7.2「StatCard へ統合対象・新規追加禁止」に対する残存。
- dispense-workbench にローカル statusColor 系 3 ファイル（`patient-list-panel.tsx` / `dispensing-workbench.types.ts` / `use-workbench-view.ts`）。
- 旧 `*_VARIANTS` 消費 2 ファイル残（§1.3-7）。

### 4.4 状態色の塗り方逸脱（§3.2 全面塗り最小化）

- 全彩度 `bg-state-*`（/opacity なし）**76 箇所**。うち `bg-state-done text-white` のボタン/セル 6 箇所（`handoff-workspace.tsx:889`、`schedule-team-board.tsx:292`、`proposal-human-decision-flow.tsx:26`、`requests-content.tsx:400`、`visit-card-mobile.tsx:279`、`facility-visit-record-switcher.tsx:220`）— 「主操作=primary、状態色で塗らない」（§5.1/§3.2）との整合は要判定。password strength meter（`(auth)/password/*`）はスケール用途。

### 4.5 ラベルの分散・揺れ

- `*_LABELS` 定義が `src/lib/constants` **外に 113 ファイル**（API route 内 7 件超含む）。
- 同一 enum 値 `draft` の「下書き」ラベルが 7 ファイルで重複定義（`api/care-reports/today-workspace/route.ts:278` ほか）。
- **同じ状態への異なるラベル**: `completed:` の値ラベルは「完了」11 /「訪問完了」3 /「訪問済」1 /「整備完了」1 と揺れ。
- **同じ値の異なる意味（文書化済みの意図的差）**: `discharged` = CASE では readonly（終了）、PATIENT_STATUS_ICON では confirm（退院直後フォロー要）— `status-labels.ts:326-341` コメントで根拠明記。

### 4.6 アイコンの意味揺れ（lucide、import 数上位）

| アイコン | 件数 | 意味/揺れ |
| --- | --- | --- |
| AlertTriangle | 43 | 警告/confirm。**同一グリフの別名 TriangleAlert（5、`status-tokens.ts` の confirm 正本側）と分裂** |
| CheckCircle2 | 38 ファイル | 完了/成功。**同一グリフ CircleCheck（4、done 正本側）と分裂** |
| AlertCircle | 10 | フォーム/認証エラー — AlertTriangle と意味領域が重複（error vs warning の使い分けは非明文） |
| Clock | 11 | **2義**: waiting role 正本（status-tokens）と単なる時刻表示（`visit-record-detail.tsx:1253` 等） |
| Eye | 8 | **3義**: readonly role 正本 / パスワード表示切替（auth 4画面）/ SOAP-O アイコン（`visit-record-form.tsx:2606`） |
| ShieldAlert | 9 | hazard tag 正本 + 一般的安全警告 |
| Info | 9 | info tag 正本と一般情報表示（整合的） |
| Plus 13 / ChevronRight 12 / FileText 11 / Trash2 9 / RefreshCw 9 | — | 新規作成/ナビ/文書/削除/再試行 — 揺れなし |

guidelines §3.10（アイコノグラフィ）はあるが、**role 正本アイコン（Ban/CircleCheck/TriangleAlert/Clock/Eye/ShieldAlert/Info）を role 以外の意味で使うことの可否は非明文**。特に Eye/Clock は状態色文脈と非状態文脈が混在。

### 4.7 文書とコードの乖離まとめ

- §7.1 の実在/計画部品表は実態と一致（Tooltip/OtpInput/PasswordStrengthField 未実在を確認、`SafetyTagBadge`/`FilterChipBar` 実在確認）— **正確**。
- 乖離: §1.3 CLAUDE.md 旧色規則（不採用明記済みだが CLAUDE.md 本文は未修正）、shadcn/ui 表記 vs @base-ui/react、color-token-remediation-plan の Status stale 疑い、§7.3 vs `*_VARIANTS` 残存、§7.2 vs ローカル MetricCard 4 件、§3.2 vs 全彩度塗り 76 箇所。

---

## 未確認事項

- guidelines §6.3 本文中の toast/ErrorState 使い分け規範の有無（見出しレベルのみ確認）。
- `color-token-remediation-plan.md` Phase 3b の実完了時期（globals.css に intake-lane トークン実在から完了と推定、コミット履歴未追跡）。
- PDF サーバ系 hex の規範上の扱い（guidelines に印刷/PDF の色規範なし）。
- 全彩度 `bg-state-*` 76 箇所のうち正当（dot/meter/progress）と逸脱の完全な仕分け（本調査は代表例のみ特定）。
