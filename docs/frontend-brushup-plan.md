# 全画面フロントエンド・ブラッシュアップ計画（RUN-20260702-FEBRUSH）

**目的**: SSOT v2（`docs/ui-ux-design-guidelines.md`, `565615d4`）に基づき、全画面（page.tsx 122 / 到達可能 ~114）を規約準拠へ引き上げる。
**運用**: `.agent-loop` の maker/checker 分離・LOCK 規律・objective gate（lint / typecheck / typecheck:no-unused / format:check / test / build）・1 スライス = 1 commit = 1 review。進行台帳は `.agent-loop/FEATURE_QUEUE.md` の RUN-20260702-FEBRUSH 節。
**吸収**: 進行中の RUN-20260702-FEUX（FEUX-1..8）は本計画のトラック B に吸収する（FEUX-2 続行中 → B2）。

## 0. 現状実測（2026-07-02、計画の根拠）

| 違反クラス                                | 実測                                 | SSOT 章  |
| ----------------------------------------- | ------------------------------------ | -------- |
| 裸 `animate-pulse`（aria なしスケルトン） | 16 ファイル                          | 6.1 / 11 |
| `text-[9px]/[10px]/[11px]`（12px 未満）   | **186 箇所**                         | 3.2 / 11 |
| 生 Tailwind 状態色                        | 7 ファイル（是正計画でほぼ収束済み） | 3.1 / 11 |
| `rounded-2xl/xl` 常用                     | **140 ファイル**                     | 2.5 / 11 |
| `order-*`（DOM 順逆転）                   | 22 ファイル                          | 4.4 / 11 |
| `100vh` / `min-h-screen`                  | 8 ファイル                           | 4.6 / 11 |
| 裸 `<SelectValue />`（SSR enum 漏れ経路） | 31 箇所                              | 5.4 / 11 |
| ローカル Metric/Kpi/SummaryCard 残        | 7 定義（FEUX-2 で削減中）            | 7.1      |
| `prefers-reduced-motion` 対応             | **実質未実装**（3 参照のみ）         | 3.5      |

## 1. トラック構成（A → B → C の依存順、ただし並行可）

### Track A — 共通部品・ガード先行（System as product。C の前提）

| id  | 内容                                                                                                                                                                                                                                | owner       | 依存 | est |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---- | --- |
| A1  | **ESLint ガード新設**: 生状態色 / `text-[9-11px]` / 裸 animate-pulse / `order-*` / `100vh・min-h-screen` / 裸 SelectValue / `rounded-2xl` を warn→error 段階導入（FEUX-6 の実装形）                                                 | codex       | なし | M   |
| A2  | **prefers-reduced-motion 基盤**: globals.css の `motion-reduce` グローバル対応 + `Skeleton` pulse の静的化 + transition 即時化。全画面に一括効く                                                                                    | claude      | なし | S/M |
| A3  | ~~AlertBanner 新設~~ → **部品は既存**（`ui/alert-tier.tsx`、4段階+ARIA 出し分け+テスト済・**消費者ゼロ**）。残タスク = C wave での消費者移行（bg-state-\*/10 全面塗りバナー 8+ ファイルの置換）。新規部品は作らない（二重実装禁止） | —(C waveへ) | なし | —   |
| A4  | ~~ExpiryBadge 新設~~ → **部品は既存**（`ui/expiry-badge.tsx`、消費者 1=pharmacist-credentials）。残タスク = facility-standards ExpiryCell / 車両 / institutions 等の重複実装を移行                                                  | codex       | なし | S/M |
| A5  | **SafetyTagBadge 共通化**: patients-board.tsx のローカル実装（L296）を `ui/` へ抽出し、重大タグ非省略のオーバーフロー契約を付与                                                                                                     | claude      | なし | S/M |
| A6  | **LoadingRegion 昇格**: analytics ローカル実装 → `ui/loading.tsx` へ共通化                                                                                                                                                          | codex       | なし | S   |
| A7  | ~~DayNavigator 新設~~ → **部品は既存**（`ui/day-navigator.tsx`+テスト、消費者要確認）。残タスク = schedules/conflicts 等への結線（C1）                                                                                              | —(C waveへ) | なし | —   |
| A8  | **ErrorState 文言契約**: 「原因 + 次の行動」テンプレを ErrorState API に組み込み                                                                                                                                                    | claude      | なし | S   |

### Track B — 機械的ルール sweep（lint 検出 → 一括是正。A1 と対で再発防止）

| id  | 内容                                                                                                                                                                 | 規模      | owner    | est                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | ------------------- |
| B1  | 裸 animate-pulse → Skeleton/LoadingRegion（= FEUX-1b）                                                                                                               | 16 files  | codex    | M                   |
| B2  | StatCard 統合続行（= FEUX-2。workflow/admin 残 6 画面）                                                                                                              | 7 定義    | codex    | M（進行中 4/11 済） |
| B3  | 生状態色残 7 + SOAP 生色置換（= FEUX-4: visit-record-detail → `text-soap-*`）+ gantt hex（= FEUX-7）                                                                 | 7 files   | codex    | S/M                 |
| B4  | `text-[9-11px]` → `text-xs` 昇格。**表示崩れリスクがあるため画面グループ単位で分割**（ガント・カレンダーチップ・ExpiryCell 等の高密度画面は個別判断 + スクショ検証） | 186 箇所  | 両者分担 | L（4-6 スライス）   |
| B5  | 裸 SelectValue → 明示 children（SSR enum 漏れ封鎖）                                                                                                                  | 31 箇所   | codex    | M                   |
| B6  | `order-*` 排除（DOM 順 = 視覚順へ再構成）                                                                                                                            | 22 files  | claude   | M                   |
| B7  | `100vh/min-h-screen` → `100dvh`                                                                                                                                      | 8 files   | codex    | S                   |
| B8  | `rounded-2xl/xl` → `rounded-md` 正規化。**装飾差の意図確認が必要なため auth クラスタ→一般画面の順に段階分割**                                                        | 140 files | 両者分担 | L（4-6 スライス）   |
| B9  | tabular-nums 欠落 sweep（数値列・KPI・時刻）                                                                                                                         | 要検出    | claude   | M                   |
| B10 | sub-44px sweep（= FEUX-5: advanced-filter-modal ほか。A1 検出結果で確定）                                                                                            | 要検出    | claude   | S/M                 |

### Track C — 画面単位ブラッシュアップ（情報重力 / trunk test / ボタン階層 / 状態設計 / SSOT §2.9 チェックリスト）

wave 順 = 患者安全ホットパス優先。各画面: ①SSOT §2.9 実装前チェック ②before/after スクショ（/browse or Playwright）③focused vitest + scoped gate ④相互レビュー。

| wave | 画面群                                                                                                                                                                           | 画面数目安 | 備考                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| C1   | **患者ホットパス**: patients/[id] card-workspace（＋FEUX-3 homeOperations false-empty を先頭スライス）、visits/[id]（record / capture / voice-memo / detail）、my-day、schedules | ~10        | 患者識別バナー（SSOT 2.3）・安全タグ常時表示・Thumb zone を重点                              |
| C2   | **業務中核**: prescriptions（intake / workspace）、reports、billing、handoff、notifications、dashboard/cockpit、tasks                                                            | ~12        | ボタン 5 階層・アラート 4 段階（A3 導入）・件数ストリップ                                    |
| C3   | **admin 群**: マスタ・分析・運用 ~35 画面                                                                                                                                        | ~35        | AdminPageHeader + DataTable テンプレ波及で量産。B2/B4/B8 完了後が効率的                      |
| C4   | **連携・外部・auth**: external、collaboration、partner、共有 viewer、auth クラスタ                                                                                               | ~12        | **auth の視覚変更は hard-stop 隣接 → 要ユーザー承認スライス**。外部 viewer は PHI マスク重点 |
| C5   | 残余（設定・印刷除外確認・リダイレクト整理）                                                                                                                                     | ~10        | 印刷 (`*/print`) は SSOT 対象外の確認のみ                                                    |

**調剤ワークベンチ（保護解除済み）**: /dispense /audit /set /set-audit の視覚変更は**ユーザー承認により解禁**（2026-07-02、SSOT §2.1/§12 に記録）。専用 wave **C-WB** として C2 の後に実施する: 最高頻度の臨床画面のため、①特性テスト先行（現挙動の固定）②before/after スクショ必須 ③操作体系・工程フロー・test-locked 契約の不変 ④1 画面 = 1 スライス、の通常より高い検証水準を課す。

### Track D — 検証ハーネス（並行整備）

| id  | 内容                                                                                             | owner  |
| --- | ------------------------------------------------------------------------------------------------ | ------ |
| D1  | Playwright スクショ基盤: 主要画面の before/after を `tools/tests/.artifacts` へ蓄積（wave 単位） | codex  |
| D2  | axe-core 自動 a11y チェックを Playwright に組込み（WCAG 2.2 AA スモーク）                        | codex  |
| D3  | キーボード完結 E2E: 主要フロー（受付→調剤→訪問記録→報告）のキーボードのみ操作テスト              | 後続   |
| D4  | 進捗ダッシュボード: FEATURE_QUEUE に wave/スライス消化率を記録                                   | claude |

### Track E — API↔UI 到達性・二重実装解消・簡素化（2026-07-02 ユーザー指示）

**原則**: 「バックエンド機能があるのにフロントエンドにアクセスポイントがない」状態を解消する。二重実装を避け、コードは可能な限りシンプルに保ち、ブラッシュアップと同時にリファクタリングする。

| id  | 内容                                                                                                                                                                                                                                           | owner    | est  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| E1  | **API 到達性監査**: `src/app/api/**` の全 route を列挙し、フロントエンドからの呼び出し（fetch/useQuery/mutation）有無を突合。孤児 endpoint の台帳化（対応: UI 導線追加 / 統合 / 廃止提案の 3 分類。廃止は要ユーザー承認）                      | claude   | M    |
| E2  | **孤児機能の UI 結線**: E1 で「UI 導線追加」と判定した機能に SSOT 準拠のアクセスポイントを追加（該当 C wave に相乗りさせる）                                                                                                                   | 両者分担 | 随時 |
| E3  | **二重実装の統合**: 同一責務の重複（ローカル部品の再発明・重複 helper・類似 hook・コピペ UI ロジック）を共通部品/共通 lib へ統合。Track A/B の各スライスで発見した重複はその場で台帳化し、独立スライスで統合                                   | 両者分担 | 随時 |
| E4  | **簡素化リファクタ規律（全スライス共通）**: 触った画面では ①未使用 import/コード削除 ②不要な条件分岐・冗長 state の削減 ③props 型の厳密化 ④900 行超コンポーネントの分割検討、を同時実施。**挙動保存**（特性テスト or 既存テスト green が条件） | 両者     | 常時 |

- E1 は Phase 1 で先行実施（監査は read-only で安全）。結果は `.agent-loop/FEATURE_QUEUE.md` に「API 到達性台帳」として記録。
- 二重実装の「正」は常に共通部品（`src/components/ui/` / `src/lib/`）。画面ローカル実装を正にしない。
- 簡素化は視覚ブラッシュアップと同一コミットでよいが、**挙動変更を伴う場合は必ず別スライス**に分ける。

## 2. 実行順序と並行性

```
週次イメージ（スライスは常に小さく、1 commit = 1 review）:
  Phase 1（即時）: A1 lint ガード + A2 reduced-motion + B1/B3/B7（小 sweep）
                    ← FEUX-2(B2) は Codex が続行中
  Phase 2:         A3-A6/A8 共通部品 + B5/B6/B9/B10 + D1/D2
  Phase 3:         B4/B8 の大型 sweep（グループ分割、スクショ検証つき）
  Phase 4:         C1 → C2 → C3 → C4 → C5（wave 内は画面単位スライス）
  随時:            D3/D4、A7
```

- 並行規則: 同一ファイルを跨ぐスライスは LOCK で直列化。B4/B8 の大型 sweep 中は該当画面の C wave を止める（tree drift 回避）。
- 負荷配分は LOOP_POLICY §23（role-agnostic）で随時融通。

## 3. ゲートと完了定義

- **スライス DoD**: focused vitest green + scoped lint/prettier + 全体 typecheck/no-unused + 相互レビュー APPROVE。UI 変更はスクショ添付。
- **wave DoD**: 全 gate green + Playwright smoke + axe クリーン（D2 導入後）+ FEATURE_QUEUE 更新。
- **キャンペーン DoD**: ①lint ガード（A1）が error レベルで有効 ②実測表の全クラスが 0（意図的除外は SSOT 記録）③C1-C5 全画面が §2.9 チェック通過 ④キーボード E2E green。

## 4. hard-stop / 要承認

- auth クラスタの視覚変更（C4）: 着手前にユーザー承認を取る。
- EPIC7 no-store（MFA secret/PHI キャッシュ）: 本計画対象外（別途承認）。
- 調剤ワークベンチ本体: 視覚変更は解禁済み（2026-07-02 ユーザー承認）。ただし C-WB の高検証水準（特性テスト先行・スクショ・工程フロー不変）を必須とする。
- SSOT の数値規範を緩和するスライスは禁止（44px 無条件、12px 下限、等）。

## 5. リスクと対策

- **B4/B8 の視覚回帰**: グループ分割 + before/after スクショ必須 + 高密度画面（ガント/カレンダー）は個別判断。
- **並行編集 drift**: commit 直前再 diff（concurrent-edit-review-drift 対策）、owner 特定 1 コミット land。
- **lint 一括 error 化の摩擦**: A1 は warn 導入 → sweep 完了クラスから error 昇格の 2 段階。
- **admin 大量画面の工数**: C3 はテンプレ波及（AdminPageHeader + DataTable + StatCard）で 1 画面 = S サイズに抑える。
