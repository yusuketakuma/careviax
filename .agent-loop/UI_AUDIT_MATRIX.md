# UI_AUDIT_MATRIX — F-20260620-011 全画面UI/UX統一

**目的.** 全画面(routing/pages/layout/modal/state)を巡回し、配置・情報設計・余白・整列・状態表示・
フォーム・一覧・詳細・ナビ・レスポンシブ・a11y・**操作のわかりやすさ**の違和感を棚卸しし、
既存仕様(操作体系)を壊さず UI/UX を一貫した状態へ修正するための監査台帳。

**provenance.** Stage1/2 監査は read-only workflow `wf_2bbf0112-68c`(ui-ux-audit-sweep)で実施。
13 subagents が 121 ルートを機能別12グループで並列監査 → 114 到達可能画面を構造化。rubric=
`docs/ui-ux-design-guidelines.md` + `docs/state-color-migration-map.md`(6軸状態色 SSOT)。
full per-screen rows: workflow 出力(task wusmpbddq, 255KB)に保持。本台帳は集約・優先度・計画。

**集計.** 114 screens / priority: **High 31 · Medium 43 · Low 40** / High-severity findings 22 /
**state(loading|error|empty|success)欠落 82 screens**。

**運用ポリシー(F-011 task-local, codex 承認 approved_with_notes).** AN-1 UI/UX SSOT 必読 /
AN-2 状態色=6軸 StateBadge/StatusDot トークン(局所色乱立禁止) / AN-3 reuse-first(新 UI lib・重複・
過剰props component 禁止) / AN-4 §9/§10(原則 presentational・API/DB/logic 非変更) / AN-5 WCAG AA・
responsive 非悪化 / AN-6 auth/billing/security/migration/権限/API契約/DB schema/business-logic/
画面仕様大変更は人間承認→BLOCKED。

---

## 0. 人間(origin)からの明示優先要件 — **最優先(P-A/P-B)**

### P-A. 操作のわかりにくさ・操作手順と矛盾した画面配置・伝わりにくい説明文(全画面横断) — High

「操作方法がわかりにくい / 操作手順と矛盾した画面配置 / 伝わりにくい説明文をすべて修正」。
監査の usability/info 所見にマップ:

| route               | 該当する操作わかりにくさ                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `patients/new`      | 6タブ100+フィールド全タブ同重。最初のタブで必須のみ→段階展開が望ましい。重複患者検知時の操作フロー(cancel/上書き/新規)が不明確 |
| `patients/[id]`     | スクロール深度大・「次に何をするか」優先順位不明・最優先 section 折りたたみ未確認                                              |
| `reports`           | 常設 action rail が §114「左ナビはヘッダのナビボタンから開くドロワー」原則に矛盾                                               |
| `reports/[id]`      | 1676行 13+section に space-y-6 グルーピング無で操作対象が埋もれる                                                              |
| `prescriptions/new` | error/警告が手書き div(ErrorState 非使用)で復帰手順が不統一                                                                    |
| 多数                | helper/validation/empty-state の説明文が「次の行動」を示さない(後述 T1)                                                        |

**方針(操作体系は変更しない)**: レイアウトのグルーピング/見出し階層/情報優先順位/説明文(helper・empty・
error コピー)を整える presentational 改善に限定。ワークフロー・遷移・フォーム項目の意味は変えない。

### P-B. 調剤・調剤監査・セット・セット監査の4画面だけ色調が異なる → 他画面に揃える(操作体系不変) — High

`/dispense` `/audit` `/set` `/set-audit` は共通 `DispensingWorkbench`(レセコン風 F1-F12 phase UI)を
phase 違い(disp/audit/setp/seta)で使用。監査では「protected workbench(操作 SSOT)」のため Low 判定だが、
**人間要件は『色調(配色)を他画面に揃える』**。→ workbench の**テーマ色のみ**を標準パレット(深ネイビー
primary / 白ベース高コントラスト / 警告3段 / 6軸状態色)へ寄せる。**F1-F12 の操作体系・キー割当・
phase 遷移は一切変更しない**(色トークン/背景/境界の差し替えに限定)。実装前に workbench の配色実装箇所
(`dispensing-workbench.tsx` 周辺の独自色)を調査し、他画面との具体的ずれを特定する。

---

## 1. 横断テーマ(共通component/layout/state で広く直せる) — reuse-first

| ID     | テーマ                                           | 影響                                                                                                                                        | 推奨アプローチ(既存資産の統一/拡張)                                                                                                                                                                                                                                                                                                                                                                                             | sev  |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **T1** | state表示の欠落・不統一(loading/error/empty)     | 約20+画面(82で何らかの state 欠落)                                                                                                          | 既存 `ErrorState`/`EmptyState`/`Skeleton`/`Loading` を未適用画面へ横展開。`DataTable` に isLoading→skeleton / isError→ErrorState / empty→EmptyState の3点を内蔵する prop 拡張で一括解決。page.tsx の Suspense 包囲標準化。empty/error コピーは「次の行動」を明示(P-A 連動)                                                                                                                                                      | High |
| **T2** | 12px未満タイポ(font-mono text-xs/[10px]/[11px])  | 約12画面                                                                                                                                    | globals.css に最小フォントトークン(--text-mono-min:0.75rem)を定義し font-mono 系へ適用。CLAUDE.md「ラベル12px以上」                                                                                                                                                                                                                                                                                                             | Med  |
| **T3** | `MasterEditorView` スタブ(実データ非接続=偽装UI) | 5画面(external-professionals/facilities/staff/vehicles/professionals)                                                                       | 共通 `MasterEditorView` に fetch/mutation/loading/error/empty を実装(1箇所→5画面)。3カラム固定(280_430_1fr xl専用)を lg以下で単カラム stack。section に aria-label landmark                                                                                                                                                                                                                                                     | High |
| **T4** | 状態色の非6軸混在(emerald/blue/amber 直書き)     | 約8画面(clerk-support, patients/[id], admin/realtime, performance, notification-settings, qr-drafts 等)                                     | 既存 `STATUS_TOKENS`/`StateBadge`/`StatusDot` へ集約。state-color-migration-map に沿い、状態軸のみ6軸へ畳む(カテゴリ固有色は維持)。active で状態色が消える実装は修正                                                                                                                                                                                                                                                            | Med  |
| **T5** | 固定3カラムの非レスポンシブ(xl専用)              | 約9画面(data-explorer, external-professionals, facilities, schedules/conflicts, proposals, reports/[id]/share, patients/[id]/collaboration) | 共通レスポンシブ grid ユーティリティ(grid-cols-1 lg:[...])。xl専用 breakpoint 廃止し tablet で縦stack。reports 常設 rail はドロワー化(§114, P-A 連動)                                                                                                                                                                                                                                                                           | Med  |
| **T6** | progress bar/icon の a11y 代替テキスト欠落       | 約6画面(capacity, performance, metrics)                                                                                                     | 共通 `ProgressBar`/`KpiCard` に role=progressbar + aria-valuenow/min/max 内蔵。tone 色を icon にも反映(色のみ依存解消)。**[verified-closed 2026-06-21]** capacity/metrics/billing/dashboard-cockpit/handoff/visits/schedule/operations/uat/dispense-audit-stats を監査し真の WCAG gap=0(進捗系は aria-hidden+可視数値 or role=progressbar/img+aria-label で横断準拠済)。新規実装は churn=退行リスクのみで **deferred/低価値**。 | Med  |
| **T7** | table sticky header 欠落 + 行アクション <44px    | 約8画面(reports, visits/[id], institutions, jobs)                                                                                           | 共通 `DataTable` に sticky header + zebra(§170)。行内 sm button に min-h-[44px] モバイル下限                                                                                                                                                                                                                                                                                                                                    | Med  |

---

## 2. High優先度の個別画面(抜粋)

drug-masters/formulary(Tall Man 色のみ・4250行・見出し階層欠) / external-professionals・facilities
(MasterEditorView スタブ・非レスポンシブ・landmark無) / capacity(progress SR不可) / performance
(isError未描画・色覚配慮欠) / pca-pumps(固定3列モバイル崩壊) / shifts(カレンダー focus 管理) /
patients/new(100+フィールド同重・重複フロー不明) / patients/[id](優先順位不明) / patients/compare
(重大度色のみ) / prescriptions/qr-drafts/[id](見出し階層・aria-live・必須色のみ) / reports(常設rail・
sticky無) / reports/[id](1676行グルーピング無)。

## 3. state欠落画面(抜粋)

dispense-audit-stats(error無) / performance(isError未描画) / alert-rules(Suspense未包) /
patients/[id]/prescriptions(ErrorState無) / patients/[id]/consent(Skeleton無) / reports(行Skeleton) /
reports/[id]/share(個別loading/empty無) / reports/analytics(skeleton無) / visits/[id](text loading・
error無) / prescriptions/new(手書きerror)。

---

## 4. Stage3 修正計画の着手順(共通基盤→個別、reuse-first)

1. **P-B workbench 配色揃え**(4画面・色トークン限定・操作不変) — 独立・低リスク・人間明示要件。
2. **T1 state3点セット**(DataTable/page Suspense 標準化 + empty/error コピー改善=P-A 連動) — 最広影響。
3. **T4 状態色6軸集約** + **P-B と同系の局所色除去**(clerk-support 等)。
4. **T3 MasterEditorView 実装**(5画面一括) + **T5 レスポンシブ grid** + reports rail ドロワー化(P-A)。
5. **T6/T7 a11y(progress/table/touch)** 横展開。
6. **P-A 個別**(patients/new 段階表示・patients/[id] 優先順位・説明文整備)。
7. **T2 タイポ最小サイズトークン**。

各 Stage は codex に PATCH_REVIEW を出し、仕様変更混入/重複component/型/テスト/a11y/responsive/
未使用コードを監査させる。F-009(search/app-shell/app-header)landing 後に着手(lock 競合回避)。

---

## 5. Stage1 詳細 — P-B workbench 配色揃え（recon 確定、read-only 調査済）

**対象構造.** `/dispense` `/audit` `/set` `/set-audit` は同一 `DispensingWorkbench` に `phase`
prop（dispense/audit/setp/seta）を渡すだけの薄い4 page。色実装ディレクトリ=
`src/components/features/dispense-workbench/`。

**色の所在.** hex 直書き **200+ 箇所**。中心2ソース: `use-workbench-view.ts`（phase別色トークンを
hex 生成・40+箇所、`ACCENT='#1f4e79'`/primaryBg/状態色/カレンダー色/risk色）と
`dispensing-workbench.module.css`（CSS Module 全 hex・30+宣言、root背景#e8ebee/青グラデ
ヘッダ#3a5e8c→#27466c/ステータスバー#2c4a6e→#1e3450/橙モーダル）。消費側インライン=
right-pane.tsx(60+)/prescription-grid.tsx(40+)/medication-calendar-grid.tsx(30+)/
dispensing-workbench.tsx/patient-list-panel.tsx/phase-tabs.tsx + hold/compare ダイアログ2。

**標準 SSOT.** `globals.css` の oklch CSS変数: primary=oklch(0.38 0.09 252)≒#1f4e79 /
background=白 / border=--border / 6軸状態色=--state-blocked(赤)/done(緑)/confirm(琥珀)/
waiting(紫)/readonly(灰) + --tag-hazard(琥珀)/info(青)。標準UIは STATUS_TOKENS 経由。

**揃え方針（操作体系不変・テーマ色のみ）.**

- 方式: hex リテラル → `var(--*)` 参照へ置換（CSS Module/インライン style 内で CSS変数参照。
  Tailwind class 置換ではない＝レイアウト/構造に無影響）。`PHASE_ROUTE`/`PHASE_HREF`/fkeys
  (F1-F12)/runAction/keydown/store 結線/view field の shape は一切触らない（色値文字列のみ差替）。
- **base chrome（揃える）**: root背景#e8ebee→白ベース(--background/--muted)、境界各種→--border、
  青グラデヘッダ/ステータスバー→standard primary 系。← 人間が感じる「色調のずれ」の主因。
- **状態色（6軸へ畳む）**: 完了/監査OK(#3a9d4f等)→--state-done、NG/差戻し(#d9534f/#c0392b)→
  --state-blocked、保留/監査待ち/作業中(#9a6a18/#e0972b)→--state-confirm、未着手(#9aa6b4)→
  --state-readonly、比較/info(#2f80ed)→--tag-info、麻薬/冷所→--tag-hazard。
- **phase accent（畳まない・要 UI 判断）**: tab dot/primaryBg/右ペイン accent の phase別色
  (disp=青/audit=緑/setp=紫/seta=橙)は **phase 識別のためのテーマ色**であり state ではない
  （前例 migration-map:334）。一律 state トークン化は phase 識別を壊す。→ **phase 差別化は維持**
  しつつ、各 accent を標準パレットと同系統の色相へ寄せて「同じデザインシステムに属する」見えに
  する（hue を palette 由来に揃える）。色のみ依存は無し（label+aria_current 併記済）。

**リスク/注意.**

- 既存テスト（prescription-grid.test.tsx 等）が hex 文字列を直接アサートしている可能性 →
  Stage1 着手時に color アサート有無を grep 確認し期待値を追従。
- patient-list-panel LEGEND(:29-33) が view 状態色(:293-299)と独立な静的 hex で**二重管理** →
  トークン化のついでに view 由来へ一本化（凡例と実体の整合）。
- CSS Module は Tailwind `bg-state-*` が効かない → `var(--state-*)` 参照で統一。

**影響範囲.** 編集 8ファイル / 色直書き 200+ 箇所（大半は反復パターンで機械置換可、phase accent
のみ意味判断）。owned files = dispense-workbench/ 配下 8 + 関連テスト。F-009 と path 非重複。

---

## status

- Stage1 棚卸し: **done**(114 screens)
- Stage2 UX監査: **done**(synthesis 確定)
- Stage3 計画: PLAN_REVIEW_REQUEST + Stage1 supplement 送付 → codex **approved_with_notes**(2026-06-21)
  - Stage1(P-B workbench)合意: phase accent 保持(state へ map しない) / CSS Module・inline の var(--\*) 参照方式 /
    test は token・role・label を assert(hex/oklch 不可) / lock=src/components/features/dispense-workbench/\*\* +
    直下テストのみ / presentational only・非色 affordance 保持・legend を row state と同 source 化 /
    Stage2+(DataTable state 標準化・広域6軸)は別 PLAN_REVIEW
- Stage4 実装: F-009 rev6 landing(lock 解放)後に Stage1 LOCK→配色実体差し替え PATCH。
  patch-review=focused workbench tests + static gates + hex drift 低減 + /dispense /audit /set /set-audit smoke
- hard-stop: 4 cycle / 90分 / 20ファイル / 同一検証失敗3回 / 広範囲で人間判断要 で停止し本台帳と STATE/gbrain に再開点記録
