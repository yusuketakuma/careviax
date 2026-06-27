# 訪問スケジュールカレンダー（#4）共通部品化 設計評価

**Status:** PLAN_ONLY（read-only 設計評価。実装 LOCK 未取得）
**Owner:** claude-lead（FE レーン）
**Reviewer:** codex-lead
**親計画:** `docs/shared-month-grid-plan.md` §6（#4 schedules は別 PLAN）
**目的:** `schedules/calendar-view.tsx` を共通 `MonthGrid`（R3a/R3b で新設）へ寄せられるか、月曜始まり+隣月日表示モデルを `useMonthGrid` 拡張で挙動不変に吸収できるかを評価し、採否を勧告する。

---

## 0. 対象の現状（read-only 精読）

`src/app/(dashboard)/schedules/calendar-view.tsx`（422 行）。

### 日列挙モデル（L204-208）

```ts
const monthStart = startOfMonth(currentMonth);
const monthEnd = endOfMonth(currentMonth);
const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // 月曜始まり
const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
```

- **date-fns で日列挙**。R3a/R3b で除去した手書き `getDaysInMonth`/`getFirstDayOfWeek`/`calendarCells` 重複は **元々ない**（R3c medication-calendar と同じ）。
- **隣月日表示モデル:** 先頭 null パディングではなく、前月末尾〜翌月頭の **実 Date** を含む完全週を出す。`isSameMonth(day, currentMonth)` で当月判定（`isCurrentMonth`）。

### レンダー構造（L307-410）

- 外枠 `rounded-lg border overflow-hidden` の中に **2 つの別 grid**: ヘッダ `grid grid-cols-7 border-b bg-muted/50`（曜日 7 セル）と、ボディ `grid grid-cols-7`（日セル）。MonthGrid の「単一 grid にヘッダ+セル」とは構造が異なる。
- 日セルは **`<button>`**（div ではない）。属性: `aria-label`(M月d日 + 件数) / `aria-pressed`(選択) / `onClick`(handleDayClick)。
- セル内: 日番号は `<span>` の **rounded-full** で today を強調（`bg-primary text-primary-foreground`）、当月/隣月で文字色変化。billing 警告バッジ（算定注意 / 次回算定可）、ScheduleBadge 最大 3 + `+N件` overflow。
- 当月外セルは `bg-muted/30` で減光。
- **日クリックの副作用:** 隣月日をクリックすると `setCurrentMonth(day)` で**その月へ移動**してから選択（L256-265）。これは隣月日表示モデル固有の挙動。

### ナビ（L270-305）

- bespoke。`<h2>{format(currentMonth,'yyyy年M月')}</h2>` + ChevronLeft / `今月` / ChevronRight の `<button>`（独自スタイル、`MonthGridNav` の outline/sm とは別）。月移動時に `setSelectedDate(null)`。

### 付随

- `DayPanel`（選択日詳細）、`groupCalendarSchedulesByDate`、billing-preview-batch クエリ、`useMemo`(既存)。
- テスト: `calendar-view.test.tsx` / `calendar-view.helpers.test.ts` あり。

---

## 1. ギャップ（現 MonthGrid との差）

| 項目         | MonthGrid 現状                               | schedules が必要                            |
| ------------ | -------------------------------------------- | ------------------------------------------- |
| 週開始       | weekStartsOn 0/1 対応済                      | 1（対応済）                                 |
| パディング   | 先頭 null のみ（当月日のみ）                 | **隣月の実 Date を表示**（null 不使用）     |
| セル model   | `{day, dateKey}`                             | `{date: Date, isCurrentMonth}` も必要       |
| セル要素     | `<div>`（getDayCellProps で role=button 可） | **`<button>`**                              |
| grid 構造    | 単一 grid（ヘッダ+セル）                     | ヘッダ grid とボディ grid が**分離**        |
| オーバーレイ | renderDay 任せ                               | today rounded-full / 減光 / billing / badge |

→ MonthGrid 採用には **`showAdjacentDays` 拡張**（隣月実日 + `isCurrentMonth` + `date` をセルに付与、null 廃止）が新たに要る。さらに button/2-grid 構造は挙動不変での吸収が難しい。

---

## 2. 選択肢と評価

### Opt A: `showAdjacentDays` 拡張 + 完全 `<MonthGrid>` 採用

- useMonthGrid に `showAdjacentDays` を足し、MonthGridCell を `{day, dateKey, date, isCurrentMonth}` に拡張。schedules を `<MonthGrid>` に置換。
- ✗ dedup 価値: schedules は手書き重複が無く、置換しても date-fns 数行を hook 呼び出しに替えるだけ。**実質ゼロ**。
- ✗ 構造差（button / 2-grid / today rounded-full / billing オーバーレイ / 隣月クリック月移動）を MonthGrid に押し込むと、MonthGrid 側に schedules 専用分岐が増え primitive が肥大。**挙動/visual 回帰リスク高**（C3 同種）。
- ✗ 単一 consumer のための拡張（YAGNI）。

### Opt B: `useMonthGrid({showAdjacentDays})` のロジックのみ共有（render は schedules 据え置き）

- 日列挙だけ共通 hook に寄せ、2-grid/button/オーバーレイはそのまま。
- △ しかし共有されるのは `startOfWeek/endOfWeek/eachDayOfInterval` の **6 行**。これらは date-fns 標準 API で重複でも何でもない。hook 化は**間接化を増やすだけ**で可読性が下がる。
- ✗ 価値 < コスト。

### Opt C: 採用しない（schedules は現状維持）

- date-fns ベースの日列挙は明快で、重複も無い。MonthGrid は flat・null パディングの「設定系カレンダー」(operating-hours/business-holidays) に最適化されており、billing 連動の interactive 月表示とは設計思想が異なる。
- ✓ 余計な抽象化を避ける（Monolith First / 最小リスク）。R3c と同じ判断軸。

---

## 3. 勧告

**Opt C（採用しない）を推奨。** 理由:

1. **dedup 価値が無い** — schedules には R3 が除去対象とした手書き重複が存在しない（date-fns 使用）。
2. **回帰リスクが高い** — button / 2-grid / today / billing / 隣月クリック月移動という interactive・算定連動の構造を、設定系 flat MonthGrid に寄せると primitive が schedules 専用分岐で汚れ、視覚/挙動の不変保証が困難。
3. **YAGNI** — 隣月日表示の consumer は現状 schedules 1 つのみ。単一 consumer のために primitive を拡張しない。

### 将来条件（R3'-adjacent）

隣月実日表示 + `isCurrentMonth` を要する **2 つ目の consumer** が出た時に限り、`useMonthGrid({ showAdjacentDays })`（`{day, dateKey, date, isCurrentMonth}` 返却・null 廃止モード）を別スライスとして検討する。それまでは保留。

### schedules 自体の UI/UX 改善（共通部品化とは独立、任意）

共通部品化はしない一方、schedules カレンダー単体の品質向上は別途可能（本 PLAN では実装しない・候補列挙のみ）:

- a11y: 曜日ヘッダと日セルの関連（`aria` / 必要なら APG Grid pattern を keyboard 実装とセットで）。日=赤 / 土=青の曜日色は現状ヘッダに無く `text-muted-foreground` 一律 → 設定系カレンダーと配色一貫性を取るか検討。
- billing バッジの凡例（算定注意 / 次回算定可）の明示。
- これらは `docs/ui-ux-design-guidelines.md` 参照のうえ FEATURE_QUEUE へ別 intake。

---

## 4. 結論

- **schedules #4 を MonthGrid へ寄せる作業は行わない（Opt C）。** 共通カレンダー部品化（R3）は R3a+R3b で完了とし、schedules は据え置く。
- 本 PLAN は read-only 評価のみ。実装スライスは発生しない。
- schedules 単体の UI/UX 改善は希望があれば別 intake として扱う。
