# 稼働日カレンダー基盤 — 詳細設計 (PLAN)

**Status:** DRAFT (Claude 起案 / Codex レビュー待ち / 実装前)
**Author:** Claude (Opus 4.8) — 2026-06-27
**Scope:** 休日管理派生機能の **土台** = 「薬局の稼働日とは何か」を定義するデータモデル・営業日計算ユーティリティ・API・連携契約。
ダウンストリーム機能（服薬終了日スライド / 緊急オンコール当番 / 算定加算）は本 PLAN では **契約（インタフェース）のみ**定義し、詳細設計は後続 PLAN に分割する。

関連レビュー: 「休日管理派生機能 — 機能網羅性レビュー」(2026-06-27, agmsg)。
SSOT: 本 PLAN 承認後、`.agent-loop/FEATURE_QUEUE.md` にタスク分割を登録。

---

## 0. 前提（実調査済みの現状）

| 領域 | 現状 | 根拠 |
|---|---|---|
| 休業日マスタ | `BusinessHoliday`(date/name/holiday_type∈{public_holiday,site_closure,org_event}/is_closed/site_id) | `prisma/schema/organization.prisma:326-340` |
| 薬局の営業曜日/営業時間 | **無し**（`PharmacySite` に hours/定休フィールド無し） | `organization.prisma:101-130` |
| 薬剤師シフト | `PharmacistShift`(個別日) + `PharmacistShiftTemplate`(週次) | `organization.prisma:287-324` |
| 訪問生成の休業日考慮 | `planner`(提案)=有 / `generate`(直接)=**無** | `visit-schedule-planner.ts:878-1059` / `visit-schedules/generate/route.ts` |
| 服薬終了日 | `end = start + (days-1)` 純カレンダー、休業日連動ゼロ | `use-workbench-write-handlers.ts:350-356` |
| 在庫予測 | 固定7日、休業日無視 | `lib/analytics/inventory-forecast.ts` |
| 日付util | 整形のみ（営業日計算なし、UTCベース） | `lib/date-key.ts` |

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

---

## 3. 営業日計算ユーティリティ（pure / server+client 共有）

**配置:** `src/lib/calendar/operating-day.ts`（純関数、DB 非依存。入力に解決済みデータを渡す＝テスト容易）。
**重要:** 既存 `date-key.ts` は UTC ベース。営業日計算は **JST(Asia/Tokyo) の暦日**で判定する（日跨ぎ事故防止）。`date-key` の `YYYY-MM-DD` 文字列を一次キーにし、Date オブジェクト演算を避ける。

```ts
export type OperatingHoursRow = { weekday: number; is_open: boolean; open_time: string | null; close_time: string | null };
export type HolidayRow = { date: string; site_id: string | null; is_closed: boolean; open_time?: string | null; close_time?: string | null };
export type OperatingCalendar = {
  siteId: string;
  weekly: OperatingHoursRow[];          // 最大7
  holidays: Map<string, HolidayRow[]>;  // dateKey -> rows（site一致 or null）
};

/** D は 'YYYY-MM-DD'（JST暦日キー）。 */
export function resolveOperatingState(cal: OperatingCalendar, dateKey: string):
  | { open: false; reason: 'holiday' | 'regular_closed' }
  | { open: true; from: string | null; to: string | null; source: 'holiday' | 'weekly' | 'default' };

export function isOperatingDay(cal: OperatingCalendar, dateKey: string): boolean;

/** 起点から direction 方向で最も近い稼働日を返す（起点が稼働日ならそのまま）。 */
export function nearestOperatingDay(cal: OperatingCalendar, dateKey: string, direction: 'backward' | 'forward'): string;

/** 稼働日を n 日進める/戻す（営業日のみカウント）。安全上限 maxScan で無限ループ防止。 */
export function addOperatingDays(cal: OperatingCalendar, dateKey: string, n: number): string | null;
```
- `nearestOperatingDay` は無限ループ防止に **maxScan（例 366 日）** を持ち、超過時は `null`/起点を返し呼び出し側でハンドリング。
- 全拠点休業（`site_id=null` の is_closed=true）も holidays Map に含める（既存 planner と同じ解決）。

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

---

## 5. 連携契約（consumers — 本 PLAN では契約のみ、実装は後続スライス）

### 5.1 `visit-schedules/generate`（直接生成）に休業日チェック追加
- `planner` と同じ判定（`resolveOperatingState`）を `generate` にも適用し、**経路間の不整合を解消**。
- 既定はソフト警告ではなく**ブロック**（既存 generate はシフト休みをエラーで弾く方針に合わせる）。ただし **override（理由必須・監査記録）** を許可し、緊急時のシフト外/休業日訪問を可能にする（§5.4 緊急と接続）。

### 5.2 服薬終了日スライド（後続 PLAN で詳細化、ここは契約）
- 計算は `nearestOperatingDay(cal, endKey, 'backward')` を**原則（前倒し＝薬切れ防止）**。連休をまたぐ場合は不足分を**日数上乗せ調剤**（医療判断）。
- **自動確定しない。** 「スライド提案」を提示し**薬剤師承認**で確定。承認時に根拠（元終了日 / スライド先 / 該当休業日）を監査記録。
- 影響先: 次回調剤日 / 次回訪問 / `inventory-forecast`。

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

| # | スライス | owner（案） | 種別 | hard-stop |
|---|---|---|---|---|
| S1 | 営業日計算util `operating-day.ts` + テスト（純関数のみ、DB非依存） | Claude | FE/共有util | なし |
| S2 | `PharmacyOperatingHours` モデル + migration + seed | Codex(API/DB) | backend | **migration 承認要** |
| S3 | `/api/pharmacy-operating-hours` GET/PUT + no-store + tests | Codex | backend | なし(S2後) |
| S4 | 営業時間マスタ管理 UI（admin、business-holidays 近接 or 統合） | Claude | FE | なし |
| S5 | 祝日取込 API + プリセット + UI（確認/取消） | Codex+Claude | 両 | egress判断(§11-Q3) |
| S6 | generate 休業日チェック + override（planner と整合） | Codex | backend | なし |
| S7+ | 服薬スライド / inventory / オンコール / 算定（後続 PLAN へ） | — | — | 個別 |

- S1 は依存なしで即着手可能（純関数）。S2 が DB 承認待ちでも S1 を先行できる。
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

- **Q1:** 短縮/臨時営業（§2.2 の BusinessHoliday open/close 列）を初版に含めるか、MVP は is_closed boolean のみか。
- **Q2:** operating-hours 未設定拠点のフォールバック（全日営業 vs 強制初期設定）。
- **Q3:** 祝日データソース（同梱CSV / 算出 / ハイブリッド）と更新運用。egress 制約との整合。
- **Q4:** スライド方向の既定（前倒し原則で合意か。後ろ倒しを許す業務ケースはあるか）。
- **Q5:** 営業時間マスタ UI は `business-holidays` に統合するか独立ページか。
- **Q6:** `PharmacistShiftTemplate` と `PharmacyOperatingHours` の責務分離の最終確認（薬局営業 vs 個人勤務）。
