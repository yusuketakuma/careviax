# 稼働日カレンダー基盤 — 詳細設計 (PLAN)

**Status:** DRAFT rev2 (Claude 起案 → Codex REQUEST_CHANGES 反映済 → 再レビュー待ち / 実装前)
**Author:** Claude (Opus 4.8) — 2026-06-27
**Revision:** rev2 (2026-06-27) — Codex PLAN review の HIGH×3/MED×4/LOW×1 を反映: §1.1 org-wide precedence 明文化 / §2.4 BusinessHoliday partial unique 戦略 / §3.1 pure resolver と legacy/full adapter 分離 / §3.2 @db.Time↔HH:mm 境界 / §4.4 org-wide 取り込み契約 / §5.2 規制薬 carve-out 強化 / §13.3 スライド承認の臨床確認固定 / §14 lib pin・命名・依存ゲート。
**Scope:** 休日管理派生機能の **土台** = 「薬局の稼働日とは何か」を定義するデータモデル・営業日計算ユーティリティ・API・連携契約。
ダウンストリーム機能（服薬終了日スライド / 緊急オンコール当番 / 算定加算）は本 PLAN では **契約（インタフェース）のみ**定義し、詳細設計は後続 PLAN に分割する。

関連レビュー: 「休日管理派生機能 — 機能網羅性レビュー」(2026-06-27, agmsg)。
SSOT: 本 PLAN 承認後、`.agent-loop/FEATURE_QUEUE.md` にタスク分割を登録。

---

## 0. 前提（実調査済みの現状）

| 領域                    | 現状                                                                                                | 根拠                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 休業日マスタ            | `BusinessHoliday`(date/name/holiday_type∈{public_holiday,site_closure,org_event}/is_closed/site_id) | `prisma/schema/organization.prisma:326-340`                                |
| 薬局の営業曜日/営業時間 | **無し**（`PharmacySite` に hours/定休フィールド無し）                                              | `organization.prisma:101-130`                                              |
| 薬剤師シフト            | `PharmacistShift`(個別日) + `PharmacistShiftTemplate`(週次)                                         | `organization.prisma:287-324`                                              |
| 訪問生成の休業日考慮    | `planner`(提案)=有 / `generate`(直接)=**無**                                                        | `visit-schedule-planner.ts:878-1059` / `visit-schedules/generate/route.ts` |
| 服薬終了日              | `end = start + (days-1)` 純カレンダー、休業日連動ゼロ                                               | `use-workbench-write-handlers.ts:350-356`                                  |
| 在庫予測                | 固定7日、休業日無視                                                                                 | `lib/analytics/inventory-forecast.ts`                                      |
| 日付util                | 整形のみ（営業日計算なし、UTCベース）                                                               | `lib/date-key.ts`                                                          |

**結論:** 稼働日 = (営業曜日) − (定休) − (休業日 is_closed) + (臨時営業) を導く土台が無い。これを最初に作る。

---

## 1. 概念モデル

```
ある日 D・ある拠点 S の「稼働状態」を一意に決める優先順位（上が優先）:

1. BusinessHoliday(date=D, site=S or null)         ← 日付固有の上書き
     - is_closed=true  → 休業
     - is_closed=false → 営業（祝日だが営業 / 臨時営業）。時間は §3.2 の任意 short-hours
2. PharmacyOperatingHours(site=S, weekday=D.曜日)    ← 週次の既定
     - is_open=false   → 定休
     - is_open=true    → 営業（open_time〜close_time）
3. （いずれも無い場合のフォールバック）= 営業扱い（既定 open）。運用上は §3.1 のデフォルト行を必ず作る
```

- **稼働日 (operating day)** = 上記の解決結果が「営業」の日。
- **営業時間 (operating window)** = 営業日の open_time〜close_time（短縮営業はこれが狭まる）。
- 拠点別。`site=null` の BusinessHoliday は全拠点に適用（既存挙動を踏襲）。

#### 1.1 org-wide vs site-specific の優先順位（**明文化・必須** / Codex review #2）

同日に `site_id=null`（全拠点）と `site_id=S`（特定拠点）の BusinessHoliday が併存した場合の勝者を**保守的に固定**する（実装者ごとの解釈ブレ＝経路差を防ぐ）:

- **全拠点 closed は site-specific open では覆せない。**（`site_id=null, is_closed=true` が存在する日は、`site_id=S, is_closed=false` があっても**休業**）。これは現行挙動の維持: available route は org-wide closure を見つけたら即 empty return（`pharmacist-shifts/available/route.ts:71-73`）、planner も `holiday.site_id==null || shift.site_id 一致` で `business_holiday` rejection（`visit-schedule-planner.ts:1047-1059`）。
- **site-specific closed は全拠点 open に優先する。**（`site_id=S, is_closed=true` はその拠点のみ休業）。
- 「全拠点休業だが特定拠点だけ臨時営業したい」という業務要求が出た場合は、**現行挙動の変更**として別途 override policy/flag を設計し、migration / UX / tests に明記する（本 PLAN のスコープ外。安全側に倒し初版では不可）。
- §3 の `resolveOperatingState` はこの優先順位を**唯一の実装**として持ち、planner/generate/UI が同じ結果を得る（R1/S6 の単一化の核心）。

---

## 2. データモデル（追加のみ・非破壊）

### 2.1 新規モデル `PharmacyOperatingHours`（週次の既定営業/定休）

```prisma
// prisma/schema/organization.prisma に追加
model PharmacyOperatingHours {
  id          String       @id @default(cuid())
  org_id      String
  site_id     String                          // 拠点必須（薬局営業は拠点単位）
  weekday     Int                             // 0=日 .. 6=土
  is_open     Boolean      @default(true)      // false = 定休
  open_time   DateTime?    @db.Time()          // 営業時 必須運用（is_open=true で null は終日扱い）
  close_time  DateTime?    @db.Time()
  note        String?
  created_at  DateTime     @default(now())
  updated_at  DateTime     @updatedAt

  org         Organization @relation(fields: [org_id], references: [id])
  site        PharmacySite @relation(fields: [site_id], references: [id])

  @@unique([site_id, weekday])
  @@index([org_id])
}
```

- `PharmacySite.operating_hours PharmacyOperatingHours[]` / `Organization.operating_hours` の逆リレーション追加。
- 1拠点あたり最大7行（曜日ごと）。`PharmacistShiftTemplate` と形が似るが**意味が違う**（薬局の営業 vs 薬剤師個人の勤務）。混同しないこと。

### 2.2 `BusinessHoliday` の拡張（任意・後方互換）

短縮営業 / 臨時営業を日付固有で表すため、**任意フィールドを追加**（既存行は null=従来挙動）:

```prisma
// 追加（すべて nullable、後方互換）
open_time   DateTime? @db.Time()   // is_closed=false かつ短縮/臨時営業の営業時間
close_time  DateTime? @db.Time()
```

- `is_closed=true`（従来）= 終日休業。
- `is_closed=false` + open/close=null = 終日営業（祝日営業など、既存挙動）。
- `is_closed=false` + open/close 指定 = 短縮/臨時営業。
- **MVP では §2.2 を見送り、`is_closed` boolean のみで開始してもよい**（要 Codex 判断、§11-Q1）。

### 2.3 監査

`PharmacyOperatingHours` / `BusinessHoliday` の作成・更新・削除は既存の監査ログ機構（`createAuditLogEntry`）に載せる。自動取込・連休プリセット・自動スライドは**操作主体（system/ユーザー）と根拠を記録**。

### 2.4 `BusinessHoliday` の一意性戦略（**migration 前提・必須** / Codex review #1）

- **現状:** `BusinessHoliday` には `@@index` のみで `@@unique` が**無い**（`organization.prisma:326-340`）。重複防止は API のアプリ側 `findFirst`（`business-holidays/route.ts:104-114`、`[id]/route.ts:43-54`）に依存。並行 import/bulk で duplicate が混入し得るし、**DB unique 無しでは Prisma `upsert` が成立しない**。
- **PostgreSQL の NULL 問題:** 単純な `@@unique([org_id, date, site_id, holiday_type])` は **`site_id IS NULL`（全拠点行）の重複を防げない**（NULL 同士は等しくないと評価される）。
- **方針（migration 承認対象に含める）:**
  1. migration **前**に既存 duplicate を検査・解消する maint スクリプト（org-wide / site-specific 双方）。手動登録済みの正当な行は保持。
  2. DB-level unique を **2本の partial unique index（raw SQL）** で張る:
     - `UNIQUE (org_id, date, holiday_type) WHERE site_id IS NULL`（全拠点行）
     - `UNIQUE (org_id, date, site_id, holiday_type) WHERE site_id IS NOT NULL`（拠点行）
  3. import / bulk の `upsert` 化は **上記 unique が入った後**に限る。それまではアプリ側 `findFirst` ガードを継続（upsert 前提にしない）。
- **テスト:** org-wide public holiday の重複、site public holiday の重複、create/import の冪等性（疑似並行）、既存手動 holiday が import で保持されること。
- **⚠ hard-stop:** unique 追加・partial index・既存データ解消は DB 変更につき**人間承認必須**（§6・`.agent-loop/BLOCKED.md`）。

---

## 3. 営業日計算ユーティリティ（pure / server+client 共有）

**配置:** `src/lib/calendar/operating-day.ts`（純関数、DB 非依存。入力に解決済みデータを渡す＝テスト容易）。
**重要:** 既存 `date-key.ts` は UTC ベース。営業日計算は **JST(Asia/Tokyo) の暦日**で判定する（日跨ぎ事故防止）。`date-key` の `YYYY-MM-DD` 文字列を一次キーにし、Date オブジェクト演算を避ける。

```ts
export type OperatingHoursRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
};
export type HolidayRow = {
  date: string;
  site_id: string | null;
  is_closed: boolean;
  open_time?: string | null;
  close_time?: string | null;
};
export type OperatingCalendar = {
  siteId: string;
  weekly: OperatingHoursRow[]; // 最大7
  holidays: Map<string, HolidayRow[]>; // dateKey -> rows（site一致 or null）
};

/** D は 'YYYY-MM-DD'（JST暦日キー）。 */
export function resolveOperatingState(
  cal: OperatingCalendar,
  dateKey: string,
):
  | { open: false; reason: 'holiday' | 'regular_closed' }
  | {
      open: true;
      from: string | null;
      to: string | null;
      source: 'holiday' | 'weekly' | 'default';
    };

export function isOperatingDay(cal: OperatingCalendar, dateKey: string): boolean;

/** 起点から direction 方向で最も近い稼働日を返す（起点が稼働日ならそのまま）。 */
export function nearestOperatingDay(
  cal: OperatingCalendar,
  dateKey: string,
  direction: 'backward' | 'forward',
): string;

/** 稼働日を n 日進める/戻す（営業日のみカウント）。安全上限 maxScan で無限ループ防止。 */
export function addOperatingDays(cal: OperatingCalendar, dateKey: string, n: number): string | null;
```

- `nearestOperatingDay` は無限ループ防止に **maxScan（例 366 日）** を持ち、超過時は `null`/起点を返し呼び出し側でハンドリング。
- 全拠点休業（`site_id=null` の is_closed=true）も holidays Map に含める（既存 planner と同じ解決）。

#### 3.1 pure resolver と DB adapter の分離（**behavior-preserving の核心** / Codex review #5）

`operating-day.ts` は **DB を知らない pure resolver**（上記の型のみを受ける）に純化し、DB 行→resolver 入力の変換は**別レイヤ `buildOperatingCalendar*`** に置く。これにより R1 を**挙動不変**にできる:

```ts
// pure（DB 非依存・テスト容易）= 上記 resolveOperatingState / isOperatingDay / nearestOperatingDay / addOperatingDays
// adapter（DB 行 → OperatingCalendar）:
export function buildOperatingCalendarLegacy(holidayRows: BusinessHolidayRow[]): OperatingCalendar;
//   ↑ R1 用。is_closed=true rows のみ・weekly 無し・org-wide/site precedence(§1.1) を反映。
//     現行 planner と「同じ入力だけ」を渡すので挙動不変。
export function buildOperatingCalendar(holidayRows, weeklyRows, opts): OperatingCalendar;
//   ↑ S2/S3 後。weekly hours / 短縮営業 / is_closed=false を解釈する完全版。
```

- **R1（§12.1）では `buildOperatingCalendarLegacy` を使う。** weekly fallback や `is_closed=false` を読み始めると planner 挙動が変わる（= behavior-preserving 違反）ため、weekly 対応は **S2/S3 完了後**に adapter を差し替える形で段階導入する。
- planner の現行挙動（`is_closed=true` rows only / weekly 無 / org-wide closure hard block / site closure は shift.site_id 一致）を**特性テストで固定してから** R1 に着手。

#### 3.2 営業時間の string 境界・DB time アダプタ（**必須** / Codex review #4）

- pure util は **`Date` を受け取らない。** 営業時間は canonical な `'HH:mm'`（必要なら `'HH:mm:ss'`）文字列で扱い、比較は既存 `timeStringToMinutes`（`visit-schedule-shift.ts:10`）に寄せる。
- `@db.Time()`（Prisma 上は `Date`）↔ canonical string の変換は **DB adapter 層に閉じる**。generate は既に `new Date('1970-01-01T${HH:mm}')` で保存（`visit-schedules/generate/route.ts:564-568`）しており、Date を直接 serialize/比較すると **timezone/local offset で営業時間判定がずれる**（短縮営業で患者訪問可能時間の誤判定に直結）。adapter で必ず正規化する。
- 固定すべき意味論: `from >= to` は invalid、`open_time/close_time = null` の意味（is_open=true で null = 終日扱い）、秒の扱い、`date-key` の JST 暦日キー（`date-boundary.ts:3-18`）との関係。
- **テスト:** 09:00/18:00 roundtrip、null open/close、`from>=to` invalid、サーバ TZ 非依存スナップショット。

---

## 4. API

### 4.1 営業時間マスタ `/api/pharmacy-operating-hours`

- `GET ?site_id=` → 当該拠点の週次7行（無ければ既定生成して返すか空配列、§11-Q2）。`canAdmin`。
- `PUT`（冪等 upsert、7行まとめて） body=`{ site_id, rows: [{weekday,is_open,open_time?,close_time?,note?}] }`。`canAdmin`。
- no-store（`withSensitiveNoStore`、確立パターン）。

### 4.2 法定休日（祝日）取込 `/api/business-holidays/import-public-holidays`

- `POST { year, site_id? }` → 当年の日本の祝日を `BusinessHoliday(holiday_type='public_holiday', is_closed=既定値)` として一括 upsert。`canAdmin`。
- **祝日ソース（§11-Q3）:** (a) 内閣府公表CSVを年次取込（外部DLは医療コンプラ上 egress 注意→ビルド時同梱 or 手動更新が無難）、(b) 算出ライブラリ（変動祝日・振替休日・国民の休日を計算）。**推奨: 同梱データ + 算出のハイブリッド**。変動（春分/秋分）と臨時改正があるため**毎年の更新運用と手動上書きを前提**にする（自動完結にしない）。
- 既存手動登録との重複は `(org,date,site,holiday_type)` の既存重複防止に従う。

### 4.3 連休プリセット `/api/business-holidays/bulk`（既存 bulk があれば拡張、無ければ追加）

- プリセット定義（年末年始/GW/盆）から日付範囲を展開して一括 upsert。プリセットは設定ファイル `src/lib/calendar/holiday-presets.ts`（年により可変な部分はパラメータ化）。
- UI 側で**確認ダイアログ（破壊操作）＋取消導線**。

### 4.4 site_id 指定時の org-wide holiday 取り込み（**契約・必須** / Codex review #3）

- **問題:** 現行 `GET /api/business-holidays` は `site_id` 指定で **exact filter のみ**（`route.ts:47-59`）。UI が `?site_id=S` だけで取得すると `site_id=null` の全拠点休業が消え、稼働日カレンダーが誤って「営業」と表示し、generate/planner と判断が割れる。
- **方針:** **CRUD 用の exact-site list** と **解決済みカレンダー read model** を分離する。
  - resolved read（稼働日カレンダー §13.1 / S1 util 入力）は必ず `OR: [{ site_id: S }, { site_id: null }]` を取り込む。エンドポイント契約として `include_org_wide=true` を **default** にするか、専用の resolved-calendar エンドポイントを設ける。
  - exact-site CRUD（個別編集 list）は従来どおり厳密 filter を維持（編集対象を取り違えない）。
- **S1 util の input builder（§3.1 adapter）は必ず org-wide を OR で含める。** これを adapter に集約し、呼び出し側で OR を書き忘れる事故を防ぐ。
- **テスト:** site calendar が org-wide closure を解決して反映する／exact-site CRUD list が resolved view に必要な org-wide を誤って隠さない。

---

## 5. 連携契約（consumers — 本 PLAN では契約のみ、実装は後続スライス）

### 5.1 `visit-schedules/generate`（直接生成）に休業日チェック追加

- `planner` と同じ判定（`resolveOperatingState`）を `generate` にも適用し、**経路間の不整合を解消**。
- 既定はソフト警告ではなく**ブロック**（既存 generate はシフト休みをエラーで弾く方針に合わせる）。ただし **override（理由必須・監査記録）** を許可し、緊急時のシフト外/休業日訪問を可能にする（§5.4 緊急と接続）。

### 5.2 服薬終了日スライド（後続 PLAN で詳細化、ここは契約）

- 計算は `nearestOperatingDay(cal, endKey, 'backward')` を**原則（前倒し＝薬切れ防止）**。連休をまたぐ場合は不足分を**日数上乗せ調剤**（医療判断）。
- **自動確定しない。** 「スライド提案」を提示し**薬剤師承認**で確定。承認時に根拠（元終了日 / スライド先 / 該当休業日 / 上乗せ日数 / 承認者）を監査記録。
- 影響先: 次回調剤日 / 次回訪問 / `inventory-forecast`。
- **規制薬カーブアウト（強制・サーバ側で担保 / Codex review #7）:**
  - 検知根拠は既存フラグ `DrugMaster.is_narcotic` / `is_psychotropic`（`drug.prisma:68-69`）＋ハンドリングタグに寄せる（海外の refill/bridge 慣行を日本の麻薬・向精神薬へ直接外挿しない。§14.3 と整合）。
  - **麻薬・向精神薬・分類未解決（classification unresolved）の品目は、自動スライド／数量上乗せ提案を一切出さない。** UI に数量候補を出す余地を残さず、**サーバ側も auto-apply を拒否**し、「薬剤師＋法令／施設ポリシー確認」タスクに落とす。承認時は理由・根拠・承認者を audit。
  - 「薬剤師判断必須化」だけでは UI に数量候補が残るため不十分。**検知 → 提案抑止 → 確認タスク化**を契約とする。

### 5.2b 祝日 import の既定 is_closed（契約 / Codex completeness）

- 法定休日 import の `is_closed` 既定値は **pharmacy policy default** とし、確定前に **UI プレビューで確認**してから適用する（祝日でも営業する薬局があるため一律 closed にしない）。

### 5.3 `inventory-forecast` の休業日対応（後続 PLAN）

- 連休前は必要量を**ブリッジ日数分上乗せ**。現状固定7日（`FORECAST_DAYS`）を稼働日カレンダー考慮に拡張。

### 5.4 緊急オンコール当番（後続 PLAN）

- `can_accept_emergency`(boolean) を超えた**輪番（OnCallRoster）**を新設。24時間/時間外/休日/深夜区分は算定加算（§5.5）と接続。

### 5.5 算定加算（後続 PLAN）

- 休業日/時間外/深夜訪問の加算区分を訪問記録・請求候補に反映。月内回数上限（医療4/介護2、planner 検証済）とスライドの干渉を検証。

---

## 6. 非破壊マイグレーション方針

- すべて **ADD のみ**（新テーブル `PharmacyOperatingHours` + `BusinessHoliday` への nullable 列）。既存行・既存挙動は不変。
- backfill: 各 org の各 site に既定の週次7行（例: 月〜土 open / 日 定休、open 09:00 close 18:00）を**冪等**に投入する seed/maint スクリプト。既存行があればスキップ。
- **⚠ hard-stop:** DB schema 変更（migration）は本リポジトリ規約で承認必須。本 PLAN 承認 → migration は人間承認後に実行。`.agent-loop/BLOCKED.md` 経由で管理。

---

## 7. コンプライアンス / PHI

- 営業時間・休業日・当番は PHI ではない（組織運営データ）。ただし変更監査は 3省2 準拠で必須。
- 自動スライド/提案は**医療判断を伴う**ため、根拠記録＋人手承認を設計の前提にする（Compliance by Design）。
- 祝日データの外部取得は egress を避ける（同梱 or 手動）。

---

## 8. テスト計画

- **営業日util（最重要・純関数）:** `operating-day.test.ts` — 定休/休業/全社休業/短縮/臨時営業の解決、`nearestOperatingDay`（前後方向・連休跨ぎ・maxScan 上限）、`addOperatingDays`、JST境界。
- **祝日取込:** 変動祝日（春分/秋分）・振替休日・国民の休日・重複 upsert。
- **連携:** generate の休業日ブロック＋override 監査、planner との一致。
- **API:** operating-hours GET/PUT 冪等・401/403・no-store・PHIなし。protected-get matrix へ追加。
- 既存テスト（business-holidays / shifts / planner）が緑のままであること。

---

## 9. 実装分割（sub-slices）と maker/checker

| #   | スライス                                                                     | owner（案）   | 種別        | hard-stop            |
| --- | ---------------------------------------------------------------------------- | ------------- | ----------- | -------------------- |
| S1  | 営業日計算util `operating-day.ts` + テスト（純関数のみ、DB非依存）           | Claude        | FE/共有util | なし                 |
| S2  | `PharmacyOperatingHours` モデル + migration + seed                           | Codex(API/DB) | backend     | **migration 承認要** |
| S3  | `/api/pharmacy-operating-hours` GET/PUT + no-store + tests                   | Codex         | backend     | なし(S2後)           |
| S4  | 営業時間マスタ管理 UI（admin、business-holidays 近接 or 統合）               | Claude        | FE          | なし                 |
| S5  | 祝日取込 API + プリセット + UI（確認/取消）                                  | Codex+Claude  | 両          | egress判断(§11-Q3)   |
| S6  | generate 休業日チェック + override（planner と整合）                         | Codex         | backend     | なし                 |
| S7+ | 服薬スライド / inventory / オンコール / 算定（後続 PLAN へ）                 | —             | —           | 個別                 |
| R1  | planner/generate の休業日判定を util へ単一化（§12.1、挙動不変＋特性テスト） | Codex         | backend     | なし(S1後)           |
| R2  | 日付/営業日 util の集約・責務純化（§12.2、挙動不変）                         | Claude+Codex  | 両          | なし                 |
| R3  | 休業日/シフト UI の共通カレンダー部品化（§12.3、挙動不変で載せ替え）         | Claude        | FE          | なし                 |
| R4  | 4 モデルの責務境界明文化＋`canVisitOn` 結合関数（§12.4）                     | Codex         | backend     | なし                 |

- S1 は依存なしで即着手可能（純関数）。S2 が DB 承認待ちでも S1 を先行できる。
- **R1 は S6 の前提**（util 単一化なしに generate 整合を入れると二重実装が残る）。R3 は新ビュー（S4/§13.1）の前提（共通部品の上に新画面を足す）。
- リファクタ（R\*）は全て**挙動不変**を原則とし、特性テストで現挙動を固定してから着手（§12.5）。
- 各スライスは LOCK + maker/checker + objective gate（lint/typecheck/test/build）。

---

## 10. ロールアウト順序

1. **S1（util）** ← 土台、依存なし
2. **S2→S3（マスタ DB/API）** ← migration 承認後
3. **S4（マスタ UI）**
4. **S5（祝日/連休）**
5. **S6（generate 整合）**
6. 後続 PLAN（スライド/予測/オンコール/算定）

---

## 11. 未決事項（Codex レビュー / ユーザー判断）

**Codex review (2026-06-27) で決定済:** org-wide precedence（→§1.1 保守的固定）/ スライド方向 Q4（→前倒し原則で合意）/ 祝日 lib Q7（→`@holiday-jp/holiday_jp` v2.5.1、依存ゲート付きで採用可）/ 規制薬 carve-out（→§5.2 強化）。残る未決:

- **Q1:** 短縮/臨時営業（§2.2 の BusinessHoliday open/close 列）を初版に含めるか、MVP は is_closed boolean のみか。
- **Q2:** operating-hours 未設定拠点のフォールバック（全日営業 vs 強制初期設定）。
- **Q3:** 祝日データソース（同梱CSV / 算出 / ハイブリッド）と更新運用。egress 制約との整合。
- **Q4:** スライド方向の既定（前倒し原則で合意か。後ろ倒しを許す業務ケースはあるか）。
- **Q5:** 営業時間マスタ UI は `business-holidays` に統合するか独立ページか（§13.2 の「稼働日設定ハブ」案で統合を推奨。最終確認）。
- **Q6:** `PharmacistShiftTemplate` と `PharmacyOperatingHours` の責務分離の最終確認（薬局営業 vs 個人勤務）。§12.4 の責務境界図で整理。
- **Q7:** （→決定済: `@holiday-jp/holiday_jp` v2.5.1 採用、§14.1 の依存ゲート付き。残課題は依存追加レビューでの bundle/license 最終確認のみ。）
- **Q8:** リファクタリング工程（§12）を本機能の前提として先行するか、機能スライスと並走させるか（R1 営業日判定の単一化は S6 generate 整合の前提になるため先行推奨）。
- **Q9:** 「稼働日カレンダー」ビュー（§13.1）の初版スコープ — 月グリッド閲覧のみ（読み取り）から始め、セル直接編集（クリック作成 / ドラッグ）は後続スライスに分けるか。
- **Q10:** 服薬終了日スライドの UI（§13.3）— 調剤ワークベンチ内インライン提案 vs 専用 Drawer。Z軸ルール（Drawer=参照しながら操作）に照らし Drawer を推奨。

---

## 12. リファクタリング工程（既存コードの整理 — 本機能の土台固め）

新機能を「散らかった土台」に積むと二重実装・経路間の不整合（generate と planner で休業日判定が割れている現状がまさにこれ）を増殖させる。以下のリファクタを **機能スライスと並走または先行**させ、稼働日ロジックの SSOT を一本化する。各リファクタは **挙動不変（behavior-preserving）** を原則とし、必ず既存テスト緑＋（必要なら）特性テスト（characterization test）で固定してから着手する。

### 12.1 R1 — 営業日/休業日判定の単一化（最優先）

- **現状の問題:** `visit-schedule-planner.ts:878-1059`（提案経路）には休業日チェックがあるが、`visit-schedules/generate/route.ts`（直接生成経路）には無い。同種判定が二重化し、片方だけ仕様変更されると経路間で結果が割れる。
- **方針:** §3 の `resolveOperatingState` / `isOperatingDay` を**唯一の判定器**とし、planner と generate の双方がこれを呼ぶ形へ寄せる。planner 内の既存ロジックは `operating-day.ts` へ抽出し、planner はラッパに薄くする。
- **挙動不変の担保（§3.1）:** R1 では **`buildOperatingCalendarLegacy`（is_closed=true rows only / weekly 無 / §1.1 precedence）** を使い、現行 planner と同じ入力のみを resolver へ渡す。weekly fallback や `is_closed=false` を読み始めると挙動が変わるため、weekly 対応は **S2/S3 後**に adapter 差し替えで段階導入。
- **順序:** R1 は **S6（generate 整合）の前提**。S1（pure util + legacy adapter）→ R1（planner を載せ替え・特性テストで固定）→ S6（generate に同じ util を適用）の順。
- **ガード:** planner の既存挙動（rejection code `'business_holiday'`、org-wide closure hard block、site closure は shift.site_id 一致）を**特性テストで固定してから**リファクタ。R1 前後で同一に通ること。

### 12.2 R2 — 日付/営業日ユーティリティの集約

- **現状の問題:** 日付計算が複数箇所に散在 — `use-workbench-write-handlers.ts:350-356`（`addDaysToDateKey`= start+days-1、UTC、営業日無視）、`lib/date-key.ts`（整形のみ）、その他 prescription 系の日付窓計算。
- **方針:** 「暦日 ±n」と「営業日 ±n（`addOperatingDays`）」を明確に分離し、`src/lib/calendar/` 配下に集約。`date-key.ts` は**整形・JST 暦日キー化の責務に純化**し、営業日ロジックは `operating-day.ts` に置く（混在させない）。
- **挙動不変:** 服薬終了日の算出を「営業日連動」に切り替えるのは §5.2（後続 PLAN・要薬剤師承認）であり、R2 自体は**呼び出し口の集約のみ**で計算結果を変えない。スライド導入は別スライスで段階的に。

### 12.3 R3 — 休業日/シフト UI の共通カレンダー部品化

- **現状の問題:** `business-holidays`（休業日編集）と `pharmacist-shifts`（シフト編集）が別々にカレンダー的 UI を持ち、月送り・日選択・状態色の付け方が画面ごとにばらつく恐れ。新たに「営業時間マスタ」「稼働日ビュー」を足すと**3〜4個の似て非なるカレンダー**になる。
- **方針:** §13.1 の「稼働日カレンダー」を共通の月グリッド部品（`src/components/calendar/`）として設計し、休業日・シフト・営業時間・稼働日ビューが**同じグリッド＋凡例＋状態色トークン**を共有する。状態色は 6軸トークン（`StateBadge`/`StatusDot`、`docs/state-color-migration-map.md`）に統一し、生 Tailwind 色をベタ書きしない。
- **段階:** まず凡例・セル・月送りの最小共通部品を切り出し、既存 2 画面を**挙動不変で**載せ替え → その上に新ビューを足す。一度に全置換しない（リスク分散）。

### 12.4 R4 — 責務境界の明文化（モデル混同の予防）

- `PharmacyOperatingHours`（薬局の営業曜日・営業時間）/ `BusinessHoliday`（日付固有の休業・臨時営業）/ `PharmacistShift`(個別勤務) / `PharmacistShiftTemplate`(週次勤務) の **4 モデルの責務境界**を PLAN とコード コメント・型に明記する（Q6）。
  - 「薬局が開いているか」= OperatingHours + BusinessHoliday（拠点軸）
  - 「担当者が動けるか」= PharmacistShift(+Template)（人軸）
  - **訪問可否 = 両者の AND**（薬局稼働日 ∧ 担当シフト内）。この合成規則を `operating-day.ts` とは別の薄い結合関数（例 `canVisitOn(site, pharmacist, dateKey)`）に置き、誤って一方だけで判定する事故を防ぐ。

### 12.5 リファクタリング工程の進め方（共通規律）

- 各 R は **maker/checker 分離**（実装側は自己完了判定しない）＋ **objective gate**（lint/typecheck/typecheck:no-unused/format/test、必要時 build）。
- **特性テスト先行:** 挙動不変リファクタは「現挙動を固定するテスト」を先に追加し、リファクタ前後で同一に通ることを green で示す。
- LOCK 規律（対象 path を agmsg で LOCK → 自ファイルのみ stage → commit）を厳守。

---

## 13. UI/UX 設計（操作しやすさ — `docs/ui-ux-design-guidelines.md` 準拠）

SSOT は `docs/ui-ux-design-guidelines.md`。本節はそれを稼働日/休業日/シフト ドメインに具体化する。基調: **「スケジュール = カレンダーではなくチームの作業進捗ダッシュボード」**（ガイドライン「スケジュール画面」§)、**クリック予算 3 クリック以内**、**段階開示は最大 2 階層**、**状態色は 6軸トークン**、**8pt グリッド / 等幅数字 / スケルトン / モーション 150–300ms ease-out**。

### 13.1 稼働日カレンダー（at-a-glance の月グリッド）

「いつ薬局が開いていて、誰が動けるか」を**一目で**判断できる月グリッドを中核 UI にする。

- **レイアウト（PINNED/PRIMARY/SCROLL）:**
  - PINNED: 拠点切替 + 月送り + 凡例（営業 / 定休 / 法定休 / 薬局休業 / 短縮営業 / 臨時営業）。
  - PRIMARY: 月グリッド。各セルは **状態（色の点・左帯）+ 補助1行（短縮営業なら時間、休業なら名称）** の最小要素。塗り面積は最小化（全面塗り禁止、`border-l` 帯＋ラベル文字色＝§視覚ルール「塗り面積を最小化」）。
  - SCROLL: 選択日の詳細（その日の営業時間 / 当番 / 動ける担当者 / 予定訪問数）。
- **状態の色（6軸へ写像、色だけに依存しない＝アイコン/ラベル併記）:**
  - 営業＝neutral（既定・状態色なし）/ 定休・薬局休業＝readonly(灰) または blocked(赤)（休業の重みで選択、要 Q）/ 短縮・臨時営業＝confirm(橙)（要注意）/ 法定休日＝info(青) ラベル。
- **段階開示:** セルは「状態＋1行」のみ。タップで Drawer（Z軸 3=参照しながら操作）を開き、その日の編集（休業設定 / 短縮時間 / 臨時営業）を行う。Modal はプリセット一括適用など**破壊的操作のみ**（Z軸 4）。

### 13.2 稼働日設定ハブ（休業日・営業時間・連休プリセットの統合 / Q5）

- 営業時間マスタ / 休業日 / 連休プリセットを**1つの設定ハブ**にまとめ、現状バラバラな admin 画面の往復を減らす（クリック削減＝「引き算」）。タブ構成案: 「① 週次営業時間（7曜日）」「② 個別休業日（カレンダー）」「③ 連休プリセット（年末年始/GW/盆）」。
- **連休プリセット適用** は「年を選ぶ → 範囲プレビュー → 確認ダイアログ（破壊的・Modal）→ 適用 → 取消可能トースト（undo）」。適用前に**どの日が休業化されるか必ずプレビュー**（誤適用防止＝ガイドライン「エラー防止」）。
- **法定休日の自動取込** はワンクリック（年指定 → 取込プレビュー → 確定）。変動祝日/振替は自動算出するが、**手動上書きを常に許可**（§14.1、自動完結にしない）。

### 13.3 服薬終了日スライドの提示（前倒し提案 / Q10）

- スライドは**自動確定しない**。調剤ワークベンチで終了日が薬局休業日/連休に当たると検知したら、**専用 Drawer**（Z軸 3）で「元終了日 → スライド先（直近稼働日・前倒し原則）＋該当休業日＋不足日数の上乗せ提案」を提示する。
- **最終承認は臨床確認として固定（Codex review #8）:** Drawer 内に **理由入力（inline reason required）** ＋ **入力が妥当になるまで承認ボタンを disabled**（disabled-until-valid）にし、確定時に**サーバ側 validation/audit** を必ず通す。「ワンタップ承認」に見える文言・導線は避ける（臨床判断であることを UI で明示）。Modal 必須ではないが、低リスク操作のような軽い見え方にはしない。
- 4 状態分離: 検知中＝inline ヒント、要対応＝confirm(橙) バッジ、承認済＝done(緑)。アラート濫用を避け、割込み Modal にはしない（中断型は重大かつ患者固有のみ）。
- 承認時に根拠（元終了日 / スライド先 / 休業日 / 上乗せ日数 / 承認者）を監査記録（§7）。

### 13.4 「今日動けるチーム」ダッシュボード（healthcare scheduling 定番）

- スケジュール画面トップに **「本日: 薬局=営業/短縮/休業」＋「動ける担当者一覧（シフト内）」＋「当番（オンコール）」** の固定サマリー（at-a-glance）。スクロールせず「今日は誰がどの患者に行けるか」を判断できる。
- 訪問可否は §12.4 の `canVisitOn`（薬局稼働 ∧ シフト内）で算出し、**シフト外/休業日は理由つきで非選択化**（override は理由必須・監査）。

### 13.5 モバイル / フィールド最適化

- 在宅訪問中（屋外・片手）を想定: プライマリアクション（スライド承認・訪問記録）は下部 thumb zone、タッチ 44px 以上、コントラスト 4.5:1 超。
- 月グリッドはモバイルで横スクロールさせず、**週リスト/縦スクロール**へ段階的に縮約（ガイドライン「画面サイズ追従」）。
- オフライン（PWA + Dexie）でも「今日の稼働状態 / 自分のシフト」は参照可能にする（営業時間・当日シフトはキャッシュ対象）。

### 13.6 アクセシビリティ / 数値表現

- 営業時間・点数・上乗せ日数など数字は **等幅数字（tabular-nums）** で縦揃え（誤読防止）。
- 状態は色のみに依存せずアイコン＋ラベル併記。フォーカス可視・WCAG AA。
- ローディングはスケルトン（カレンダー形状を保持）、スピナー単独は不可。

---

## 14. ベストプラクティス / 参考文献（インターネット調査 2026-06-27）

実装方針の裏付けとして外部ベストプラクティスを調査。**医療コンプラ上、外部ネットワーク依存（egress）を持ち込まない**ことを最優先とし、ライブラリは「ローカル同梱・ネットワーク非依存」のものに限定する。

### 14.1 日本の祝日算出（法定休日の自動設定 — §4.2 / Q7）

- **手書きしない:** 春分/秋分（天文計算で年変動）・振替休日・国民の休日（祝日に挟まれた平日）は規則が複雑で、自前計算はバグの温床。**実績あるライブラリ or 内閣府公表データに委ねる**のが定石。
- **候補（いずれも npm ローカルパッケージ＝実行時ネットワーク非依存）:**
  - `@holiday-jp/holiday_jp` — 内閣府データ由来、`between(start, end)` で期間内祝日を取得。データ同梱型。**最新 2.5.1**（外部確認済）。
  - `japanese-holidays` — **別パッケージ**（`@holiday-jp/japanese-holidays` ではない、表記混同に注意）。振替休日/国民の休日を**算出**、`furikae:false` 等のオプション。
  - `date-holidays` — 多国対応（日本含む）。汎用だが大きめ。
- **推奨:** データ同梱型（`@holiday-jp/holiday_jp`）を一次採用し、§4.2 で `BusinessHoliday(holiday_type='public_holiday')` へ年次取込。**毎年の更新運用＋手動上書きを前提**にし、自動完結にしない（祝日法改正・臨時の祝日に追従するため）。外部API直叩きは egress 懸念のため**不採用**。
- **依存追加ゲート（Codex review #6）:** version pin（2.5.1）/ ライセンス確認 / bundle size 確認 / **年次データ・パッケージ更新ゲート** / **既知年フィクスチャテスト（振替休日・国民の休日・春分/秋分）** を必須化。runtime のネットワーク egress は禁止のまま。最終的な依存追加は通常の依存追加レビューを通す。

### 14.2 営業日計算（稼働日 ±n / スライド — §3）

- **`date-fns` の `addBusinessDays` は週末のみ考慮し、祝日・薬局休業日を考慮しない。** そのまま使うと休業日をまたいで誤計算する。
- **定石:** 「祝日・休業日リストを保持し、1 日ずつ進めて週末＋休業日をスキップする」カスタム反復（まさに §3 の `addOperatingDays` / `nearestOperatingDay`）。ラッパ系（`@alanszp/business-days-date-fns` 等）もあるが、PH-OS は**拠点別の営業時間＋臨時営業まで含む独自カレンダー**が必要なため**自前 util が正解**（調査が §3 設計を裏付け）。
- 無限ループ防止に `maxScan` 上限を必ず持つ（§3 で実装済み方針）。

### 14.3 休業/連休をまたぐ服薬の臨床プラクティス（前倒し原則の裏付け — §5.2 / Q4）

- 海外薬局の標準運用: **連休前は早めに補充（forward supply / refill ahead of closure）**、**リフィルは薬切れの 7〜10 日前バッファ**、長期休暇は **bridge supply（15〜30 日のつなぎ）** と **early refill override**。
- これは PLAN の **「前倒し（backward スライド＝薬切れ防止）を原則」** を直接支持する。連休をまたぐ場合は不足分を**日数上乗せ調剤**（§5.2）。
- **注意（規制薬・強化 / Codex review #7）:** 上記は**海外の慣行であり、日本の麻薬・向精神薬へ直接外挿しない。** 早期補充/つなぎ調剤には日本独自の法的制約がある。PH-OS は既存フラグ `DrugMaster.is_narcotic` / `is_psychotropic`（`drug.prisma:68-69`）を検知根拠に持つため、**麻薬・向精神薬・分類未解決の品目は自動スライド/数量上乗せ提案を出さず（UI に候補も出さない）、サーバ側も auto-apply を拒否**して「薬剤師＋法令/施設ポリシー確認」タスクに落とす（§5.2 に契約として明記済）。

### 14.4 医療スケジューリングの UX 定番（§13 の裏付け）

- 調査で繰り返し挙がった有効パターン: **色分けカレンダー（PC＋モバイル）/ 「今日誰が稼働か」中央ダッシュボード / 空きセルをクリックして作成（ポップアップ）/ ドラッグ&ドロップ配置 / カレンダー内で空き状況を参照可能 / 一括承認 / 繰り返し予定用のカスタム時間ピッカー**。
- §13.1（色分け月グリッド）・§13.4（今日動けるチーム）・§13.2（一括プリセット＋確認/undo）はこれらに対応。**ドラッグ&ドロップ / 空きセル作成**は初版必須ではなく、§13.1 の Drawer 編集で MVP を満たし、ドラッグ操作は後続スライス（Q9）。

### 14.5 参考（要旨）

- Japanese holiday libs: `@holiday-jp/holiday_jp`（between / データ同梱）, `japanese-holidays`（振替・国民の休日算出, furikae オプション）, `date-holidays`（多国）。
- date-fns business days: `addBusinessDays` は週末のみ → 祝日対応はカスタム反復が必要。
- 服薬リフィル: forward supply / refill buffer 7–10 日 / bridge supply 15–30 日 / 連休前倒し / 規制薬は別扱い。
- Healthcare scheduling UX: 色分け・中央ダッシュボード・クリック作成・ドラッグ配置・一括承認・カスタム時間ピッカー。

> 注: 上記ライブラリは**実行時にネットワークへ出ない**もの（データ同梱/算出）に限り採用候補とする。最終的な依存追加は通常の依存追加レビュー（バージョン固定・ライセンス確認）を通す。
