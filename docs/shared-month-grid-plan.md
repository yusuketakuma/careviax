# 共通月次カレンダー部品化 計画（R3 / 稼働日カレンダー基盤の続き）

**Status:** PLAN（Codex レビュー前）
**Owner:** claude-lead（FE レーン）
**Reviewer:** codex-lead
**親計画:** `docs/operating-day-calendar-plan.md` §9 スライス表 R3
**前提:** 挙動不変リファクタ（visual / DOM 構造 / アクセシビリティ属性を可能な限り保持）

---

## 0. 背景・現状

Explore 調査（read-only）の結果、月次カレンダー/日付グリッドが **6 箇所** で個別実装されており、カレンダー生成ロジック（その月の日数・週開始曜日・先頭空セルパディング・grid-cols-7・前月/翌月ナビ・曜日ヘッダ）が約 40% 重複している。共通部品は存在しない（shadcn calendar も未導入）。

| #   | 画面                 | ファイル                                                              | 週開始 | パディング | レイアウト         | 状態色            |
| --- | -------------------- | --------------------------------------------------------------------- | ------ | ---------- | ------------------ | ----------------- |
| 1   | 休業日カレンダー     | `admin/business-holidays/business-holidays-content.tsx`               | 日     | 先頭 null  | grid-cols-7        | 独自(red/blue)    |
| 2   | 稼働日カレンダー     | `admin/operating-hours/operating-hours-content.tsx`                   | 日     | 先頭 null  | grid-cols-7        | **6 軸トークン**  |
| 3   | 服薬カレンダー(患者) | `patients/[id]/medication-calendar/medication-calendar-content.tsx`   | 日     | 先頭 null  | grid-cols-7(table) | SLOT 独自         |
| 4   | 訪問スケジュール     | `schedules/calendar-view.tsx`                                         | **月** | 隣月日表示 | grid-cols-7        | STATUS_CONFIG     |
| 5   | シフト               | `admin/shifts/shifts-content.tsx`                                     | –      | –          | **table matrix**   | 独自+StateBadge   |
| 6   | 服薬グリッド(調剤台) | `components/features/dispense-workbench/medication-calendar-grid.tsx` | –      | –          | flex(7 日×時間帯)  | `--wb-*` CSS 変数 |

### スコープ判断（重要）

- **R3 対象（骨格が完全一致）:** #1 休業日 / #2 稼働日 / #3 服薬カレンダー。いずれも **日曜始まり・先頭 null パディング・grid-cols-7・WEEKDAY_LABELS=['日'..'土']** で skeleton が同型。ここを共通部品へ寄せる。
- **R3 スコープ外（別レイアウト、別スライスへ）:** #4 schedules（月曜始まり・隣月日を埋める別モデル）、#5 shifts（薬剤師×日付の table matrix）、#6 workbench（7 日×時間帯の専用 flex・inline style）。挙動差が大きく「不変リファクタ」のリスクが高いので、本 R3 では **触らない**。将来 R3' として別途検討（§6）。

---

## 1. 成果物（共通部品 API）

`src/components/ui/month-grid.tsx` に以下を新設（汎用 UI プリミティブ）。

### 1.1 `useMonthGrid`

```ts
type MonthGridCell = { day: number; dateKey: string }; // dateKey は 'YYYY-MM-DD'（local 暦・月内日のみ）

function useMonthGrid(params: {
  year: number;
  month: number; // 0-11
  weekStartsOn?: 0 | 1; // 既定 0=日曜
}): {
  cells: Array<MonthGridCell | null>; // 先頭に weekStartsOn 起点の空セル、その後 1..daysInMonth
  daysInMonth: number;
  firstWeekday: number; // weekStartsOn を考慮したオフセット
};
```

- 現行 3 画面の `getDaysInMonth` / `getFirstDayOfWeek` / `calendarCells` 構築（`new Date(year, month+1, 0).getDate()`、`new Date(year, month, 1).getDay()`、先頭 null + 日番号）を **そのまま** 内包。挙動を変えない。
- `dateKey` は現行 `monthDateKey`（local 暦の `YYYY-MM-DD`、ゼロ埋め）と同一フォーマットで生成。
- React Compiler 採用のため手動 `useMemo` は付けない（CLAUDE.md 方針）。pure 計算をレンダー中に実行。

### 1.2 `<MonthGridNav>`

```tsx
<MonthGridNav year={y} month={m} onPrev={prevMonth} onNext={nextMonth} />
```

- 現行の `ChevronLeft` ／ `{year}年{month+1}月`（`min-w-24 text-center`）／ `ChevronRight`、`aria-label="前月"/"翌月"`、`variant="outline" size="sm"` を踏襲。`PageSection` の `actions` にそのまま差し込める。

### 1.3 `<MonthGrid>`

```tsx
<MonthGrid
  year={y}
  month={m}
  weekStartsOn={0}
  weekdayLabels={WEEKDAY_LABELS} // 既定 ['日'..'土']
  weekendHeaderColors // 日=text-state-blocked / 土=text-tag-info（既定 on）
  renderDay={(cell) => ReactNode} // consumer が日セル中身を描画
  renderEmpty={() => ReactNode} // 既定 <div className="min-h-16 bg-card" />
  cellClassName="min-h-16 bg-card p-1" // 既定値あり
/>
```

- レンダー構造は現行 #2 を基準に固定: 外枠 `grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border/70 bg-border/70` → 曜日ヘッダ 7 セル → 日セル。
- `renderDay` で consumer が `dateKey` から自分の状態（resolved / holiday / slot）を引いてセル中身を返す **slot 方式**。状態色の harmonize は本 R3 では行わない（各 consumer の現行配色を renderDay 内に保持）。
- a11y: ヘッダ行に `role="row"`、グリッドに `role="grid"`、日セルに `role="gridcell"` を付与（ベストプラクティス、現行に無くても付与は非破壊。視覚不変）。

---

## 2. リファクタ工程（段階移行・各スライス独立 green）

| Slice   | 内容                                                                                                                  | owner  | 検証                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| **R3a** | `month-grid.tsx` 新設 + 単体テスト（cells 構築・閏年/月跨ぎ・weekStartsOn・nav aria）→ **#2 稼働日** を共通部品へ置換 | claude | 既存 `operating-hours-content.test.tsx`（resolved 状態の calendar 表示テスト）が無改変で green、+ month-grid 単体テスト |
| **R3b** | **#1 休業日** を共通部品へ置換（独自 red/blue 配色は renderDay 内に保持）                                             | claude | business-holidays テスト green（無ければ最小追加）                                                                      |
| **R3c** | **#3 服薬カレンダー(患者)** を共通部品へ置換（SLOT 配色は renderDay 内に保持）                                        | claude | medication-calendar テスト green                                                                                        |

- 各スライスで「共通部品へ寄せる前後で DOM/visual が変わらない」ことを既存テスト + 目視（/browse）で確認。
- スライス間に barrier は置かず、R3a 承認後に R3b/R3c を順次。

## 3. LOCK 予定 path

- R3a: `src/components/ui/month-grid.tsx`(新) / `src/components/ui/month-grid.test.tsx`(新) / `src/app/(dashboard)/admin/operating-hours/operating-hours-content.tsx`
- R3b: `src/app/(dashboard)/admin/business-holidays/business-holidays-content.tsx`(+test)
- R3c: `src/app/(dashboard)/patients/[id]/medication-calendar/medication-calendar-content.tsx`(+test)
- いずれも Codex の 案A/S6 write scope（`src/types/master-hub.ts` / `src/app/api/**` / `master-hub-content.tsx` / service）と非重複。

## 4. 検証ゲート

`pnpm exec eslint <files>` / `pnpm exec prettier --check <files>` / `pnpm typecheck` / `pnpm typecheck:no-unused` / 対象 `pnpm exec vitest run <test>`。tsc 2 種は逐次（.next/types race 回避）。

## 5. ベストプラクティス（インターネット取得方針）

> **注意（C2 と整合）:** ARIA `grid`/`row`/`gridcell` ロールは **キーボード操作・focus 管理を実装し、対応テストを伴う場合のみ** 付与する。静的表示のグリッド（R3a 稼働日カレンダー等）には付けない。

- **静的グリッド（既定）:** container `aria-label` + 日番号の `<time dateTime>` マークアップに留める（視覚不変・非破壊で機械可読性を付加）。R3a はこの方針。
- **interactive グリッド（R3b 等、日セルが clickable/selectable）:** 既存実装の `role="button"` + `tabIndex` + `aria-pressed` + `onKeyDown`(Enter/Space) を `getDayCellProps` 経由でそのまま保持する。新たに `role=grid/row/gridcell` へ作り替えることはしない（挙動・テスト面の regression を避ける）。
- 週開始曜日は `weekStartsOn` で外部設定可能に（i18n/運用差吸収）。日本の保険薬局運用では日曜始まりが既定。`weekdayLabels` 省略時は `weekStartsOn` 起点に既定ラベルを回転（ヘッダとセルの曜日ずれ防止）。
- ARIA grid pattern を将来導入する場合は実装前に Context7/公式 ARIA APG で裏取りしてから確定。

## 6. R3 スコープ外（将来 R3'）

- #4 schedules: 月曜始まり + 隣月日表示モデルを `useMonthGrid` の `weekStartsOn:1` + `showAdjacentDays` 拡張で吸収できるか別途評価。
- #5 shifts: table matrix は別パターン。共通化せず据え置き。
- #6 workbench: 専用色/inline style、7 日×時間帯。据え置き。

---

## 7. Codex への質問（回答済み）

1. slot 方式（`renderDay` で consumer が状態描画、状態色 harmonize は本 R3 でやらない）で合意か? → **合意。** harmonize/6 軸統一は R3 外。新部品の default のみ PH-OS token に寄せ、consumer 固有色は renderDay 側に閉じる。
2. 配置は `src/components/ui/month-grid.tsx`（汎用 UI）で良いか? → **OK。** ただし business holiday / medication の業務セマンティクスを部品へ持ち込まない。
3. R3a の対象を **#2 稼働日（claude 既知・テスト有）** から始める順序で異論ないか? → **OK。** 非 interactive で primitive の最小検証に向く。

## 8. Codex レビュー条件（R3a 実装前に反映・APPROVED_WITH_CONDITIONS）

- **C1: `getDayCellProps(cell) => HTMLAttributes` を最初から実装。** cell `<div>` へ merge し、R3b の business-holidays（日セル自体が clickable / keyboard / `aria-pressed` / selected / cursor）を nested button 化せず吸収する。R3a では未使用でも test で props passthrough を検証する。
- **C2: ARIA `role=grid/row/gridcell` は付けない。** 既存に無い grid role を「非破壊」とは扱わない。静的表示の R3a は container `aria-label` + 日番号の `<time dateTime>` マークアップに留める。role=grid を付けるなら keyboard/focus 実装と test をセットで（今回は見送り）。
- **C3: R3c medication-calendar は table/print セマンティクスを維持。** `useMonthGrid` のロジック共有のみ許容し、div `<MonthGrid>` への強制移行はしない（DOM/print/a11y が不変でなくなるため）。
- **C4: `<MonthGridNav>` の aria-label は consumer 上書き可。** `prevLabel`/`nextLabel` prop（既定 `前月`/`翌月`）。

### 確定 API（条件反映後）

```tsx
type MonthGridCell = { day: number; dateKey: string };

useMonthGrid({ year, month, weekStartsOn?: 0 | 1 }): {
  cells: Array<MonthGridCell | null>; daysInMonth: number; firstWeekday: number;
};

<MonthGridNav year month onPrev onNext prevLabel? nextLabel? />

<MonthGrid
  year month weekStartsOn?
  weekdayLabels?            // 既定 ['日'..'土']
  weekendHeaderColors?      // 既定 true（日=text-state-blocked / 土=text-tag-info、実曜日基準）
  ariaLabel?               // container aria-label（C2）
  className? cellClassName? emptyCellClassName?
  getDayCellProps?         // (cell) => HTMLAttributes（C1: clickable/selectable セル用 passthrough）
  renderDay                // (cell) => ReactNode（セル内容。日番号<time>含め consumer 制御）
  renderEmpty?             // 空セル全体を上書き
/>
```
