# Phase0 Recon 06 — デザインシステム / スタイリング基盤

調査日: 2026-07-11 / 調査者: Phase0 recon agent

事実のみ記録。根拠は file path (:line) を付す。バージョンは package.json / pnpm-lock.yaml の実値。

---

## 1. スタイリング方式

### 1.1 Tailwind CSS v4（CSS-first config）

- `tailwindcss` **4.3.0**（lockfile 実値 `pnpm-lock.yaml` importers、`package.json` devDependencies `^4.3.0`）。
- `@tailwindcss/postcss` 経由でビルド（`postcss.config.mjs` — plugins に `@tailwindcss/postcss` のみ）。
- **`tailwind.config.{js,ts,mjs}` は存在しない**（リポジトリルートに無し。CSS-first 構成）。
- エントリは `src/app/globals.css:1-3`:
  - `@import 'tailwindcss';`
  - `@import 'tw-animate-css';`（`tw-animate-css` 1.4.0）
  - `@import './shadcn-tailwind.css';`（shadcn の keyframes 等を vendored — `src/app/shadcn-tailwind.css:1-4` に「Vendored from shadcn/dist/tailwind.css so the app does not need the shadcn CLI package at runtime」と明記）
- ダークモード: `@custom-variant dark (&:is(.dark *));`（`globals.css:5`）+ `next-themes` 0.4.6（package.json）。
- トークン公開は `@theme inline { --color-* : var(--*) }` 方式（`globals.css:7-88`）。
- 補助: `class-variance-authority` 0.7.1（cva）、`tailwind-merge` 3.6.0 + `clsx` 2.1.1（`cn()`）。
- CSS Modules はワークベンチ 1 箇所のみ: `src/components/features/dispense-workbench/dispensing-workbench.module.css`。

### 1.2 globals.css のトークン定義（主要なもの）

`src/app/globals.css` に light（`:root`, L91-198）/ dark（`.dark`, L200-271）の 2 セットを oklch で定義。

**ベース（shadcn 系）**:

- `--primary: oklch(0.38 0.09 252)` — 深ネイビー（レセコン #1f4e79 相当のコメント付き, L102-103）
- `--background` / `--foreground` / `--card` / `--popover` / `--secondary`（blue-grey）/ `--muted` / `--accent` / `--destructive` / `--border` / `--input` / `--ring`（L93-124）
- `--chart-1..5`（L127-131、医療データ可視化用。状態色の流用禁止は guidelines §3.1）
- `--radius: 0.375rem`（L187、「subtle, professional」）→ `@theme` で `--radius-sm..4xl` を係数展開（L81-87）
- `--sidebar-*` 一式 — dark navy sidebar（L190-197）

**状態色（6軸セマンティック、p0_46 SSOT、L133-140）**:

- state 5: `--state-blocked`(赤) / `--state-done`(緑) / `--state-confirm`(橙) / `--state-waiting`(紫) / `--state-readonly`(灰)
- tag 2: `--tag-hazard`(橙・危険タグ) / `--tag-info`(青・情報タグ)
- コメントに「AA >=4.5:1 as text on card surface」。dark 側は明インク版を再定義（L224-231）。

**慣習色**: `--weekend-sun` / `--weekend-sat` / `--weekend-holiday`（L142-150、状態色より低彩度、AA 実測値コメント付き）。

**識別トークン（カテゴリ識別、状態色ではない — L152-184）**:
`--route-internal/external/injection`、`--intervention-*`(6種)、`--role-patient/clerk/institution`、`--time-slot-morning/noon/evening/bedtime`、`--method-standard/unit-dose/crushed`、`--soap-s/o/a/p`、`--intake-lane-fax/online/walk-in`。全て低彩度・text/border/dot/小チップのみ・大面積塗り禁止（AA 証明は `docs/color-token-remediation-plan.md` §Phase2 参照とコメント）。

**その他のグローバル規範実装（globals.css）**:

- 本文 `font-size: 14px; line-height: 1.6`（`@layer base` L277-281）
- `prefers-reduced-motion: reduce` で全 animation/transition を 0.01ms 化（L346-370、SSOT 3.5。Radix presence のイベント発火を保つ設計コメント付き）
- **44px タッチターゲットのグローバル強制**: `@media (hover: none) and (pointer: coarse), (max-width: 767px)` で `a[href]/button/input/select/textarea/[role='button']` に `min-block-size/min-inline-size: 44px !important` + `touch-action: manipulation`（L372-394）
- `@media print` A4 印刷スタイル（L396-468、`data-print-skip` / `.print-page-break-*` 契約）

### 1.3 state color 実装の SSOT

- **`src/lib/constants/status-tokens.ts`** — `StatusRole = 'blocked'|'done'|'confirm'|'waiting'|'readonly'|'hazard'|'info'`（L4-6）。`STATUS_TOKENS` が role ごとに `label`（日本語）/ `icon`（lucide）/ `badgeClassName`（`bg-state-*/15 + ring`）/ `dotClassName`（全彩度塗り）/ `accentClassName`（`border-l-state-*` 左ボーダー）を持つ（L24-）。「色だけに依存しない」ためアイコン+テキスト併用がコンポーネント側で強制される。
- family×value→role の割当実装の正本は `src/lib/constants/status-labels.ts` の `*_ROLE` 定数（`docs/state-color-migration-map.md` 冒頭に明記）。

---

## 2. shadcn/ui コンポーネント一覧（src/components/ui 配下）

全ファイル（.test 除く実装 39 ファイル）:

**shadcn 標準（ほぼ素のまま）**: `alert-dialog.tsx` / `alert.tsx` / `badge.tsx` / `button.tsx`(+`button-variants.ts`) / `card.tsx` / `checkbox.tsx` / `dialog.tsx` / `dropdown-menu.tsx` / `input.tsx` / `label.tsx` / `select.tsx` / `separator.tsx` / `sheet.tsx` / `sonner.tsx`(toast) / `switch.tsx` / `table.tsx` / `tabs.tsx` / `textarea.tsx`。
※ primitive は **Radix ではなく `@base-ui/react` 1.5.0**（lockfile 実値）。`src/components/ui/` の dialog/sheet/alert-dialog/select/tabs/button 等が `@base-ui/react/*` から import しており、`@radix-ui/*` の import は 0 件（grep 確認）。

**独自拡張・自作（1行役割）**:

| ファイル | 役割 |
| --- | --- |
| `state-badge.tsx` | `StateBadge` — 6軸 role を受け中央トークンで tinted badge + アイコン + テキストを描く semantic status badge（色単独禁止を encode） |
| `status-dot.tsx` | `StatusDot` — 全彩度トークン色ドット + 必ずラベル（可視 or sr-only）のコンパクト状態表示 |
| `state-elements.tsx` | `StateActionButton` / `StateHeading` — 状態画面用のアクション/見出し部品 |
| `confirm-dialog.tsx` | `ConfirmDialog` — 破壊的操作の確認。`confirmationText`（正確な文字入力必須）による二重確認対応。autoFocusConfirm は F12→Enter 運用の意図設計 |
| `conflict-diff-dialog.tsx` | `ConflictDiffDialog` — 楽観ロック競合時に項目単位の差分（自分/相手）を見せて解決させるダイアログ |
| `expiry-badge.tsx` | `ExpiryBadge` — 期限バッジ。30日以内=blocked(赤)の下限 floor は緩和不可（SSOT 7.3/1.3 をコードコメントで強制） |
| `sync-state-badge.tsx` | `SyncStateBadge` — オフライン同期の行内状態（SSOT 6.6 / 確定表 OFFLINE_SYNC_STATUS_ROLE） |
| `data-table.tsx` | `DataTable` — zebra/sticky/エラー内蔵（errorMessage/onRetry）の医療データテーブル。client CSV export は「PHI なし」明示 acknowledgement 必須、PHI は serverExport 経由（`data-table-export-policy.test.ts` で担保） |
| `alert-tier.tsx` | `AlertTier` — 医療アラート4段階（critical/warning/status/reminder）を見た目+ARIA で分離（guidelines §7.5 の実装） |
| `signal-tile.tsx` | `SignalTile` — 重大度タイル。呼び出し側が値×閾値で都度算出（カテゴリ固定常時点灯= alert fatigue 防止） |
| `patient-pinned-header.tsx` | 患者ピン留めヘッダ（アレルギー/麻薬等の安全タグ表示） |
| `phi-mask-field.tsx` | `PhiMaskField` — PHI 項目のマスク表示/開示 |
| `empty-state.tsx` / `error-state.tsx` | 空状態 / エラー状態（§6.3「原因+次の行動」cause/nextAction 構造化 props） |
| `loading.tsx` / `loading-button.tsx` | Skeleton/SkeletonRows/Loading、送信中ボタン |
| `segment-state.tsx` | セグメント単位の loading/retry（`SegmentRetryButton`/`SegmentLoading`、route sanitize 付き） |
| `form-error-summary.tsx` | フォームエラーサマリ（フォーカス移動用 forwardRef） |
| `action-rail.tsx` | `ActionRail` — アクション列の整列コンテナ（align 制御） |
| `sticky-footer-action.tsx` | 保存・確定等を右寄せで固定するフッタアクション |
| `filter-summary-bar.tsx` | 適用中フィルタの要約バー |
| `help-popover.tsx` | `HelpPopover` — ページ説明の折りたたみ（WorkflowPageHeader の description 格納先） |
| `section-intro.tsx` / `stat-card.tsx` | セクション導入文 / 指標カード |
| `day-navigator.tsx` / `month-grid.tsx` | 日送りナビ / 月グリッド汎用プリミティブ（`renderDay` 注入式、`docs/shared-month-grid-plan.md` 参照） |
| `segmented-progress-bar.tsx` | 分節プログレスバー |
| `error-boundary.tsx` / `route-error-boundary.tsx` | エラーバウンダリ（route 版は「raw Error は PHI を運びうる」ため coded context のみ telemetry 送信） |

**レイアウト部品（src/components/layout/）**: `page-scaffold.tsx`（`PageScaffold` — ページ直下の子を card/bare variant で統一整形するスタック）、`app-shell.tsx` / `sidebar.tsx` / `app-header.tsx` / `mobile-nav.tsx` / `page-section.tsx` / `network-status-banner.tsx` / `route-progress.tsx` / `navigation-config.ts` / `shared-shell-typography.test.ts`。

**feature 側の共通ヘッダ**:

- `WorkflowPageHeader` — `src/components/features/workflow/workflow-page-header.tsx:28`。ワークフロー画面共通ヘッダ。「先頭のみ primary（主操作は1画面1つ）、以降は outline」を props 契約で強制（L18 コメント）。description は HelpPopover 行き（既定非表示）。
- `PatientHeader` — `src/components/features/patients/patient-header.tsx:167`。全画面共通の患者識別 SSOT ヘッダ（tier 自動非表示で reports/safety-check でも再利用）。

### Button variant contract（44px タッチターゲットの encode）

`src/components/ui/button-variants.ts`:

- 全 size に `min-h-[44px]`（モバイル/coarse 既定）+ `sm:h-8|h-7|h-6|h-9 sm:min-h-0`（デスクトップ compact）。icon 系は `size-11 sm:size-8` 等。
- variant 6種: default(primary塗り) / outline / secondary / ghost / destructive(淡赤面+destructive文字) / link。
- ファイル冒頭コメント: **'use client' を付けない**（server component が module スコープで `buttonVariants()` を呼ぶため cva を button.tsx から分離。付けると `pnpm build` が落ちる）。
- globals.css L372-394 のグローバル 44px 強制と二重化（defense in depth）。`sm:h-11` / `sm:min-h-[44px]` / `!h-11` はデスクトップでも 44px を保つ意図的医療タッチターゲット（institutions test-locked、memory 記録）。

---

## 3. アイコン / フォント

- **アイコン**: `lucide-react` **1.17.0**（lockfile 実値）。UI 全域で使用（例: `status-tokens.ts:2` の Ban/CircleCheck/TriangleAlert/Clock/Eye/ShieldAlert/Info）。他のアイコンライブラリは dependencies に無い。
- **フォント**: `src/app/layout.tsx:2-16` — `next/font/google` で `Noto_Sans_JP`（weight 400/500/700、CSS 変数 `--font-noto-jp`）と `Geist_Mono`（`--font-geist-mono`）をロード。実際のスタックは `globals.css:10-12` の `--font-sans: Meiryo, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', ..., var(--font-noto-jp), system-ui, sans-serif`（**Meiryo 先頭 → Noto Sans JP → system-ui** の段階フォールバック。guidelines §3.4 と一致）。`--font-heading: var(--font-sans)`、mono は Geist Mono。
- E2E では `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` で Google Fonts をモック（package.json scripts `dev:e2e:local` 等）。

---

## 4. docs/ui-ux-design-guidelines.md（SSOT、1223 行）の章構成

| § | 見出し | 規範の要点 |
| --- | --- | --- |
| 1 | 文書の位置づけ | SSOT 宣言・運用ルール・改版規律（数値規範の緩和不可 floor 等） |
| 2 | 設計原則 | 医療安全ファースト(SAFER)/患者誤認防止/Clinical Workbench Language/認知負荷最小/Backend-supported UI Safety Contracts/実装前チェック/FE-BE 連動（片翼実装禁止） |
| 3 | デザイントークン | 3.1 6軸状態色（実体は state5+tag2+neutral、L184 に明記）/ 3.2 状態色の塗り面積最小化（左ボーダー+ラベルのみ、全面塗り禁止）/ 3.3 識別トークン登録簿 / 3.4 タイポグラフィ（本文14px+、最小 text-xs、行間1.6）/ 3.5 8pt グリッド / 3.6 角丸 / 3.7 モーションと prefers-reduced-motion / 3.8 等幅数字 / 3.9 CVD 検証ゲート / 3.10 アイコノグラフィ |
| 4 | 情報アーキテクチャ | 情報重力ゾーン(Pinned/Primary/Scroll)/Z軸/画面タイプ別レイアウト/ナビシェル/trunk test/レスポンシブ(mobile390/tablet768/desktop1440/wide1920)/Thumb zone/正本・差分表示/配置監査確定事項 |
| 5 | 操作性 | ボタン5階層/配置規範/ラベル・タッチターゲット/フォーム設計/キーボード完結/confirm と undo の使い分け/モーダル規則/未保存離脱ガード(FEUX-8) |
| 6 | 状態設計 | 5状態分離(binding)/ローディング規範/エラー文言（原因+次の行動）/空状態/stale 表示/オフライン劣化モード |
| 7 | コンポーネント規範 | 実在部品と計画部品/メトリクスカード binding(FEUX-2)/バッジ設計(StateBadge/StatusDot/ExpiryBadge/SafetyTagBadge)/DataTable/アラート4段階/カード/SOAP トークン契約(FEUX-4)/薬剤名・用量・日付の安全表示/画面遷移の視覚的安定性 |
| 8 | アクセシビリティ | WCAG 2.2 準拠・44px ターゲット(2.5.8)/フォーカス/ドラッグ代替(2.5.7)/Redundant Entry/Accessible Auth(3.3.8)/コントラスト/ライブリージョン/支援技術/グローブ・屋外操作 |
| 9 | AWS 運用起因の UX 規範 | Amplify ストリーミング/CloudFront キャッシュ/Cognito 再認証 UX/S3 進捗・再試行/リージョン障害 degradation/Core Web Vitals 目標+RUM/レンダリング最適化 |
| 10 | 状態色 family×value×role 確定表 | 旧 state-color-migration-map.md を全量統合。CASE_STATUS_ROLE 〜 USER_ACCOUNT_STATUS_ROLE まで約 28 family の enum→role 割当表（実装正本は `status-labels.ts`） |
| 11 | 禁止事項（統合リスト） | — |
| 12 | 変更履歴・経緯 | — |

### docs/state-color-migration-map.md

現在は**ポインタのみ**: 「MOVED (2026-07-02): …guidelines の『状態色 family×value×role 確定表』章へ全量統合。実装の正本は `src/lib/constants/status-labels.ts` の `*_ROLE` 定数。本ファイルは旧参照互換のためのポインタで規範を追記しないこと」（ファイル冒頭）。

---

## 5. デザイン系ガードスクリプト（package.json scripts）

| script | 実体 | 仕組み |
| --- | --- | --- |
| `colors:check` | `tools/scripts/check-raw-state-colors.mjs`（148行） | FEUX-6。src 配下の .ts/.tsx（.test/.spec/.stories 除外）で、状態系 family（red/orange/amber/yellow/green/emerald/lime/rose × shade 50-950 × text/bg/border/ring/fill/... 全 prefix）の**生 Tailwind 状態色を禁止**。例外は `tools/raw-state-color-allowlist.json` にファイル単位で classification（clinical_scale/status_enum/presence_identity/search_category）+ reason + **expectedCount** を登録する ratchet 方式（増加も stale entry も両方 fail）。現 allowlist は 3 件のみ: `soap-options.ts`(12) / `presence-contract.ts`(4) / `search/result-builders.ts`(3)。sky/blue/violet/slate 等の中立色は対象外 |
| `boundaries:check` | `tools/scripts/check-module-boundaries.mjs` | **モジュール境界チェックは実在**（W0-3 / MOD-BOUND-001）。共通コア→薬局固有 import の方向違反 + backend module graph（`src/core`, `src/modules/*`）の禁止依存を、JSON allowlist（`tools/module-boundary-allowlist.json`）+ 期待件数 ratchet で検出 |
| `frontend-contract:check` | `tools/scripts/check-frontend-contract.mjs` | FRONTEND-CONTRACT-001。`docs/frontend-screen-contracts.md` に必須 screen ID・state matrix 語彙・high-risk stop boundary が揃っていることを ratchet 検証（docs-first 契約のゲート） |

（想定スタックとの照合: 「モジュール境界チェック」は上記のとおり**実在**。デザイン領域では想定との不一致なし。）

補助: a11y は `@axe-core/playwright` ^4.11.3（devDependencies）で E2E 側から検証。

---

## 6. Storybook

**不採用**。`.storybook/` ディレクトリ無し、package.json に storybook 系依存無し。ガードスクリプトの SKIPPED_SUFFIXES に `.stories.tsx` が列挙されている（`check-raw-state-colors.mjs:24` 等）が、これは将来対応の防御的除外であり、`*.stories.tsx` ファイルの実在は未確認（依存が無いため実行基盤は無い）。

---

## 7. タイポグラフィ / 密度 / 44px 規約の実装方式まとめ

- **タイポ**: guidelines §3.4（本文14px+/ラベル12px+/最小 text-xs/行間1.6/読み物16px推奨）→ 実装は `globals.css` `@layer base` の body 14px・line-height 1.6 + role 単位スケール規範（display/title/section/body/label/caption）。shell 側は `shared-shell-typography.test.ts` でテスト固定。
- **密度**: 一覧=データ密度重視（DataTable の zebra + sticky header）、入力=1カラムゆとり。レセコン風高密度（F1-F12帯/1540px固定幅）は調剤ワークベンチ限定（§3.1 末尾）。
- **44px**: 三層 — ① globals.css のグローバル media query 強制（L372-394）② Button variant contract（`min-h-[44px]` + `sm:` compact、`button-variants.ts`）③ guidelines §8.2（WCAG 2.2 2.5.8 準拠規範）。E2E/a11y テストで一部 test-lock（institutions 等、memory 記録）。

## 未確認事項

- `*.stories.tsx` の実在有無（依存が無いため機能しないことは確実）。
- lucide-react の正確な使用ファイル数（多数であることのみ確認）。
