# 調剤ワークベンチ（レセコン風）完全置き換え 計画書

> 出典設計: Claude Design 配布バンドル `調剤ワークベンチ.dc.html`（1,091行・単一 `DCLogic` 派生 Component）
> 方針確定（ユーザー決定）: **段階的（まず忠実なビジュアル移植・モックデータで動作）／4ルート分割（/dispense /audit /set /set-audit）／二重実装を残さない完全置き換え**。レイアウトは**ワークベンチ4業務画面がデスクトップ高密度（min-width:1540px・height:100vh 忠実再現）**、テーマ（Meiryo・青グラデ）は**アプリ全体**適用（§9 Q3）、狭幅挙動は §9 Q5 で別途。
> ステータス: **計画のみ。実装未着手。** 主要なリスク前提は実コードで裏取り済み（2026-06-16）。

---

## 1. 実現可能性（結論）

**可能。** 設計は自己完結の4工程レセコン風プロトタイプで、HTML/CSS/JS の素の実装＋独自テンプレートエンジン（`sc-for`/`sc-if`）。これを React（Next 16 / React 19）へ忠実移植する。最大の論点は次の3点で、いずれも本計画で吸収する:

1. **設計は4工程を内部 `setState` で切り替える単一画面**。本タスクは **4ルート分割**なので `phase` を props で注入し、フェーズタブを `<Link>` ナビに置換する。
2. **二重実装の回避** = 旧 `dispense-workbench` / `audit-workbench` / `set-workspace` と旧ルート（`/auditing` `/medication-sets`）を撤去し、全参照を新ルートへ更新する。`/api/*` の API エンドポイントはページルートと別物なので**改名しない**。
3. **ルート改名で壊れる参照が src 配下50ファイル超 + E2E に分散**。網羅リスト（§5）で一括更新する。

段階的方針に沿い、データ取得は**アダプタ1点（`*.adapter.ts`）に閉じ込め**、現状はモック（seed）を返す。実 API 結線は次フェーズでアダプタ内部を差し替えるだけにする。

---

## 2. ルートマップ

| 旧                                                                        | 新           | アクション | 内容                                                                                                                  |
| ------------------------------------------------------------------------- | ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `/dispense`                                                               | `/dispense`  | **維持**   | 中身を旧 `dispense-workbench.tsx`（API駆動3ペイン）から新レセコン風 `DispensingWorkbench phase="dispense"` に差し替え |
| `/auditing`                                                               | `/audit`     | **改名**   | ディレクトリ移設。`phase="audit"` をマウント                                                                          |
| `/medication-sets`                                                        | `/set`       | **改名**   | ディレクトリ移設。`phase="setp"`（お薬カレンダー）をマウント                                                          |
| （なし）                                                                  | `/set-audit` | **新設**   | `phase="seta"`（セット監査）。現状セット監査 UI は実質未実装のため、設計の `isSeta` ペイン移植で初めて実体化          |
| `/api/dispense-audits`, `/api/medication-sets/workspace`, `/api/set-*` 等 | 同一         | **維持**   | API エンドポイントは改名しない。レスポンス内に埋め込まれた `href` 値（`/auditing`等）のみ新ルート文字列へ更新         |

工程タブ（調剤 → 調剤監査 → セット → セット監査）と F8〜F11 は4ルートへの `<Link>`/`router.push`。F12「次工程へ」は `calcGate()` 通過時のみ次ルートへ遷移。

---

## 3. コンポーネント設計（単一実装＝二重実装ゼロの中核）

```
src/components/features/dispense-workbench/
  dispensing-workbench.tsx        ← 入口。props { phase }。state/ハンドラ統括
  phase-tabs.tsx                  ← /dispense /audit /set /set-audit への <Link>（現 phase を active）
  patient-list-panel.tsx          ← 左ペイン(212px)：処方登録患者・並び替え・F3/F4 前後ナビ
  prescription-grid.tsx           ← 中央 Grid(phase=dispense|audit)：D&D グループ移動・服用終了日自動計算・進捗
  medication-calendar-grid.tsx    ← 中央 Calendar(phase=setp|seta)：7日×用法セル・完了ゲート
  right-pane.tsx                  ← 右ペイン(300px)：isGrid=患者情報 / isSet=セット作業 / isSeta=セット監査
  hold-reason-dialog.tsx          ← 保留理由モーダル（理由必須・期限・担当・メモ）
  prescription-compare-dialog.tsx ← 前回処方比較モーダル（継続/新規/変更/中止）
  dispensing-workbench.seed.ts    ← 8名分モック + 型 + sec()/d() ファクトリ
  dispensing-workbench.logic.ts   ← ピュア関数（buildModel/calc/calcGate/comparison/formOf/dailyDose/mapTiming/endDate/otherTiming/packetKeys）
  dispensing-workbench.types.ts   ← カレンダー系型 SSOT（CalendarCell/CellState/HoldDraft/NgCode 等）
  dispensing-workbench.adapter.ts ← データ取得境界（現状 seed を返す。将来 fetch 置換）
  dispensing-workbench.module.css ← 忠実再現スタイル（Meiryo/帯高さ/ペイン幅/配色/zebra）
  dispensing-workbench.logic.test.ts
  dispensing-workbench.test.tsx
```

4つの `page.tsx` は薄く、phase だけ変えて同一 component をマウント:

```tsx
<DispensingWorkbench phase="dispense" />   // /dispense
<DispensingWorkbench phase="audit" />      // /audit
<DispensingWorkbench phase="setp" />       // /set
<DispensingWorkbench phase="seta" />       // /set-audit
```

**状態管理（Q1 確定: リロード越えても保持）**: 設計の state（`selId/sortMode/done/audit/setCells/auditCells/outChk/checks/ng/target/holdModal/holdInfo/packet/compareOpen`）を **Zustand ストア + persist ミドルウェア**で保持し、4ルート間の遷移でもブラウザ再読込でも作業状態を維持する（`zustand@5` は既存スタック）。

- 段階1（モック）: `persist` の storage は `localStorage`（または既存の Dexie/IndexedDB）。患者ごと・工程ごとにキー分離（例 `wb:{patientId}:{phase}`）。
- **PHI/コンプライアンス注意**: 作業状態には将来的に要配慮個人情報（薬剤・患者）が含まれる。実データ結線フェーズでは平文 `localStorage` ではなく、既存の `ENCRYPTION_KEY`（AES-GCM）+ IndexedDB（Dexie, `dexie@4.3.0`）の暗号化パターンに載せること（CLAUDE.md「IndexedDB PHI encryption」準拠）。段階1はモックなので平文可だが、ストア境界（`workbench-store.ts`）を分離して後で storage 実装だけ差し替え可能にする。

**レイアウト干渉の回避**（裏取り済み: AppHeader = `min-h-14` = 56px）:

- `PageScaffold variant="bare"` でも外側 padding（`p-2..xl:p-5`）と `min-h-full` が常時付与され `calc(100vh-3.5rem)` 忠実再現と干渉する。→ **`className="p-0 min-h-0"` で完全中和**するか、**ワークベンチ4 page は PageScaffold を介さず専用 full-height ラッパで直接マウント**のいずれかを採用（要明示）
- 本体ルート div: `h-[calc(100vh-3.5rem)] overflow-hidden` + 内部ペインに `overflow-y-auto`
- 控除高 `3.5rem` は AppHeader 実値（`min-h-14`）に固定し**単一変更点**として CSS Module 定数 / 共有 className で一元化、`loading.tsx` も揃える（レイアウトシフト防止）
- 横は `min-width:1540px`。`MobileOrientationGuard` は <768px のみ動作しデスクトップでは無干渉

---

## 4. モックデータ層と実 API 差し替え境界

2層構成（UI fixtures + アダプタ1点集約）。Prisma seed への流し込みは結線フェーズへ先送り。

- **seed 層**: `buildPatients()` をそのまま移植した8名分 TS 定数。日付は ISO 文字列のまま。カレンダーは 2026/6/17〜6/23 固定（設計準拠）。
- **アダプタ層**: `loadPatients()` / `loadWorkbench(phase, patientId)` / `loadCalendar(patientId)`。内部は `if (USE_MOCK) return fromSeed(...)` のみ。component はアダプタのみ呼ぶ。
- **将来の差し替え先**（データ契約ギャップ分析より）:
  - グリッド工程: 既存 `GET /api/dispense-tasks/[id]/workbench`（`DispenseWorkbenchData`）でほぼ充足。
  - カレンダー工程: **新規 `GET /api/set-plans/[id]/calendar` が必要**（現状 `/api/set-batches` はフラット配列のみ）。
  - セル状態（set/hold/OK/NG）の永続化: **SetBatch にセル状態列が無い** → 段階1は UI 一時状態。スキーマ追加は将来課題。
  - NG分類: 設計14種 vs 既存 `DispenseAudit.reject_reason_code` 6種 → セット監査側コード拡充が将来必要。

**規律**: fixtures は必ずアダプタの戻り型（= `types.ts`/既存 `.shared.ts` の公開型）に整形して返す。設計独自構造のまま持つと結線時に変換層が増え二重実装化する。

---

## 5. 完全置き換え：ファイル操作一覧

### 5-1. 新規作成（主要）

- 共有 component 一式（§3 の13ファイル）
- `src/app/(dashboard)/audit/{page,loading,error}.tsx`
- `src/app/(dashboard)/set/{page,loading,error}.tsx`
- `src/app/(dashboard)/set-audit/{page,loading,error}.tsx`

### 5-2. 削除（旧実装・二重実装の元）

- `dispense/dispense-workbench.tsx` + `dispense-workbench.test.tsx`
- `auditing/audit-workbench.tsx` + `audit-workbench.test.tsx` + `auditing/{page,loading,error}.tsx`
- `medication-sets/set-workspace.tsx` + `set-workspace.test.tsx` + `medication-sets/{page,loading,error}.tsx`

### 5-3. keep（削除しない／外部 import あり・裏取り済み）

- **`src/lib/dispensing/dispense-workbench-shared.ts`** ← `components/features/dispense/medication-format-grid.tsx` が依存（削除対象外）
- **`dispense/dispense-work-queue.shared.tsx`** ← `prescriptions/prescriptions-workspace.tsx` が依存
- **`src/lib/dispensing/set-workspace-shared.ts`** ← `api/medication-sets/workspace/route.ts` と `src/lib/dispensing/set-derivations.ts` が依存

### 5-4. ルート参照の一括更新（改名で壊れる箇所）

**重要切り分け**: `/api/...` を含む API パスは改名しない。ページルートの `href`/`actionHref`/`Link`/`startsWith` の**先頭スラッシュ付き文字列のみ**対象。`WorkflowPhaseKey` union（`'auditing'`/`'medication_sets'`）・shortcut scope・queryKey・config key などの**同名トークン（スラッシュ無し）は改名禁止**（巻き込み事故防止）。

**非テスト（本体）**:

- `src/proxy.ts` — `PROTECTED_ROUTE_PREFIXES`: `/auditing→/audit`, `/medication-sets→/set`, **`/set-audit` を追加**（漏れると未保護ルート=コンプライアンス退行）。`/dispense` 維持
- `src/lib/navigation/route-labels.ts` — **2系統を更新**: ① `PATH_LABELS` 正規表現 `/^\/auditing/→/^\/audit/`・`/^\/medication-sets/→/^\/set/`＋新規 `/^\/set-audit/`（正規表現 `^/set(/.*)?$` は `/set-audit` に非一致だが、評価順で `/set-audit` を先に置く）。② **`SEGMENT_LABELS`（フラット object・順序概念なし）**: `'auditing'→'audit'`（既存 `'audit':'監査'` と統合確認）・`'medication-sets'→'set'`＋新規 `'set-audit':'セット監査'`。③ `labelForSegment` の `previous` 分岐（`'auditing'→`・`'medication-sets'→`）を audit/set/set-audit へ追随。ラベル文言（`調剤鑑査` vs `監査`）の統一方針を確定
- `src/components/layout/navigation-config.ts` — 監査 href→`/audit`, セット href→`/set`、**『セット監査』ナビ項目 `{label:'セット監査', href:'/set-audit', icon:ClipboardCheck}` を「セット」の直後に追加（Q2 確定: 調剤・監査と対称）**。`navigation-config.test.ts` の `.toEqual` を同時更新
- `src/components/layout/use-nav-badges.ts` — バッジキー `/auditing→/audit`（navigation-config と同期必須・不一致でバッジ消失）
- **`src/lib/hooks/use-workflow-phase-access.ts`（最重要）** — `startsWith('/auditing')→'/audit'`、`startsWith('/medication-sets')` を **`startsWith('/set') && !startsWith('/set-audit')` に厳密化**、`setAudits` を `[]` 固定から `startsWith('/set-audit')` フィルタへ置換。href 群（:275/:286/:297/:305/:315）を新ルートへ
- `src/lib/dashboard/home-config.ts`, `src/server/services/{home-care-ops,today-ops-rail,patient-detail-workspace}.ts`, `src/lib/workflow/blocked-reason-projection.ts`, `src/lib/prescription/cycle-workspace.ts`, `src/lib/workspace/daily-ops-rail.ts`, `src/lib/tasks/operational-task-presentation.ts`, `src/lib/views/saved-filter-views.ts` — 各 href
- `src/components/features/workflow/main-workflow-route.tsx`, `src/components/features/admin/admin-page-shortcut-presets.ts`
- 画面: `my-day-content`, `dashboard-cockpit`, `schedule-team-board(+helpers)`, `visits-today`, `handoff-workspace.helpers`, `settings/operational-policy-content`, `patients-board`, `prescriptions/intake/intake-triage.shared`, `reports/report-share-workspace.helpers`
- API レスポンス内 href 値のみ: `visits/today-preparation`, `medication-sets/workspace`, `dispense-results`, `patients/board`, `comments`
- `src/lib/settings/system-settings-inventory.ts` — evidence の物理パス文字列（ビルドは通るので見落とし注意）

**テスト（本体と同時更新・約20本）**:

- `navigation-config.test.ts`, `sidebar.test.tsx`, `home-config.test.ts`, `saved-filter-views.test.ts`, `operational-task-presentation.test.ts`, `daily-ops-rail.test.ts`, `use-workflow-phase-access.test.ts`（**/set vs /set-audit 振り分け検証を追加**）, `patients-board.test.tsx`, `[id]/card-workspace.test.tsx`, `compare/compare-card-helpers.test.ts`, `visits-today.test.tsx`, `billing-check-content.test.tsx`, `master-hub-content.test.tsx`, `schedule-team-board.test.tsx`, `operational-policy-content.test.tsx`, `views/saved-views-content.test.tsx`, `admin-page-shortcut-presets.test.ts`, `today-ops-rail.test.ts`, `patient-detail-workspace.test.ts`, `api/medication-sets/workspace/route.test.ts`, `api/dispense-results/route.test.ts`, **`route-labels.test.ts`（SEGMENT_LABELS/labelForSegment 改修の回帰基盤・新セグメント audit/set/set-audit の breadcrumb 検証を追加）**

**E2E（tools/tests, Playwright）** ⚠️ **最重要（放置すると design-fidelity E2E が route解決失敗＋selectorタイムアウトで総崩れ）**:

- **`design-screen-map.ts`（網羅必須）**: `new_08_audit`（`/auditing→/audit`）・`new_09_set`（`/medication-sets→/set`）・`p0_13_dispensing_audit`（`/auditing→/audit`）・`p0_14_set_preparation`（`/medication-sets→/set`）・`p0_15_set_audit`（route を `/set-audit` 独立化）。grep 追加検出の `/auditing`（:664 付近）も棚卸し
- **削除コンポーネント固有 testid の置換**: 旧 `audit-queue-row`（audit-workbench.tsx:216）/ `audit-count-table`（:294）/ `two-person-banner`（:806）/ `set-workspace-row`（set-workspace.tsx:259）は §5-2 で削除されるため、新 `DispensingWorkbench` の実 testid（sidebar slug 由来 `sidebar-nav-{slug}` 等）へ置換。**新旧 testid 対応表を作成**
- `ui-major-screens.spec.ts`, `ui-mobile-layout.spec.ts`, `ui-audit-extensions.spec.ts`（testid `sidebar-nav-audit/-set/-set-audit`）, `ui-workflow-flow.spec.ts`, `e2e-prescription-dispensing-flow.spec.ts`

---

## 6. テスト方針（旧UI参照テストを残さない）

- **削除**: `dispense-workbench.test.tsx`(6) / `audit-workbench.test.tsx`(7) / `set-workspace.test.tsx`(8)。旧UIを参照し続けるグリーンテストは旧実装の存在を保証し二重実装検知を無効化する。
- **新規**: `dispensing-workbench.logic.test.ts`（最優先：endDate/mapTiming/calc/calcGate/comparison/formOf/buildModel）+ `dispensing-workbench.test.tsx`（4 phase で Grid/Calendar 切替・D&D・服用終了日自動計算・ゲート無効化・モーダル開閉）。
- **維持**: `src/lib/dispensing/dispense-workbench-shared.test.ts` / `dispense-work-queue.shared.test.tsx`（対応 shared を keep するため）。
- **検証**: `pnpm build`（tsc で .shared 移設の import 漏れ検知）→ `pnpm test` → `grep -rn '/auditing\|/medication-sets' src tools --glob '!**/.artifacts/**'` で残骸ゼロ確認（`tools/tests/.artifacts/design-fidelity/capture-report.json` 等の生成物は除外、または E2E 再生成後に確認）→ `pnpm test:e2e`。

---

## 7. リスクと対策（要点）

| リスク                                                                                                                                                                                                                                                             | 対策                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/set` が `/set-audit` に前方一致**し誤分類（実発生は ① `use-workflow-phase-access` の trailing-slash 無し `startsWith`、② route-labels の正規表現 `^/set(/.*)?$`。**proxy.ts は `${prefix}/` 比較のため誤包含しない**＝ただし `/set-audit` の別登録自体は必須） | ① `startsWith('/set') && !startsWith('/set-audit')` に厳密化＋`setAudits` フィルタ追加、② 正規表現は `/set-audit` を先に評価（SEGMENT_LABELS はフラット lookup で順序概念なし）。振り分け検証テスト追加 |
| **3つの shared を誤削除**すると tsc/build が広範に破損                                                                                                                                                                                                             | shared は全て keep（dispense/set の共通定義は `src/lib/dispensing` 配下）。削除は本体 .tsx と本体専用テストに限定                                                                                       |
| proxy.ts / route-labels / use-nav-badges は専用テストが薄く、漏れると**認証外れ・ラベル無し・バッジ消失が静かに発生**                                                                                                                                              | §5 網羅リストで一括更新 + 手動チェックリスト + 最後に grep で残骸ゼロ                                                                                                                                   |
| AppShell 配下で `height:100vh` がヘッダ56px ぶん**二重スクロール**                                                                                                                                                                                                 | `PageScaffold bare` + `h-[calc(100vh-3.5rem)]` + 内部ペインスクロール。控除高を一元化                                                                                                                   |
| **セット監査 UI が実質未実装**・セル状態永続化スキーマが皆無                                                                                                                                                                                                       | 段階1は設計 `isSeta` を忠実移植しモックで完結。実API（`/api/set-plans/[id]/calendar` 新設・SetBatch セル状態列・NG14種）は次フェーズ                                                                    |
| フォント(Meiryo)/配色 を `ui-ux-design-guidelines`（Noto Sans JP）から変更                                                                                                                                                                                         | **Q3確定: globals.css/Tailwind テーマでアプリ全体適用**（高密度レセコンレイアウトは業務画面限定）。WCAG AA（4.5:1）維持。guidelines 改訂とE2Eスクショ基準更新を伴う                                     |
| WCAG AA 退行（div+onClick 擬似ボタン・色のみ依存）                                                                                                                                                                                                                 | 移植時に `button`/`role`+キーボード操作可、状態色にアイコン/テキスト併用、モーダルは shadcn Dialog                                                                                                      |
| 4ルート分割で工程横断状態が再マウントでリセットされる懸念                                                                                                                                                                                                          | **Q1確定: Zustand+persist で工程横断・リロード越えに作業状態を保持**（キー分離 `wb:{patientId}:{phase}`）。患者選択は `?patientId=` を初期 selId 復元 hint とし URL>store 優先                          |
| 旧 `Notification.link` に永続化された `/auditing?taskId=` が改名で **dead link 化**（`dispense-results/route.ts:574` は API レスポンス href でなく**永続カラム書込**）                                                                                             | 既存通知の `/auditing→/audit` バックフィルマイグレーション（または旧→新の恒久リダイレクト）を §5-4/§13 に追加。撤去で 404 化                                                                            |
| 作業ツリーに `medication-cycles/[id]/transition` 未コミット変更あり                                                                                                                                                                                                | 実装着手前に内容確認                                                                                                                                                                                    |

---

## 8. 実装手順（順序付き・本計画では未着手）

1. 共有 component の骨格（types/seed/logic/adapter）を新設 + `logic.test.ts` で固定
2. `DispensingWorkbench` 本体 + 子 component 移植（module.css で忠実再現、フェーズタブ `<Link>` 化）
3. AppShell 高さ干渉の解決（控除高一元化）
4. `/dispense` を新 component に差し替え + 旧 `dispense-workbench.{tsx,test}` 削除（shared keep を build で検証）
5. `/auditing → /audit` ディレクトリ改名
6. `/medication-sets → /set` 改名 + `src/lib/dispensing/set-workspace-shared.ts` への API import 追従
7. `/set-audit` 新設 + proxy 保護プレフィックス追加
8. ルート参照の一括更新（非テスト・`use-workflow-phase-access` 厳密化を必ず実施）
9. テスト参照更新・旧UIテスト削除・新 component テスト追加
10. E2E（tools/tests）更新
11. 検証（build → test → grep 残骸ゼロ → e2e → 1540px+ 目視）

---

## 9. 意思決定（確定済み）と残課題

### 確定済み（ユーザー決定 2026-06-16）

- **Q1 作業状態 = リロード越えても保持**: Zustand + persist。段階1は localStorage、実データ結線時は AES-GCM+IndexedDB（§3 参照）。各フェーズは独立画面だが状態は永続。
- **Q2 サイドバー『セット監査』= 出す**: `navigation-config` に `/set-audit` 項目を「セット」の直後へ追加（調剤・監査と対称）。
- **Q3 デザイン = テーマのみアプリ全体適用（確定）**: フォント（Meiryo系）と配色（青グラデ/レセコン系パレット）を `globals.css`/Tailwind v4 CSS-first テーマでアプリ全体に適用する。**高密度レセコンレイアウト（F1〜F12キー・1540px固定・タイトルバー等）はワークベンチ等の業務画面に限定**し、全画面を完全レセコン化はしない（モバイル/shadcn 画面の破綻回避）。影響: ① `ui-ux-design-guidelines.md`（SSOT）の改訂（フォント Noto Sans JP→Meiryo系、配色節を青グラデ/レセコン系に）、② `globals.css`/Tailwind テーマトークン変更、③ スクリーンショットE2E（`tools/tests/ui-*`）の基準更新が広範に必要。WCAG AA（コントラスト4.5:1）は維持。これはワークベンチ4画面とは独立した別ワークストリームとして扱う。
  - **next/font 副作用の明文化**: `--font-sans` の上書きは next/font の最適化（自己ホスト/`font-display`）をバイパスする。Meiryo は Windows 限定のため `font-family` スタックは **Meiryo → Noto Sans JP → system-ui** の段階フォールバックを定義し、`layout.tsx` の `notoSansJP` を予備保持/撤去するか決定する。青グラデでコントラスト 4.5:1 を割らない検証を E2E 基準更新時に併施。

- **Q4 component 配置 = `src/components/features/dispense-workbench/`（確定）**: 既存規約（`src/components/features/dispense/` 等）に一致。§3 の配置パスと §5-3 の set workspace 共通定義配置はこれを基準に一意化（新 component 群＝`components/features/`、共通定義は `src/lib/dispensing`）。
- **Q5 狭幅ガード = モバイルフェーズに送る（確定）**: 今回は入れない。デスクトップ専用前提で 1540px 未満は横スクロール許容。狭幅ガード/モバイルUIは別フェーズ。
- **Q6 旧UI固有ヘルパ = build で importer ゼロ確認後に削除（確定）**: 旧UI本体削除後、`pnpm build`＋grep で他 importer 無しを確認できたデッドコード（`aggregateSetRows`/`sortRowsByRoom`、旧 dispense の安全サマリー/計数判定）のみ削除。二重実装ゼロ方針と整合。
- **Q7 バックエンド連携**: 各コンポーネント単位の結線詳細は **§11 で策定済**（オフライン/競合/監査証跡は §12、結線タスクは §13）。**段階1（モック）では §11 の新設 API（`/api/set-plans/[id]/calendar` 等）は不要**で、結線フェーズで実装する。
- **調剤年月日（§14-4）= 調剤実施日を表示（確定）**: `DispenseResult.dispensed_at` の年月日を workbench レスポンスに追加し「調剤年月日」ラベルで表示（`prescribed_date` 流用ではなく実調剤日）。

### 結線フェーズで確定する事項（実コードを触る段で決定・本計画では先送り）

- workbench GET レスポンス（`DispenseWorkbenchData`）に `cycle.version` を露出させるか（OCC 結線の前提）。
- 競合判定アンカー = `MedicationCycle.version`（集約）か `DispenseResult.version`（行）か。
- オフライン調剤完了を許容するか（許容なら `dispense_results` を Dexie syncQueue 対象に拡張）。
- セル状態のサーバ永続タイミング（完了時一括 vs 途中保存）。
- NG理由14種の enum 化スコープと既存 `reject_reason_code` 6種の統合方針。
- 一人薬剤師（調剤者=監査者）の運用ポリシーと `PHARMACIST_ASSISTANT` のセット権限範囲（RBAC）。

---

## 10. Claude Design データ精読の確認結果（参考: 設計バンドル）

> ユーザー方針: 設計/Excel は**参考程度**。既存コード側を重視し、不足はインターネット調査で補う。

再取得した設計バンドル全体を確認した結論:

- **`調剤ワークベンチ.dc.html`（プロト）が新4画面の SSOT**。`manifest.json` の `p0_12〜15`（dispensing_workbench / dispensing_audit / set_preparation / set_audit）は**旧い3ペイン版**で、既存 PH-OS 実装（`dispense-workbench.tsx` 等）が準拠している版。プロトはそれを大きく超えるレセコン風の最新反復なので、置き換えの視覚ターゲットはプロトに従う。
- **`README_Claude_Fable_5.md` がバックエンド連携の根拠**: 「UIに必要なバックエンド項目が足りなければ 型・mock API・seed data を追加」「**押下後・失敗時・未同期・他スタッフ更新時の挙動まで作る**」。→ §11/§12 の連携設計と挙動設計の出典。
- 患者 Excel（参考）は3シート構成（一包化 / 残薬 / 自動錠剤リスト）。プロトは一包化のみ使用。残薬・自動分包可否は §11 のデータモデル拡張（`ResidualMedication` 連結、`DrugMaster.is_auto_packable`）に反映する程度に留める（深掘りしない）。

---

## 11. コンポーネント別バックエンド連携設計（実データ結線）

> 調査: recon-code 8体が既存バックエンドを精読（Prisma 16モデル・各API・service）。本節は私（メインループ）が統合（ワークフロー統合エージェントが 529 で失敗したため）。
> 凡例: ✅=既存で充足 / 🟡=部分対応（要拡張） / 🔴=未対応（新設要）

### 11-1. 結論サマリ

既存バックエンドは**調剤グリッド工程（dispense/audit）の読み取りは概ね充足**（`/api/dispense-tasks/[id]/workbench` が比較・計数・包装グループ導出まで提供）。2026-06-28 の live repo 突合では、当初未対応だった `PackagingGroup`、`SetBatch` セル状態、`RejectCode`、`CycleHold`、`/api/dispense-tasks/[id]/groups`、`/api/set-plans/[id]/calendar`、`/api/set-plans/[id]/batches/cell`、`/api/set-plans/[id]/batches/bulk-set`、`/api/set-audits` のセル監査は実装済みである。

残る主要不足は「スキーマ/書込 API が無い」よりも、**薬剤・包装・日付・外部連携・周辺業務を横断した構造化粒度が足りない**点に移っている。最大の不足は次の5点:

1. 🟡 **包装・加工指示の構造化が不足** — 一包化、粉砕、PTP、混合は既存の `PackagingMethod` / `packaging_instructions` / `PackagingInstructionTag` で表現できるが、賦形、脱カプ、分包除外、PTP手撒き、粉砕可否などは自由文または粗い分類に残る。
2. 🟡 **薬剤経路・剤形の正規化が不足** — `route` は `internal/external/injection/other`、`dosage_form` は自由文字列。内服薬・外用薬・頓服薬・注射薬の表示/ゲートには使えるが、薬効・保管・自己注射可否・剤形アイコンを安定判定するには DrugMaster 連携の正規化が必要。
3. 🟡 **日付管理の SSOT が分散** — `PrescriptionLine.start_date/end_date/days`、`SetPlan.target_period_*`、`VisitSchedule.medication_*`、`DispenseResult.dispensed_at` が併存。編集 API はあるが、変更時の再計算・再セット・監査差戻し・訪問予定への波及を一貫処理する orchestration が必要。
4. 🟡 **外薬・持出パケットはサーバ検証済みだが、周辺投影が不足** — `set-audits` は外用/注射/頓服/液剤/冷所の同梱証跡を検証できる。一方で、訪問準備・報告・請求・患者カード側へ同じ分類を表示する共通 projection が不足している。
5. 🟡 **オフライン/冪等/外部システム同期は工程別に未完** — 確定 API は OCC と監査ログを持つが、dispense/set/audit の未同期キュー、再送冪等キー、レセコン/電子薬歴/在庫への同期境界は工程横断で整理が必要。

### 11-2. 工程別 連携マトリクス（要点）

#### 調剤（/dispense）グリッド

| UI要素                          | バインド先                                                                   | 状態 | 対応                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 薬品名/用法/処方日数            | `PrescriptionLine` / workbench `count_rows`                                  | ✅   | そのまま                                                                                                                                                                        |
| 朝昼夕眠前の数量                | `prescribed_quantity/days/slots` の機械按分                                  | 🟡   | 端数で「要確認」化。`PrescriptionLine.dose_schedule`(Json) か `PrescriptionLineDoseSlot` 子モデルで時点別実量を保持（構造化データ方針）                                         |
| 剤形アイコン(錠/散/カ/液/外/頓) | `PrescriptionLine.dosage_form`/`DrugMaster.dosage_form`                      | 🟡   | workbench BFF が `dosage_form` を select していない → `WorkbenchCountRow` に追加 + 剤形→アイコン正規化純関数                                                                    |
| 粉砕/賦形/別包/PTPバッジ        | `packaging_instructions`(自由文) + `packaging_instruction_tags`              | 🟡   | 既存タグは冷所/麻薬/半錠/粉砕禁止/別包/一包化/ホッチキス/ラベル。`excipient(賦形)/decapsulation(脱カプ)/exclude_from_unit_dose(分包しない)/ptp/manual_ptp` を追加し構造化       |
| 調剤チェック（行ON/OFF）        | `DispenseResult`（task単位の lines 一括POST）                                | 🟡   | 行単位の即時保存 API は無い。`POST /api/dispense-results` 一括を維持し、チェックは送信対象選択UIに割当（段階1）                                                                 |
| グループ見出しの調剤方法 select | `PackagingGroup` + `DispensingDecision`                                      | ✅🟡 | `POST/PATCH /api/dispense-tasks/[id]/groups` は実装済み。残は FE adapter 結線、PTP/粉砕/混合など method 値域の SSOT 化、監査画面への投影                                        |
| 服用開始日/処方日数→終了日      | `PrescriptionLine.start_date/days`（編集APIなし）/ `SetPlan.target_period_*` | 🟡🔴 | 期間 SoT を確定（CareCase/PrescriptionLine/SetPlan）＋`PATCH /api/prescription-lines/[id]`＋`computeEndDate` 純関数（境界 end=start+days-1 を `generate-batches` の +1 と整合） |
| 行のD&Dグループ移動             | `PATCH /api/dispense-tasks/[id]/groups`                                      | ✅   | OCC 付き行割当 API 実装済み。FE 側は expected_packaging_group_id を必ず送る                                                                                                     |
| ＋新規グループ                  | `POST /api/dispense-tasks/[id]/groups`                                       | ✅   | group_key idempotency / duplicate race recovery 実装済み                                                                                                                        |

#### 調剤監査（/audit）

| UI要素                          | バインド先                              | 状態 | 対応                                                                                                                                                       |
| ------------------------------- | --------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 行の監査OK/未調剤ハイライト     | `DispenseAudit`(task単位, line_id なし) | 🟡   | 行単位監査は読み合わせ進捗としてクライアント状態で扱い task単位 approved に集約（計数証跡は AuditLog 既存）。行単位で残すなら `DispenseAudit.line_id` 追加 |
| 麻薬ダブルカウント(1回目/2回目) | `AuditLog.changes`(Json)                | 🟡   | 構造化が必要なら `DispenseResult.first_count/second_count/count_matched` か `DispenseCountRecord` 子モデル                                                 |
| 二人制（調剤者≠監査者）         | `dispense-audits` の self_audit 拒否    | ✅   | 既存ガード踏襲                                                                                                                                             |

#### セット（/set）お薬カレンダー

| UI要素                                       | バインド先                                                     | 状態 | 対応                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 7日×用法マトリクス                           | `GET /api/set-plans/[id]/calendar`                             | ✅   | matrix + 各セル状態 + completion_gate 実装済み。残は FE adapter 結線と visit/report への共通 projection                                  |
| セル状態（未セット/セット済/保留）           | `SetBatch.set_state/held_*` + cell PATCH/bulk-set              | ✅   | `PATCH /batches/cell` と `POST /batches/bulk-set` 実装済み。保留の due/assigned は `CycleHold` 側と同期方針を決める                      |
| セット方法（カレンダー/BOX/薬袋/施設カート） | `SetPlan.set_method`(配薬リズム) / `PackagingMethod`(包装形態) | 🟡   | 値域が UI と不一致。`SetPlan.dispense_destination`(calendar/box/bag/facility_cart) 新設＋自動判定（`PatientPackagingProfile`＋施設在籍） |
| セット手順4ステップ                          | —                                                              | 🔴   | `SET_PROCEDURE_STEPS` 定数（destination別）を `src/lib/dispensing` に。永続編集要なら `SetProcedureTemplate`                             |
| カレンダー外薬 同梱チェック                  | `VisitPreparation.carry_items_confirmed`(単一ブール)           | 🟡   | 項目別 done を `packet_checklist`(Json) に                                                                                               |
| 訪問持出パケット完成判定                     | —                                                              | 🔴   | `CarryPacket` モデル or `SetPlan.carry_packet_status`(Json)。完成=全 required==done                                                      |
| 一括セット済                                 | `POST /api/set-plans/[id]/batches/bulk-set`                    | ✅   | OCC + 監査ログ + change log 実装済み                                                                                                     |

#### セット監査（/set-audit）

| UI要素                                   | バインド先                                                             | 状態 | 対応                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| セル単位 監査OK/NG/保留                  | `SetBatch.audit_state/ng_code/audited_*` + `set-audits.cell_audits`    | ✅   | セル単位 OK/NG と version conflict は実装済み。保留は set_state hold と `CycleHold` の責務分担を追加設計                                                |
| NG分類14種                               | `RejectCode` + `SetBatch.ng_code`                                      | ✅🟡 | `RejectCode` は実装済み。`DispenseAudit.reject_reason_code` は後方互換の String のままなので語彙統合は将来移行                                          |
| 保留(hold)                               | enum `SetAuditResult`（現状 `approved`/`partial_approved`/`rejected`） | 🔴   | enum `SetAuditResult` に `hold` を追加 or セル状態側で表現（`DispenseAuditResult` は既に `hold`/`emergency_approved` を持つので enum 統一設計の参考に） |
| 監査OK/NGゲート（未監査=0/NG=0で承認可） | `set-audits` POST                                                      | ✅   | 全6項目チェック、外薬/持出パケット証跡、全セル set+ok、部分承認 scope の安全性をサーバ検証                                                              |
| 二人制（セット実施者≠監査者）            | `SetBatch.set_by` + `same_operator_*`                                  | ✅   | 原則拒否。自己監査は理由 + admin 承認の限定例外として監査ログに記録                                                                                     |
| 差戻し(セルをセットへ戻す)               | —                                                                      | 🔴   | セル状態の `ng→pending` 遷移＋`SetBatchChangeLog` に記録                                                                                                |
| 監査証跡写真                             | `SetAudit.photo_asset_ids`(書込のみ)                                   | 🟡   | GET 経路と一覧 API（`GET /api/files?purpose=set-photo&plan_id=`）追加                                                                                   |

#### 共通（患者リスト/リボン/保留/F-key/工程遷移）

| UI要素                             | バインド先                                                                               | 状態 | 対応                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 「処方登録患者」リスト             | `GET /api/dispense-workbench/patients`                                                   | ✅   | phase フィルタ、開始日/登録日/カナ順、set/set-audit のセル進捗込みで実装済み                                                                                 |
| 状態バッジ（監査済/作業中/未着手） | `MedicationCycle.overall_status`(16値)                                                   | 🟡   | `deriveListBadge()` 純関数（16→3値マッピング）                                                                                                               |
| 患者番号                           | —                                                                                        | 🔴   | `Patient.patient_number`(org内ユニーク, 採番) 追加。暫定は id 表示                                                                                           |
| 区分（在宅訪問）                   | `Residence.facility_id` 有無の間接導出                                                   | 🟡   | `CareCase.visit_type` enum 追加 or 正規化純関数                                                                                                              |
| 主たる調剤方法/予製可否/申し送り   | `PatientPackagingProfile`(予製可否・申し送り列なし)                                      | 🟡   | `prefab_allowed`/`handover_note` 追加＋**RLSポリシー追加**（現状 PatientPackagingProfile に RLS 未設定）                                                     |
| 保留（理由7種/期限/担当/メモ）     | `CycleHold` + `SetBatch.set_state=hold` + `WorkflowException`                            | 🟡   | モデルは実装済み。必要なのは phase 共通の CRUD/BFF、期限/担当の UI、SetBatch hold との同期、WorkflowException との二重管理整理                               |
| F7 保留                            | dispense=`WorkflowException`起票(cycle は dispensing のまま) / audit・set=`on_hold` 遷移 | 🟡   | 工程別に分岐。意味統一なら dispensing→on_hold 遷移を許可（`ALLOWED_TRANSITIONS` は既に許可）                                                                 |
| F12 次工程へ                       | 各完了API / `transition`                                                                 | 🟡   | **F12=工程完了は必ず各完了API（dispense-results/dispense-audits/set-audits）経由**。`transition` 直叩きで副作用（記録・通知・carry_items）をスキップさせない |
| ステータスバー（調剤者/監査者）    | `DispenseResult.dispensed_by`/`DispenseAudit.audited_by`                                 | 🟡   | set工程は `SetBatch.set_by`(新設) が必要                                                                                                                     |

### 11-3. 新設 API サーフェス（まとめ）

1. `GET /api/dispense-workbench/patients` — 患者中心リスト（最新サイクル状態＋開始日＋バッジ、ソート） **実装済み**
2. 患者リボン/右ペイン BFF（患者属性＋最新 intake＋SetPlan 期間＋区分＋主たる調剤方法＋予製＋申し送り）or workbench 拡張
3. `POST/PATCH /api/dispense-tasks/[id]/groups` — グループ CRUD＋行割当（D&D・新規グループ・方法変更） **実装済み**
4. `PATCH /api/prescription-lines/[id]`（or intake/[id]/lines）— 服用開始日/日数/用法/dose 編集 **実装済み**
5. `GET /api/set-plans/[id]/calendar` — 7日×用法マトリクス＋セル状態＋completion_gate **実装済み**
6. `POST /api/set-plans/[id]/batches/bulk-set` — 一括セット済 **実装済み**
7. set-audits `GET/POST`（checklist＋photo_asset_ids＋result＋cell_audits）／`GET /api/files?purpose=set-photo&plan_id=` **前者は実装済み、写真一覧 BFF は要確認**
8. （オフライン）`OfflineSyncQueue.entityType` を dispense_result/dispense_audit/set_audit/cycle_transition に拡張＋サーバ冪等受理

### 11-4. Prisma スキーマ変更（まとめ・優先度順）

- **P0（結線ブロッカーは解消済み）**: `PackagingGroup`（グループ実体）/ `SetBatch` セル状態列（set*state/audit_state/ng_code/held*\*/set_by/audited_by/at）/ 共通 `RejectCode` enum(14種) / `CycleHold`（構造化保留）は live schema で実装済み。残は API/BFF/FE adapter の責務整理。
- **P1（充足度向上）**: `Patient.patient_number` / `CareCase.visit_type` / `PatientPackagingProfile.prefab_allowed`・`handover_note`・**RLSポリシー** / `SetPlan.dispense_destination`・`carry_packet_status`(or `CarryPacket`) / `PackagingInstructionTag` 拡張(賦形/脱カプ/分包しない/ptp/manual_ptp) / `PackagingMethod` 拡張(分包機機種/PTP手撒き/頓用) / `SetAuditResult` に hold
- **P2（構造化データ強化）**: `PrescriptionLine.dose_schedule`(時点別実量)・`is_prn` / `DrugMaster.is_auto_packable`・`is_crushable` / `DispenseResult.first_count/second_count`(ダブルカウント) / `ResidualMedication.cycle_id/line_id`

### 11-5. 共有純関数/型（shared/logic に集約・スキーマ変更不要）

`deriveListBadge`（16→3値）/ `computeEndDate`（start+days-1）/ `buildSlotTotals`（時点別合計）/ phase↔`MedicationCycleStatus` 写像 / dosage_form→剤形アイコン / 比較4区分への射影（`change_type` union に `continued`/`days_changed` 追加）/ `resolvePackagingSettings` 流用 / `SET_AUDIT_REQUIRED_CHECKLIST_KEYS`・保留理由7種・NG14種の SSOT 定数化（UI/API/テスト単一参照）。

### 11-6. アダプタ境界

`dispensing-workbench.adapter.ts` に `loadWorkbenchPatients()` / `loadWorkbench(phase, ...)` / `loadCalendar(planId)` / `mutate*` を定義し、段階1は seed、結線時は上記APIへ。**fixtures は必ず公開型（shared/types）に整形して返す**（プロト独自構造のまま持つと変換層が増え二重実装化）。

### 11-7. システム全体で追加する必要項目（2026-06-28 live repo 突合）

ユーザー要求の「グループ化・粉砕・一包化・PTP・混合・内服薬・外用薬・頓服薬・注射薬・日付管理」は、調剤ワークベンチ単体では完結しない。処方受付、患者カード、訪問準備、報告、請求、在庫、監査ログ、設定ポリシーまで同じ分類を通す必要がある。以下を追加スコープとして扱う。

| 領域                       | 追加が必要な項目                                                                                                                                            | 現行根拠                                                                                                                                                           | 実装方向                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 処方受付 / QR / 電子処方箋 | route / dosage_form / packaging_method / packaging_instruction_tags / start_date / end_date を必ず保持し、PTP・混合・粉砕可否・自己注射可否を取りこぼさない | `PrescriptionLine` に route/dosage_form/packaging/date はある。`prescription-intakes` と `qr-scan-drafts/[id]/confirm` は注射剤の外来/在宅自己注射可否ガードを持つ | JAHIS/電子処方箋 mapping に PTP/混合/粉砕/別包/一包化の正規化テーブルを追加。未分類は `other` でなく「要薬剤師確認」として intake triage に出す             |
| 薬剤マスタ                 | 粉砕可否、自動分包可否、PTP手撒き可否、冷所/遮光/麻薬/向精神/ハイリスク、注射剤の保険薬局調剤可否                                                           | `DrugMaster` は `dosage_form`, `is_narcotic`, `is_high_risk`, `outpatient_injection_eligible` を持つが、粉砕可否・自動分包可否は未構造化                           | `DrugMaster.is_crushable`, `is_auto_packable`, `ptp_hand_pack_allowed`, `storage_category` を追加または `DrugPackageInsert` 由来の safety projection を作る |
| 包装/加工 SSOT             | 一包化、朝夕別一包化、粉砕・混合、PTP、別包、分包除外、賦形、脱カプ、半錠、ホッチキス、ラベルを UI/API/監査で同一語彙にする                                 | `PackagingMethod` と `PackagingInstructionTag` はあるが PTP/賦形/脱カプ/分包除外が不足                                                                             | `PackagingInstructionTag` を拡張し、`src/lib/dispensing/packaging.ts` と validations を単一 SSOT 化。自由文は補助情報に下げる                               |
| グループ化                 | 自動生成グループと薬剤師が D&D で確定したグループの優先順位、sort_order、method、slot を全工程で同じにする                                                  | `PackagingGroup` と `/groups` API は実装済み。`PrescriptionLine.packaging_group_id` は loose String                                                                | workbench adapter で `PackagingGroup` を主に読み、未確定 line のみ `generatePackagingGroups` を fallback にする。監査・セットでは同じ group label を表示    |
| 日付管理                   | 服用開始日/終了日、処方日数、セット対象期間、訪問予定日、調剤実施日、監査日時の責務分離                                                                     | `PrescriptionLine` 編集 API、`SetPlan.target_period_*`、`DispenseResult.dispensed_at`、`SetAudit.audited_at` がある                                                | `computeEndDate(start, days)=start+days-1` を SSOT 化。日付変更時は set batch 再生成/差戻し/訪問 carry_items 再計算を transaction で連動                    |
| セット / セット監査        | SetBatch hold と CycleHold の二重管理整理、セル保留の期限/担当、差戻しから再セットへの復帰                                                                  | `SetBatch.set_state=hold` と `CycleHold` がある。`set-audits` は NG/部分承認/差戻しを持つ                                                                          | CycleHold を phase 共通の保留台帳、SetBatch hold をセル表示状態に限定。hold 作成/解消 API を追加し、WorkflowException との重複を整理                        |
| 外薬 / 持出パケット        | 外用薬、頓服薬、注射薬、液剤、冷所をセット外薬として訪問準備・報告・請求にも出す                                                                            | `set-audits` は carry_packet_evidence をサーバ検証し、external/injection/prn/liquid/cold を導出する                                                                | `deriveOutsideMedEvidenceKind` 相当を shared projection に移し、visit preparation / patients board / reports / billing で再利用                             |
| 調剤監査                   | 麻薬/ハイリスクのダブルカウント、1回目/2回目計数者、差異理由、監査者分離                                                                                    | `DispenseAudit` は task 単位。`DispenseResult.actual_quantity` と AuditLog はあるが二重計数は構造化されていない                                                    | `DispenseCountRecord` または `DispenseResult.first_count/second_count/count_matched` を追加。麻薬/高リスク時だけ必須ゲート化                                |
| 在庫 / 発注                | 粉砕・一包化・PTP手撒き・注射薬の作業可否を在庫単位、包装単位、薬局サイト単位で判定                                                                         | `PharmacyDrugStock` と stock request 系 API はある                                                                                                                 | set/dispense 確定時に必要量予約、欠品時は `CycleHold(reason=stock_shortage)` を自動候補化。箱単位/包装単位は薬剤マスタ拡張と連動                            |
| 患者包装プロファイル       | 患者ごとの一包化可否、粉砕希望/禁止、PTP希望、服薬BOX色、施設ルール、申し送り                                                                               | PatientPackagingProfile 系 API は存在するが、prefab_allowed/handover_note/RLS が計画上の残課題                                                                     | Patient ribbon / workbench 右ペインに投影。変更は audit log と effective date を持たせる                                                                    |
| 権限 / 職務分離            | canDispense / canAuditDispense / canSet / canAuditSet の工程別 UI/API 制御と一人薬剤師例外                                                                  | admin users は工程権限を持つ。set-audit は same_operator_reason + admin 承認を持つ                                                                                 | dispense-audit も set-audit と同じ例外理由/承認者/監査ログの表現に揃える。事務補助者のセット作業は supervising_pharmacist_id を P1                          |
| 通知 / ダッシュボード      | 待ち解除、粉砕不可、注射可否未確認、PTP手撒き、日付不整合、在庫不足、セット監査NGを詰まり理由として出す                                                     | WorkflowException / dashboard workflow / patients board がある                                                                                                     | `workflow_exception_type` と右レール projection に包装・日付・在庫・外薬カテゴリを追加。赤/橙の alert fatigue を避ける                                      |
| 訪問準備 / 報告 / 請求     | セット完了済み carry_items を訪問準備で確認し、報告・請求根拠に接続                                                                                         | `set-audits` は visitSchedule.carry_items を更新する                                                                                                               | carry_items に packaging tags / outside med kind / set audit evidence summary を含めるか、参照可能な BFF を追加する                                         |
| 外部連携                   | レセコン、電子薬歴、分包機、監査機器、在庫システムへの同期境界                                                                                              | `docs/compliance/responsibility-matrix.md` はレセコン pull/push 方針を持つ                                                                                         | 外部へ出す確定データは `DispenseResult` / `DispenseAudit` / `SetAudit` の append-only 記録から生成。中間状態は外部送信しない                                |
| オフライン / 冪等          | dispensation/audit/set/set-audit の再送・衝突・未同期表示                                                                                                   | Dexie syncQueue はあるが dispense 系 entityType は計画上 defer                                                                                                     | 確定 API に idempotency_key と expected_version を追加。オフライン許可範囲は「セット準備のみ」など工程別に明文化                                            |
| 監査 / エクスポート        | 操作証跡、写真証跡、差戻し理由、保留理由、日付変更理由を検索・出力可能にする                                                                                | AuditLog / SetBatchChangeLog / set audit photo_asset_ids がある                                                                                                    | audit-log filters に target/action の工程語彙を追加。患者単位・cycle 単位の監査タイムライン BFF を追加                                                      |
| 設定 / ポリシー            | 薬局ごとの一包化既定、PTP扱い、粉砕禁止の表示強度、二人制例外、在庫不足時の保留方針                                                                         | `settings/operational-policy` 系がある                                                                                                                             | 変更可能な運用ポリシーと医療安全上ロックするポリシーを分ける。設定変更は audit log 必須                                                                     |
| seed / E2E                 | 内服・外用・頓服・注射・粉砕・混合・PTP・一包化・日付不整合を同一シナリオで再現                                                                             | focused unit tests は存在。端から端までの fixture は不足しがち                                                                                                     | `e2e-prescription-dispensing-flow` に、QR取込→グループ化→セット→セット監査→訪問 carry_items までの cross-domain fixture を追加                              |

この表の項目は、すべてを一度に実装しない。優先順位は以下。

1. **安全ブロッカー**: 粉砕禁止/注射剤可否/麻薬・冷所/日付逆転/セット監査 NG のサーバゲート。
2. **ワークベンチ結線**: adapter が既存 API を使い、seed/mock と本番 BFF の型を一致させる。
3. **周辺 projection**: 患者カード、訪問準備、報告、請求、ダッシュボードで同じ分類を表示する。
4. **外部同期**: 確定済み append-only 記録だけを外部連携へ流す。

---

## 12. オフライン / 競合 / 監査証跡の実装方針（インターネット調査に基づく）

> 調査: TanStack Query v5 / Dexie / 楽観的並行制御 / 在宅調剤ドメイン+3省2ガイドライン / Next16 を Web + context7 で調査し、実コードと突合（既存実装の所在を特定）。

### 12-1. 重要な前提（既存実装の所在）

本プロジェクトは**オフライン/競合の基盤を既に保有**:

- Dexie `syncQueue`（`sync-engine.ts`: `enqueueForSync`/`processSyncQueue`/`setupAutoSync`）— 409→`conflict_state:'server_conflict'`＋暗号化 `conflict_payload{local,server}`＋retryCount 上限＋競合解決UI（`offline-sync-content.tsx`）
- AES-GCM 暗号化（`offline/crypto.ts`, `ENCRYPTION_KEY`, extractable:false 鍵）
- SSE `useRealtimeQuery`（`invalidateOn:['cycle_transition']`）＋`refetchInterval:30_000`
- 楽観ロック `MedicationCycle.version`＋`transitionCycleStatus`（updateMany WHERE version + count===0）＋`conflict()` 409 ヘルパー
- `@serwist/next` sw.ts は API を NetworkOnly（PHI を SW キャッシュに残さない）

### 12-2. 押下後（楽観更新）— `README` 要求

`useMutation` の `onMutate`→`onError`→`onSettled` で実装。**完了/監査送りは破壊的・取消困難**なので:

- `onMutate`: `cancelQueries`→`getQueryData`(スナップショット)→`setQueryData`(キューから当該タスクを楽観除去=「1件集中・次へ即移行」UX)→`{previous}` return
- `onError`: `setQueryData(previous)` でロールバック＋`toast.error`
- `onSettled`: `invalidateQueries` を **return**（refetch 完了まで pending 維持＝ボタン無効継続で**二重送信を構造防止**）
- 現状 `completeMutation/interruptMutation`（`dispense-workbench.tsx:728-737`）は `onSuccess` のみ・`onMutate` 無し → 上記へ移す
- セル/グループ設定の途中状態は段階1はローカル state で十分（サーバ途中永続が要件化した段階で (B)キャッシュ方式を導入。過剰実装回避）

### 12-3. 未同期（オフライン）

- **既存 Dexie `syncQueue` を SSOT に据える**。TanStack の `persistQueryClient`/`setMutationDefaults` へは移行しない（二重キューイング＝二重送信回避、要配慮個人情報を平文 localStorage に置かない＝MHLW v6.0/APPI）
- 調剤完了はオンライン前提（デスクトップ運用）。将来オフライン調剤を許すなら `enqueueForSync` に寄せ、`OfflineSyncQueue.entityType` を dispense系へ拡張
- 改善（任意）: `processSyncQueue` にバックオフ（`next_attempt_at` 列）— 一時的5xx時の thundering herd 対策

### 12-4. 他スタッフ更新（競合）

- **`MedicationCycle.version`** を調剤フェーズ OCC アンカー、セットは `SetBatch.version`。`DispenseResult.version` は存在も現状未使用、`DispenseTask` に version 列なし
- `POST /api/dispense-results` に `expected_version`（workbench 取得時の cycle.version）を追加受領。早期チェックは UX hint、**本判定は `transitionCycleStatus` の updateMany count===0**（TOCTOU 窓を閉じる）
- 競合レスポンスを統一: `409 { code:'WORKFLOW_CONFLICT', details:{ current:{id,version,overall_status,...}, expected_version } }`（既存 `conflict()` を details 付きへ拡張、`VisitRecord` の前例に揃える）
- 粒度別: 集約（サイクル/セットヘッダ）= 単一 version＋manual resolve。セル/監査フラグ = 子行ごと独立 version。**意味の重い本文（残薬/監査判定）は LWW 禁止・manual resolve 必須**（医療データ消失非許容）
- 解決UI: 既存 `offline-sync-content.tsx` の3カラム（あなたの入力/最新/選択）＋二重確認を踏襲
- **前提確認（要対応）**: workbench GET レスポンス（`DispenseWorkbenchData`）に `cycle.version` を露出させる必要がある（現状含むか要確認）

### 12-5. 監査証跡・コンプライアンス（MHLW v6.0 / 薬機）

4工程の確定操作（調剤完了/監査OK/セット完了/セット監査OK）で必須:

- **記録の確定（14.3）**: `inputUserId`（調剤者/配薬者）/`confirmUserId`（監査者）/**サーバ信頼時刻**（`@default(now())`、クライアント `new Date()` 不可）/対象患者・処方ID/操作種別/OK-NG/（NG時）理由コード
- **不可逆記録（append-only）**: 確定後の物理削除・上書きAPIを設けない。変更は version/seq 付き履歴へ append（既存 `AuditLog`＋`SetBatchChangeLog`(before/after_snapshot) が受け皿）
- **職務分離**: 調剤者≠監査者を原則記録。一人薬剤師時は `sameOperatorReason`＋別時刻実施を記録。確定権限は PHARMACIST、PHARMACIST_ASSISTANT はセット準備のみ。工程順序を `calcGate`/状態機械で技術強制
- **0402通知**: 非薬剤師がセット実施時、作業者ID・指示薬剤師ID・業務内容・時刻を記録。セット監査は「内容を画面表示し実チェックしないとOK確定不可」のUIで未確認承認を防止
- **保存性**: 確定記録は5年保存（安全側）。S3 Object Lock(WORM)＋PDF見読再現。物理削除API非提供
- **電子署名（将来）**: 監査確定レコードに `signatureValue/signerCertificate/signedAt/signerQualification` を nullable 予約（HPKI 後付け）。当面は Cognito 認証＋確定者ID＋サーバ時刻で責任所在を担保
- **オフラインPHI暗号化**: 作業状態・未送信ペイロードは AES-GCM。復号失敗エントリは黙殺せず offline-sync-center に `status:'undecryptable'` 可視化＋再ログイン導線

### 12-6. 主要引用

- TanStack Query v5: Optimistic Updates / Network Mode / Mutations(persist) / persistQueryClient / Advanced SSR
- Prisma: Transactions(P2034) / optimistic locking(updateMany+version, count===0)
- 厚労省 医療情報システムの安全管理ガイドライン 第6.0版（14.3 記録の確定 / 15 電子署名 / 17 証跡）
- 静岡県薬剤師会 業務手順書記載例（鑑査/一包化/0402通知/残薬確認）/ 薬剤師法28条（調剤録）
- Workbox Background Sync / MDN Background Synchronization / Dexie Version.upgrade

---

## 13. 結線フェーズ 順序付きタスク（実装は別途）

1. **スキーマ P0**: `PackagingGroup` / `SetBatch` セル状態列 / `RejectCode` enum(14) / `CycleHold` をマイグレーション（+ RLS ポリシー）
2. **共有定数/純関数**: 保留7種・NG14種・チェックリストキーの SSOT、`deriveListBadge`/`computeEndDate`/`buildSlotTotals`/phase↔status 写像、dosage_form→アイコン、比較4区分射影
3. **読み取りBFF**: `GET /api/dispense-workbench/patients`、リボンBFF（or workbench 拡張）、`GET /api/set-plans/[id]/calendar`。workbench に `dosage_form` と `cycle.version` を追加
4. **書き込みAPI**: `groups`（CRUD/割当）/ `prescription-lines` 編集 / `batches/bulk-set` / set-audits の NG必須・GET・写真一覧。`dispense-results` に `expected_version`＋409 details
5. **アダプタ差し替え**: `dispensing-workbench.adapter.ts` の seed 分岐を実API fetch へ。公開型に整形
6. **mutation 配線**: `onMutate/onError/onSettled(return invalidate)`、`useMutationState`、`getDispensingWorkbenchQueryKeys` 一括 invalidate、SSE/`refetchInterval` 既存を維持
7. **オフライン/競合**: `OfflineSyncQueue.entityType` 拡張＋冪等受理、競合解決UI の汎用化（or 工程系は「再取得して再操作」に割切り）
8. **監査証跡**: 全確定APIで inputUserId/confirmUserId/サーバ時刻/AuditLog append、職務分離ガード（set_by≠audited_by）、未確認承認防止UI
9. **seed**: 8名分を実DBへ（`PackagingGroup`/セル状態/残薬/NG分類デモ）
10. **検証**: `pnpm build`→`pnpm test`→`pnpm test:e2e`、競合/オフライン/権限（canDispense/canAuditSet）の挙動確認

### 結線フェーズの未決事項

- workbench GET に `cycle.version` を露出させるか（OCC 結線の前提）
- 競合判定アンカー = `MedicationCycle.version`（集約）か `DispenseResult.version`（行）か
- オフライン調剤完了を許容するか（許容なら dispense_results を syncQueue 対象に）
- セル状態のサーバ永続タイミング（完了時一括 vs 途中保存）
- NG理由14種の enum 化スコープ＋既存6種の統合
- 一人薬剤師（調剤者=監査者）の運用ポリシーと PHARMACIST_ASSISTANT のセット権限範囲（RBAC）

---

## 14. 処方登録(QR取込)→調剤 のデータ接続ルートとフィールド到達状況

> 調査: 5並列recon（QR解析/intake保存/調剤表示+ルート/算定/JAHIS規格）。実コードで裏取り。

### 14-0. スコープ確定（ユーザー決定 2026-06-16）

- **主取込対象 = お薬手帳QR（JAHISTC08, 保険情報なし）** に確定。院外処方箋2次元シンボル（保険レコードあり）は主対象としない。
- **負担金（一部負担金）・保険請求金額 = 対象外（スコープ外）**。QR非収載のため、算定/請求モジュール連動は本件では実装しない。画面では項目自体を出さない（または N/A）。
- 方針 = **「あれば表示で OK」**（ベストエフォート）。QRに含まれ保存済みの項目は表示し、含まれない項目は無理に出さない。

### 14-1. 接続ルートは存在する（結論）

**処方登録→調剤のデータ接続ルートは確実に存在する。背骨は `cycle_id`。**

```
QRスキャン (qr-scan/page.tsx, @zxing/browser)
  → parseJahisQRSafe / mergeJahisQRPages（record 911 マルチQR統合）
  → mapJahisToIntake（DrugMaster 照合で is_generic 等を補完）
  → POST /api/qr-scan-drafts（QrScanDraft.parsed_data に格納）
  → PCレビュー → POST /api/qr-scan-drafts/[id]/confirm
  → createPrescriptionIntakeInTx（同一Txで MedicationCycle＋PrescriptionIntake＋PrescriptionLine 作成）
  → createDispenseDraft で DispenseTask 自動生成・cycle を dispensing へ
  → 調剤ワークベンチ BFF (/api/dispense-tasks/[id]/workbench) が task→cycle→intakes→lines を結合
```

行レベルの連結キーは `PrescriptionLine.id`（DispenseResult/DispensingDecision/InquiryRecord を貫く）。

### 14-2. 「QRの全項目が調剤画面に表示される」は**現状 成立しない**

| 項目                      | QR規格 | 解析 | 保存 | **調剤画面表示** | メモ                                                                                                                                                                                                  |
| ------------------------- | :----: | :--: | :--: | :--------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 薬剤名                    |   ✅   |  ✅  |  ✅  |      **✅**      | `PrescriptionLine.drug_name`→count_rows                                                                                                                                                               |
| 用法                      |   ✅   |  ✅  |  ✅  |      **✅**      | `frequency`                                                                                                                                                                                           |
| 用量                      |   🟡   |  ✅  |  ✅  |      **✅**      | QRは1回用量+単位のみ。総調剤数量はQRに独立レコード無し（@deprecated）→ quantity が null になりやすい                                                                                                  |
| 処方日数(投与日数)        |   ✅   |  ✅  |  ✅  |      **✅**      | `days`                                                                                                                                                                                                |
| 患者氏名                  |   ✅   |  ✅  |  🟡  |      **✅**      | Patient.name 経由でヘッダ表示                                                                                                                                                                         |
| 医療機関名(処方元)        |   ✅   |  ✅  |  ✅  |      **❌**      | intake.prescriber_institution に保存。**workbench で select 済(route.ts:128)だが success()（route.ts:356-394）の intake 出力(:365-370 = id/prescribed_date のみ)に含めていない**→出力追加だけで表示可 |
| 処方医                    |   ✅   |  ✅  |  ✅  |      **❌**      | intake.prescriber_name に保存。BFF が select していない→select+出力追加で表示可                                                                                                                       |
| 後発品(is_generic)        |   ❌   |  🟡  |  ✅  |      **❌**      | QRに後発品ブール無し→DrugMaster 照合由来。line に保存済だが BFF が拾わない→select+バッジ表示で可                                                                                                      |
| 調剤年月日                |   ✅   |  ✅  |  🟡  |        🟡        | QR record 5 を `prescribed_date`(処方/交付日)へ流用。独立した調剤日表示は無し（要件定義要）                                                                                                           |
| **負担金(一部負担金/円)** | **❌** |  ❌  |  ❌  |        ❌        | **JAHIS お薬手帳QR(JAHISTC08)に円額レコードが存在しない**。システム内にも円額の保存列・算定ロジック無し                                                                                               |
| **保険請求金額(円/点)**   | **❌** |  ❌  |  ❌  |        ❌        | QR規格にもパーサにも請求金額フィールド無し。算定系は points のみ・訪問記録起点で調剤報酬円換算は未実装                                                                                                |

### 14-3. 重要な切り分け

- **医療機関名・処方医・後発品**は「保存済みだが調剤画面に流していないだけ」→ **BFF 出力と UI 表示の追加（低コスト）で表示可能**。データソースは既存。
- **負担金・保険請求金額**は「**そもそも電子お薬手帳QRに含まれない**」（会計・請求はレセプト=レセ電側の概念）。QR由来では取得不能で、システム内に円額の算定ロジックも無い。表示には別データソース（資格確認の負担割合＋算定/請求モジュールでの 点数→円換算・薬価×数量）の新規実装＝**スコープの大きい別フェーズ**が前提。
- 院外処方箋2次元シンボル（`JAHIS\d` 形式）なら record 24 に**負担割合(%)** はあるが円額ではなく、現状 `JahisSupplementalRecord` サイドカー＋`MedicationIssue` 確認候補に**意図的に隔離**（誤請求防止で PatientInsurance 非反映）。これは設計意図なので退行扱いしない。

### 14-4. 推奨（フェーズ分割）

- **フェーズ1（低コスト・既存データのみ）**: `workbench/route.ts` の `success()` 出力に `prescriber_institution`（select済）・`prescriber_name`（select追加）・`is_generic`（line select追加）を足し、`DispenseWorkbenchData`/`WorkbenchCountRow` 型と `dispense-workbench`／`medication-format-grid` の表示を更新。→ **QR由来で実装可能な9項目が調剤画面に揃う**。後発品バッジはアイコン+テキスト併用（WCAG AA）。
- **調剤年月日 = 調剤実施日を表示（確定）**: `DispenseResult.dispensed_at` の年月日を workbench レスポンスに追加し「調剤年月日」ラベルで表示（`prescribed_date` 流用や QR調剤日原本保持は採らない）。フェーズ1の `success()` 出力拡張（§14-2）に `dispensed_at` も含める。
- **負担金・保険請求金額**: **対象外（スコープ外・確定）**。お薬手帳QRに無いため画面に項目を出さない（または N/A 固定）。算定/請求モジュール連動は本件では実装しない。

### 14-5. 未確認・要確認

- ~~主取込対象~~ → **確定: お薬手帳QR(JAHISTC08, 保険なし)**（§14-0）。
- 調剤ワークベンチ**以外**の調剤系UI（`prescription-detail-content.tsx`/`jahis-supplemental-records-card.tsx`）で医療機関名・処方医・後発品が既に表示されている可能性（要件が「調剤ワークベンチ画面」限定か「調剤系全般」かで範囲が変わる）。
- `decodeShiftJIS`（jahis-qr.ts:221-230）が実スキャンUIで明示的に呼ばれず zxing の `getText()` 依存。Shift-JIS 文字化け検証の要否。

---

## 15. 残フォローアップ 実行計画（2026-06-17・調査で前提を裏取り）

> 重要な前提修正: ① **rename href は `9a8f33c0` に全面取込済み・page-route 残骸0・working tree クリーン**（「未コミット取込」は実質完了。真の残=Notification.link backfill のみ）。② §13 のうち **D3/D4 は実装済み（批准のみ）**、D2/D5 は現状維持で defer、D1 はビジネス判断、**D6 は要修正（稼働中の回帰）**。

### 推奨実行順（クリティカルパス: task3→task4）

| #     | タスク                                                                   | 工数 | 依存                | 要点                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------ | ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **S13-D6 修正**（set-audits の client `audited_at` 受入撤去→サーバ時刻） | S    | なし                | `set-audits/route.ts:58` の zod `audited_at` 削除、`:361` を `const now = new Date()` に、`route.test.ts` 同時修正。**クライアントが監査時刻を偽造可能な回帰**＝最優先。スキーマ/RBAC変更なし                                                                                                                                                                                                |
| **2** | **Notification.link バックフィル**                                       | S    | なし                | 新 migration で `UPDATE "Notification" SET link=regexp_replace(link,'^/auditing','/audit')`（+`/medication-sets`→`/set`）。撤去済ルートの既存通知404回避。併用案: next.config 308リダイレクト。rename本体は取込済（再コミット不要）                                                                                                                                                          |
| **3** | **design-fidelity セレクタ是正＋撮影**                                   | M    | task4とセレクタ共有 | **絶対前提**: `design-screen-map.ts` の `new_07_dispense`/`p0_12` setup が待つ旧 testid（`dispense-queue-row` 等）が新workbenchに0件→撮影必ず失敗。(A)新workbenchに data-testid 付与 or (B)setup を `a[aria-current=page]`/`role=checkbox` へ書換。→ `:3012`起動→対象8 screenId 限定撮影→`design/images` と目視突合（`--update-snapshots` 不在＝手動承認）→`design-fidelity-mapping.md` 更新 |
| **4** | **real-data 結線検証**（`NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA=1`）        | M    | task3とセレクタ共有 | フラグはどのスクリプトにも無い→`dev:e2e:local:realdata` 追加（ビルド時焼込のため起動時固定必須）。owner(demo)で認証→Network で patients/workbench/calendar API 200+data非空を確認（**未認証だと seed フォールバックで実データに見える罠**）。**田中cycleは SetBatch seed 0件**→set検証は施設居室101-103 患者で（or generate-batches/seed補完）。書込: 完了→409→楽観更新を Network 確認       |
| **5** | **S13 残5項目 批准/決定**                                                | S    | D3はtask4と共通事実 | D3(競合アンカー)/D4(永続タイミング)=実装済**批准のみ**。D2(補助者0402)/D5(オフライン調剤)=現状維持**defer**。**D1(単独薬剤師の自己監査例外)=ビジネス判断**（現状ハード禁止）                                                                                                                                                                                                                 |

### 要ユーザー判断（コード変更前に必要）

- **D1（必須・ビジネス）**: 単独管理薬剤師の薬局で「調剤者=監査者」の自己監査例外を設けるか。A=ハード禁止維持（現状・追加作業ゼロ）/ B=admin承認+sameOperatorReason+サーバ時刻の限定例外 / C=org単位の単独薬局モード。推奨A（顧客に単独薬剤師薬局が含まれる場合のみB）
- **D6（推奨確認）**: set-audits 監査時刻をサーバ時刻に統一（=セキュリティ回帰修正）。推奨=即修正(A)
- 技術選択（推奨で進行可）: design-fidelity セレクタ=**A(testid付与)**、田中set検証=**C(施設患者で検証)+A(seed恒久化)**、フラグ=**A(専用スクリプト)**

### 主要リスク

- design-fidelity: 旧testid待ちで撮影失敗（セレクタ是正が絶対前提）
- real-data: 未認証フォールバックの罠（API 200+data を Network で確認必須）／田中 SetBatch 0件
- D6: `route.test.ts` が `audited_at` を渡すため実装とテストを同時修正しないと red
- `/set`↔`/set-audit` 前方一致は厳密化済み・回帰テストで固定

---

## 16. フォローアップ実行結果（2026-06-17・全完了）

| タスク                               | 結果                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FW1-D6** set-audits サーバ時刻統一 | ✅ client `audited_at` 撤去・`new Date()` 統一。監査時刻偽造の回帰を解消                                                                                                                                                                                                                                                                                                                                        |
| **FW1-D1=B** 自己監査限定例外        | ✅ `DispenseAudit`/`SetAudit` に `same_operator_reason`/`same_operator_approved_by` 追加(migration)。**4条件で two-person rule 非形骸化**: 理由必須(欠如→422)＋admin(owner/admin membership)承認(欠如→403)＋サーバ時刻＋append-only `self_audit_exception` AuditLog。拒否経路は副作用ゼロ。39 tests pass                                                                                                        |
| **FW1** Notification.link backfill   | ✅ migration `..70000` で `/auditing→/audit`・`/medication-sets→/set`(path-boundary・冪等)。撤去済ルートの既存通知404を回避                                                                                                                                                                                                                                                                                     |
| **FW2** design-fidelity 撮影         | ✅ 新workbench に testid付与(`dispense-queue-row`/`dispense-checklist`)→ 8画面撮影 PASS(`new_07-09`/`p0_12-15`/`p0_36`)→ **視覚確認で新レセコンUI描画を確認**→ design-fidelity-mapping.md を 完了/撮影済 に更新                                                                                                                                                                                                 |
| **FW3** real-data 結線検証           | ✅ `dev:e2e:local:realdata` 追加。フラグONで4画面 renders cleanly + サーバログで `GET /api/dispense-workbench/patients 200`・`/api/set-plans 200`(401/403/500なし=モックフォールバックでない)。実API結線が runtime 動作                                                                                                                                                                                         |
| **§13 批准**                         | D1=B=実装済(上記)。D3(競合アンカー=MedicationCycle.version+count zero / SetBatch.version)=実装済**批准**。D4(永続タイミング: cell都度/bulk/audit確定のハイブリッド・append-only)=実装済**批准**。D2(PHARMACIST_ASSISTANT 0402スコープ)=現状維持**defer**(pharmacist_trainee流用・supervising_pharmacist_id は P1)。D5(オフライン調剤完了)=現状維持**defer**(OfflineSyncQueue 未拡張・オンライン専用)。D6=修正済 |

検証総括: typecheck 0(全体) / FW1 audit 39 tests + workbench 74 + 横断 254 / lint clean / design-fidelity 8撮影 PASS / real-data e2e 4 PASS(実API 200)。残: design画像ターゲットPNGが旧版なら設計成果物更新(別)、田中cycleの SetBatch seed 補完(施設患者で検証は成立済)、本番RDSへの migration 適用(運用)。
