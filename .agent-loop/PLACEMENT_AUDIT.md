# 全画面コンポーネント配置監査 — 統合バックログ (Claude→Codex 支援成果物)

- 作成: 2026-06-21 / 監査主体: Claude (design-analyst ×5, read-only) / 実装ドライバ: Codex
- 基準: `docs/ui-ux-design-guidelines.md` (SSOT)
- 範囲: `src/app/(dashboard)/**` 110 画面。保護対象 `/dispense` `/set` `/set-audit` `/audit` は配置変更対象外。
- 全 finding は file:line 証拠つき。**着手順は SYS(横断) → HIGH → MED**。SYS は1箇所修正で多画面に波及するため最優先。

---

## SYS — 横断的逸脱 (1コンポーネント/1パターン修正で多画面解決。最優先)

### SYS-1 [High] CardTitle が非 heading で見出し階層が断絶
- 証拠: `src/components/ui/card.tsx:37` — `CardTitle` が `<div data-slot="card-title">`。各 admin 画面のグループ見出しに使用 (institutions/users/jobs/metrics/performance/realtime/settings/service-areas 等)。AdminPageHeader は h1 だが配下の全グループ見出しが div 化し、ページ内 heading が h1 のみで途切れる。
- SSOT: L158-162 (h1→h2→h3 階層), L231 (グループ見出しは支援技術で追える見出し要素)。
- fix: `CardTitle` に `asChild` を追加し `<h2>`/`<h3>` でレンダリング可能に → 各 section で見出しレベルを付与。**共通部品側で一括解決** (System as product, L55-58)。

### SYS-2 [High] master-editor-view の固定px高さ + header欠落 + カテゴリレール静的占有
- 証拠: `src/app/(dashboard)/admin/master-editor-view.tsx:30-58` — `min-h-[720px]` 固定px / `AdminPageHeader` 不使用 / 3カラム(カテゴリ|一覧|詳細)のカテゴリレールが常時本文占有。
- 波及画面: `admin/facilities`, `admin/external-professionals`, `admin/staff`, `admin/vehicles` (全て同部品)。
- SSOT: L122-124 (固定px/100vh 回避, 100dvh ベースで全高), L221-222 (共通 header), L114 (左ナビはドロワー)。
- fix: `min-h-[720px]`→`min-h-[calc(100dvh-…)]`; 冒頭に `AdminPageHeader`(title/description/shortcuts) 追加; カテゴリ選択を上部タブ/ドロワーへ寄せ本文は一覧+詳細の2ペインに。**1部品修正で4画面に波及**。

### SYS-3 [High-count] 共通 PageScaffold / Header 未使用 (素の div で全幅全高枠外)
- SSOT: L221-222 (ページ外枠=共通 scaffold, 冒頭=共通 header), L122-124 (全幅全高)。
- 対象 (各 page.tsx を `PageScaffold(variant="bare")` で包み、ヘッダを共通 header へ):
  - `admin/capacity/page.tsx:1-9` + `capacity-content.tsx:170-176` (自前 div+h1+shortcut)
  - `admin/incidents/page.tsx:8-14` (sr-only h1 のみ, 素 div) + `incidents-content.tsx:133`
  - `admin/inventory-forecast/page.tsx:7-9` + `inventory-forecast-content.tsx:160-165`
  - `admin/operations-insights/page.tsx:7-9` + `operations-insights-content.tsx:124-155` (shortcut 手書き→AdminPageHeader.shortcuts へ)
  - `admin/performance/page.tsx:310` (PageScaffold 不使用, 直接 `<div space-y-6>`)
  - `admin/realtime/page.tsx:155` (同上)
  - `visits/[id]/facility-packet/page.tsx:13` (scaffold/header/h1 全欠落, h2起点で見出しレベル飛ばし) — **通常画面 (capture と違い没入例外でない)**
  - `reports/analytics/page.tsx:13` (PageScaffold 不使用, 外枠/余白/背景を手書き再実装) + ヘッダを `WorkflowPageIntro` へ統一
  - `clerk-support/page.tsx:4` (content 直置き, 素 space-y-5)
  - `offline-sync/page.tsx:4`, `select-mode/page.tsx:4`, `select-site/page.tsx:4` (content 直置き)

### SYS-4 [SSOT準拠] 状態色/カテゴリ色のベタ書き (6軸トークン未使用)
- SSOT: L170-181 (`--state-*`/`--tag-*` トークン + `StateBadge`/`StatusDot`、個別 `bg-*-100`/`text-*-600` ベタ書き禁止)。系列色は `--chart-*`。
- 対象 (深刻順):
  - `patients/[id]/prescriptions/prescription-history-content.tsx:170-179, 546-604, 744-745` — **全面ベタ書き (最多)**。内服/外用→系列 or info、一包化/粉砕→`--tag-hazard`、警告帯→`--state-blocked/confirm`。
  - `patients/[id]/card-workspace.tsx:4470-4471` — 処方明細 `bg-red-50/60`/`bg-amber-50/60` → 麻薬/冷所は `--tag-hazard`。
  - `admin/realtime/page.tsx:185-194` — SSE 状態に emerald/amber 生 (SYS-5 の dark hero と連動)。
  - `patients/[id]/medication-calendar/medication-calendar-content.tsx:48-50` — 時間帯色 → `--chart-*` 系列 (※カテゴリ色、下記 ADD-1 も参照)。
  - `visits/[id]/capture/capture-content.tsx:35-44` — 証跡カテゴリ色 violet/emerald 生。
  - `visits/[id]/visit-record-detail.tsx:930-950` — SOAP アイコン色 (※ADD-1, 非状態色の可否は要 SSOT 判断)。
  - `select-mode/select-mode-content.tsx:36,46,56` — モード見出し blue/violet/emerald 生 → `text-primary`/トークン。
  - `communications/requests/requests-content.tsx:447` — done をボタン背景に流用 → 主操作は primary、完了はラベルで。
  - `external/external-viewer-content.tsx:325` — status を素 Badge → `StateBadge role=...`。

### SYS-5 [Med] グラデーション帯 hero を一般画面に持ち込み + h1配置の不統一
- `admin/realtime/page.tsx:161` — ダークグラデ hero (`bg-[linear-gradient(...)] text-white shadow-lg`)。**SSOT L182 に正面衝突** (グラデ帯は調剤ワークベンチ限定、一般画面に持ち込まない) → `bg-card`/`bg-muted/40` の calm なイントロへ。`admin/performance/page.tsx:316` の大型 hero Card も密度差 (Low)。
- h1配置の二系統分裂 (ワークスペース型トップ): `handoff-workspace.tsx:934` (可視 h1 直置き) vs `visits-today.tsx:296`+`visits/page.tsx:15` (page.tsx sr-only h1 + 本文 h2)。`card-workspace.tsx:4166`/`collaboration-content.tsx:118`/`intake-triage-content.tsx:290`/`notifications-content.tsx:196`/`billing-check-content.tsx:299` も視覚 h2 起点。→ **1パターンに統一** (ADD-2 で規約確定後)。

---

## HIGH — 旗艦画面の配置 (患者詳細。UX インパクト最大)

### HIGH-1 患者詳細: 安全情報(SafetyBoard)が補助パネル群の後ろ
- 証拠: `patients/[id]/card-workspace.tsx:4422` (SafetyBoard) が 共有ケース作成フォーム(4417)/文書(4418)/訪問前確認(4419) の**後**。即時判断情報がスクロール下方へ。
- SSOT: L144-148 (詳細=サマリ→正本→履歴→監査), L117 (安全タグ/訪問可否は本文上位)。
- fix: SafetyBoard を headerRow 直後 (Foundation/Profile と同じサマリ層) へ繰り上げ。

### HIGH-2 患者詳細: 主作業「今回の処方」が補助/設定パネルより下
- 証拠: `card-workspace.tsx:4432` (今回の処方) が PatientShareCaseCreatePanel(4417)/documents(4418) の後。
- SSOT: L70-76 情報順 (3.主要データ > 4.補助/設定)。
- fix: 「今回の処方→直近の動き」を Profile/Safety サマリ直後へ。Home運用/共有/文書は補助層へ後置。

### HIGH-3 患者詳細: ページ最上位見出しが h2 (h1 不在)
- 証拠: `card-workspace.tsx:4166` `<h2>カード — {name}様`。配下 SectionCard は h3。
- fix: headerRow を h1 化 (or sr-only h1 追加)。SYS-5 の h1 規約と整合。

> 注: HIGH-3 と SYS-5 の h1 統一は同時に解くと効率的。患者詳細は閲覧頻度最高のため HIGH-1/2 を最優先で。

---

## MED — 画面別の配置/section順

| # | 画面 | issue | 証拠 | fix |
|---|------|-------|------|-----|
| M1 | tasks | section順逆転: 主要データ(タスク一覧)が末尾、補助フォーム(抱え込み/依頼)が先頭 | `tasks-content.tsx:470,784` | 一覧を上位へ; 抱え込み/依頼は補助下段 or 折りたたみ。全 `tone="subtle"` を主作業=default/補助=subtle に差別化 |
| M2 | my-day | 補助情報が本文右固定列で幅占有 + `xl:pt-20` マジックpadding | `my-day-content.tsx:383,708-806` | 右ドロワー(WorkspaceActionRail)化、即時判断分のみ本文残置 |
| M3 | admin/billing-rules | ヘッダに説明/集計Badge/主操作が混在 + `-mt-2` 負マージン重ね | `billing-rules/page.tsx:516-546` | サマリBadgeを集計グループへ分離、負マージン廃止、主操作を AdminPageHeader.action へ、順=ヘッダ→集計→一覧 |
| M4 | admin/data-explorer | ペイン固定高 `h-[calc(100dvh-Nrem)]` (min-h でなくマジック差引、ヘッダ高変動に非追従) | `data-explorer-content.tsx:257,324,387` | flex/grid 高さ継承 + `min-h-0` へ (※grid の lg 対応は 209509cb で対応済、高さ継承は別件) |
| M5 | admin/document-templates | 4大機能(フォーム/一覧/本文エディタ/送達ルール)直列で大グループ見出し無し | `template-content.tsx:318-535` | 各機能を `PageSection`(h2) で大グループ化 (外枠強/内枠弱) |
| M6 | admin/drug-masters・formulary | 補助機能(取込/履歴/影響キュー/運用)が一覧と同列で大量縦積み、主導線が埋没 | `drug-master-content.tsx:1931-3517` | 主作業=一覧+詳細(Sheet)を上部固定、補助は後段集約 or Tab/ドロワー |
| M7 | patients/[id]/medications | 素 div モーダル (Dialog 不使用) で focus-trap/Escape が不統一 | `medications-content.tsx:322` | shadcn `Dialog` へ統一 (a11y L118) |
| M8 | admin/capacity | 「今すぐ見るべきこと」(即時判断) が KPI/グラフの後 | `capacity-content.tsx:243` | KPI 直下へ昇格 (SYS-3 の scaffold 化と同時に) |
| M9 | admin/business-holidays | 編集フォームが休日一覧の前に割り込み | `business-holidays-content.tsx:425,500` | 順を 集計→カレンダー→一覧→編集 に |
| M10 | admin/performance | PageScaffold 不使用 + 大型 hero Card | `performance/page.tsx:310,316` | PageScaffold で包む (SYS-3) |
| M11 | workflow/pharmacy-cooperation | 本文 section 構成 未検証 (return ブロック精査要) | `pharmacy-cooperation-workflow-content.tsx` | Codex 実装前に section順/カード化を確認 |
| M12 | admin/service-areas | 生 `<select className="h-9">` (36px, タッチ44px未満) | `service-areas/page.tsx:190,224` | shadcn Select か min-h-11 へ |

### Low (任意・churn注意): KPIの1指標1カード化 (statistics/billing-candidates/partner-cooperation/external — ADD-3 の判断次第)、dispense-audit-stats の過剰カード化、views の max-w-5xl、patients/[id]/edit の max-w-7xl、各種 metadata.title の PH-OS/CareViaX 混在。

---

## COMPLIANT (逸脱なし — Codex は着手不要、参照実装として有用)
- **良い参照**: `admin/users` (一覧の理想形 ヘッダ→集計→フィルタ→一覧), `admin/facility-standards` (詳細 サマリ→正本→補助), `admin/audit-logs` (一覧 + action beside evidence + ErrorState), `settings` (運用ポリシー, 無効理由表示+影響確認), `search` (false-empty 回避完備)。
- その他 compliant: patients(一覧)/consent/mcs/residual-adjustment/safety-check/compare/new, prescriptions/[id]/new/qr-drafts/intake(h1除く), visits(一覧)/[id]/record/voice-memo/evidence, schedules/*(conflicts/emergency-route/proposals/route-compare), reports/reports/[id]/share, conferences(h1除く), referrals/new, dashboard(M無し)/statistics/views(max-width除く)/external(色除く)/workflow。

---

## ADD — SSOT 追記提案 (ガイドライン未記載、人間/SSOT 判断。実装でなく docs/ui-ux-design-guidelines.md への追記候補)
- **ADD-1**: 非状態色の扱い — SOAP の S/O/A/P 識別色、服薬カレンダーの時間帯色/曜日色(土日)、証跡カテゴリ色を「状態色と別の固定色/系列色として許可」するか明文化 (現状 L170 ベタ書き禁止と衝突)。
- **ADD-2**: ワークスペース型トップの h1 配置規約 (page.tsx の sr-only h1 か content の可視 h1 か) を1パターンに統一。あわせてトップ階層ヘッダ規約 (WorkflowPageIntro / WorkflowPageHeader / bare のどれを使うか)。
- **ADD-3**: KPI ストリップ (1指標=1カード) を L84「1件ずつカード化しない」の許容パターンとして明記。
- **ADD-4**: CardTitle と heading 要素の関係 (asChild で h2/h3 必須か) を明文化 (SYS-1 の前提)。
- **ADD-5**: 確認専用ビューでの「生成物(AI要約)への確認/訂正フィードバック」「施設ロジ申し送り」は正本編集に当たらず許可、を明文化 (visits/[id]/brief, facility-packet)。
- **ADD-6**: max-width 許可対象に「設定・選択系の操作画面」を含めるか (views, patients/[id]/edit)。
- **ADD-7**: 1ページに大量大機能を直列する admin 画面の分割基準 (Tab/ドロワー/別ページ閾値)。
- **ADD-8**: 印刷文書 (`bg-gray-800 text-white` 見出し帯) の配色ポリシー。アプリ名表記 (PH-OS / CareViaX) の統一。
- **ADD-9**: ダミー/未実装画面 (MasterEditorView) の loading/empty/error スタブ要否。

---

## 推奨着手順 (Codex)
1. **SYS-1** (CardTitle asChild) — 1部品で全 admin の見出し階層解決。
2. **SYS-2** (master-editor-view) — 1部品で4画面。
3. **HIGH-1/2/3** (患者詳細 card-workspace の section順 + h1) — 旗艦画面、UX インパクト最大。
4. **SYS-3** (PageScaffold/Header 横展開) — 12画面、機械的。
5. **SYS-4** (状態色トークン化) — prescription-history を筆頭に。
6. **SYS-5** (realtime グラデ hero 除去 + h1統一) — ADD-2 確定後に h1 統一。
7. **MED** (M1 tasks → M2 my-day → 以降表の順)。

> ADD 群は人間/SSOT 判断待ち。SYS-4 の SOAP/カレンダー色 (ADD-1) と h1統一 (ADD-2) は ADD 確定後に着手推奨 (それ以外の SYS-4 は今すぐ可)。
