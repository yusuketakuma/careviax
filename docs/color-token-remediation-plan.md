# 配色トークン是正 段階計画（生 Tailwind 状態色の撲滅）

**Status:** Phase 1 **完了**（P1-a〜P1-d land 済 + P1-e は「状態対象なし」でクローズ）。次は Phase 2（識別トークン族の globals.css 実装、§8 設計合意済）。

**Phase 1 実装記録（2026-06-27）:**

- P1-a `53592f6f` medication-calendar 曜日 → weekend トークン（Codex APPROVED）
- P1-b `71c0e5b3` business-holidays バッジ → state-blocked/tag-info（Codex APPROVED）
- P1-c `cd13da74` intake-triage 状態バッジ8 → 6 軸 + 行全面塗り2件削除（Codex APPROVED、FLAG2件確定: unblock_related=done / inquiry_waiting=confirm 維持）
- P1-d `3d87e10b` safety-board 全面赤背景削除 → bg-card + 左 hazard 帯、見出し/リンク=tag-hazard、dt ラベル=muted、narcotic=tag-hazard（Codex Q1/Q2 設計合意。getHandlingTagBadgeClass 経由で 5 consumer 画面に narcotic 赤→琥珀が波及）
- P1-e **クローズ（state 対象なし）**: 再 read の結果、patient-care-team-source-panel の emerald は装飾パネルテーマ（実状態は既に state-confirm 済）、shared-viewer の色付きアイコンは装飾セクションアクセント。いずれも workflow 状態ではないため §129 ゲートに従い Phase 2（装飾色の中立化 or 識別トークン）へ送る。state-done への写像はしない（Codex 合意）。

**Owner:** claude-lead（FE レーン）
**Reviewer:** codex-lead
**根拠:** `docs/ui-ux-design-guidelines.md` §L297-307（6 軸セマンティックが正本・生 Tailwind 状態色禁止）/ §L311-317（状態色は点・線・ラベル、面塗り禁止）/ §L374（識別色は別系統だが専用トークンを使い生 Tailwind 直書きしない）
**発端:** read-only Explore 調査で 11 ファイル・約 93 件の生 Tailwind 状態色/識別色ベタ書きを検出。weekend トークン是正（`e574af3e`）と同根の横断問題。

---

## 0. 方針

- **挙動不変を最優先**。配色の「意味」を変えず、生 Tailwind を中央トークンへ写すだけにする。視覚は同等〜ガイドライン準拠の範囲で微調整。
- **2 系統を分離**: ①状態色（`--state-*`/`--tag-*`、6 軸）＝ワークフローの止まり/完了/要確認等。②識別色（カテゴリの区別、状態ではない）＝剤型・SOAP・ロール・時間帯等。①は既存トークンへ、②は新トークン族を設計して寄せる。
- **面塗りの撲滅**（§L311-317）: タイル/カード/行の全面アラート背景は削除し、左ボーダー帯＋ラベル文字色へ。
- スライスは小さく、各々独立 green。状態色（Phase 1）→ 識別トークン設計（Phase 2）→ 展開（Phase 3）の順。

---

## 1. 検出インベントリ（Explore 由来・要再確認）

| #   | ファイル                                                            | 件数          | 分類                   | 重大度 |
| --- | ------------------------------------------------------------------- | ------------- | ---------------------- | ------ |
| 1   | `prescriptions/intake/intake-triage.shared.ts`                      | 8（面塗り2）  | 状態色                 | 高     |
| 2   | `components/features/workspace/safety-board.tsx`                    | 13（面塗り1） | 状態色(hazard)         | 高     |
| 3   | `admin/business-holidays/business-holidays-content.tsx`             | 2             | 状態色                 | 中     |
| 4   | `patients/[id]/medication-calendar/medication-calendar-content.tsx` | 7             | 曜日2(状態外)+時間帯4+ | 中     |
| 5   | `patients/[id]/prescriptions/prescription-history-content.tsx`      | 13            | 剤型/方法/取消=混在    | 中〜高 |
| 6   | `components/features/medications/intervention-panel.tsx`            | 6             | 識別(介入種別)         | 中     |
| 7   | `components/features/workspace/action-rail.tsx`                     | 3             | 識別(ロール)           | 中     |
| 8   | `components/features/visits/patient-care-team-source-panel.tsx`     | 7             | 状態(done)寄り         | 中     |
| 9   | `select-mode/select-mode-content.tsx`                               | 3             | 識別(モード見出し)     | 低     |
| 10  | `shared/[token]/shared-viewer-content.tsx`                          | 3             | 状態(done)アイコン     | 低     |
| 11  | `visits/**` SOAP アイコン                                           | 8             | 識別(SOAP)             | 低     |

> ⚠️ 件数・分類は Explore の一次調査。各スライス着手時に当該ファイルを再 read して「状態か識別か」を最終判定する（誤分類を防ぐ）。

---

## 2. フェーズ構成

### Phase 1 — 明確な状態色違反 → 既存 6 軸トークン（挙動不変・設計判断不要）

新トークン不要。`--state-*`/`--tag-*`/`--weekend-*`（実装済）/`StateBadge`/`StatusDot` へ置換。各スライス独立 commit・Codex review。

| Slice | 対象                                                                                                                                                                                                                           | 写像                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-a  | `medication-calendar` 曜日 `text-red-600`/`text-blue-600`                                                                                                                                                                      | → `text-weekend-sun`/`text-weekend-sat`（即・低リスク）                                                                                                                          |
| P1-b  | `business-holidays` 休業/開設バッジ `bg-red-100`/`bg-blue-100`                                                                                                                                                                 | 休業=`state-blocked`系 / 開設=`tag-info`系。バッジは塗り最小（StateBadge 準拠）                                                                                                  |
| P1-c  | `intake-triage.shared.ts` トリアージ状態バッジ8 + **行全面塗り2件削除**                                                                                                                                                        | acceptance_pending=waiting / duplicate=confirm / entry_pending=info / inquiry/on_hold=confirm / entered/imported/unblock=done。`rowClassName` の `bg-*-50` は削除し zebra/罫線へ |
| P1-d  | `safety-board.tsx` **全面赤背景(L128)削除** + hazard テキスト/タグ                                                                                                                                                             | 背景中立化、見出し/ラベルは `text-tag-hazard`、左ボーダー帯で安全領域を示す。narcotic=`tag-hazard`                                                                               |
| P1-e  | `patient-care-team-source-panel` / `shared-viewer` の done 系アイコン・見出し（**status を表す時のみ** state へ。面背景は中立化）。**`select-mode` は識別色なので Phase 1 から除外し Phase 2 へ送る**（Codex Q1/追加ゲート）。 | done が「完了/検証済」を表すなら `text-state-done`、そうでなければ Phase 2 識別トークン。各ファイル再 read で確定                                                                |

### Phase 2 — 識別色トークン族の設計（globals.css・Codex 設計相談必須）

状態ではない「カテゴリ識別色」を生 Tailwind から専用トークンへ。`@theme` 公開込みで globals.css に新設（light/dark、AA 検証）。**§7 で Codex に設計合意を取ってから実装**。

提案トークン族（要相談）:

- `--soap-s/o/a/p`（記録カテゴリ。代替案: `--chart-1..4` 流用）
- `--route-internal/external/injection`（剤型: 内服/外用/注射）
- `--intervention-*`（介入種別6。代替案: 一部は state へ写像）
- `--role-patient/clerk/institution`（連絡ロール識別。action-rail）
- 服薬時間帯（朝昼夕眠前）: 代替案 `--chart-*` か `--time-slot-*`。※調剤台 workbench は別系統 `--wb-*` 既存なので統一可否も検討
- 調剤方法（一包化/粉砕）: **状態 or 識別の判定が必要**（粉砕=注意喚起なら `tag-hazard`、純カテゴリなら識別トークン）

### Phase 3 — 識別トークンの展開（挙動不変置換）

Phase 2 で確定したトークンで各ファイルの生 Tailwind を置換:

- `prescription-history`（剤型/方法/取消/ルート変更）
- `intervention-panel`、`action-rail`、`medication-calendar` 時間帯、`visits/**` SOAP

---

## 3. スライス分割と LOCK（Phase 1 のみ確定。Phase 3 は Phase 2 後に確定）

- P1-a: `…/medication-calendar/medication-calendar-content.tsx`(+test) — ただし時間帯色は Phase 3 へ残す（曜日のみ）
- P1-b: `…/admin/business-holidays/business-holidays-content.tsx`(+test)
- P1-c: `…/prescriptions/intake/intake-triage.shared.ts`(+関連 test)
- P1-d: `…/components/features/workspace/safety-board.tsx`(+test)
- P1-e: `patient-care-team-source-panel.tsx` / `shared-viewer-content.tsx` / `select-mode-content.tsx`（小さく分けて可）

各スライス着手直前に exact-path LOCK を agmsg 予告。Codex の href-hardening backend lane（services/_、api/_）とは非重複。

## 4. 検証ゲート

各スライス: `pnpm exec eslint <files>` / `prettier --check` / `pnpm typecheck` / `typecheck:no-unused` / 対象 `vitest`。新トークン(Phase 2)は WCAG AA をコントラスト計算で検証（weekend と同手法）。視覚確認は将来カレンダー横断 visual QA 時に /browse でまとめて。

## 5. 非スコープ / 注意

- chart 系列（`--chart-*`）、既存 `--wb-*`(調剤台)、既に 6 軸/StateBadge/weekend を使う箇所は対象外。
- 「識別 vs 状態」の最終判定は各ファイル再 read で行う（Explore 分類は仮）。誤って識別色を state へ寄せると意味が壊れるため慎重に。
- 面塗り削除は visual が変わる（意図的改善）。挙動不変原則の例外として「ガイドライン準拠への是正」と明記してレビューに出す。

## 6. 進め方

1. 本 PLAN を Codex レビュー（特に Phase 分割と「識別 vs 状態」分類方針）。
2. Phase 1 を P1-a→…→P1-e の順に maker/checker で land。
3. Phase 2 トークン設計を §7 で Codex 設計相談 → globals.css 実装（AA 検証）。
4. Phase 3 展開。

## 7. Codex への質問（設計相談）— 回答済み（2026-06-27 DESIGN_CONSULT_RESPONSE）

1. Phase 分割 → **承認**。Phase 1 は exact-path・state-only・globals.css 不可触・新トークン無し・広域再設計無し。Phase 2 がトークン/コントラスト設計ゲート。Phase 3 は確定トークンの適用のみ。
2. 識別 vs 状態の境界 →（§8 に確定指針）。
3. SOAP/時間帯 → **専用 `--soap-*` / `--time-slot-*` を新設**（`--chart-*` 流用しない。chart はデータ系列専用で変わり得る）。小さく・低彩度・AA 検証。
4. 介入種別 → **専用 `--intervention-*`**。state/tag への一括写像はしない（side_effect=hazard 等は意味誤り）。緊急度が要るならカテゴリの隣に別 state/tag バッジを置く。semantic 名 or `--intervention-1..6`＋写像表。
5. ロール識別 → **`--role-*` 新設 OK**（state/tag と別系統・低彩度・text/border/dot/小バッジ限定）。

## 8. 確定設計指針（Codex 合意・Phase 2/3 の正本）

**識別 vs 状態の境界（Q2）:**

- 取消/voided = **state-blocked**（無効化/ブロックを表す時）。ラベル/線/バッジのみ、行・カード全面塗り不可。
- ルート変更 = **tag-info**（単なる情報的な経路/剤型変更）。人の確認/対応が要る時のみ confirm。ワークフロー注意を変えるなら純識別扱いにしない。
- 粉砕 = **tag-hazard は安全/取扱警告・高リスク調製の時のみ**。単なる調剤方法カテゴリなら識別トークン。一律 `粉砕=hazard` は過剰アラートになるので禁止。
- 一包化 = 原則 **調剤方法の識別**（UI が pending/blocked/要確認 を示す時を除く）。

**識別トークン族（Q3-Q5、Phase 2 で globals.css 実装）:**

- `--soap-s/o/a/p`、`--time-slot-*`（朝昼夕眠前）、`--route-internal/external/injection`、`--intervention-*`（semantic or 1..6）、`--role-patient/clerk/institution`。
- 全て低彩度・状態色と読み違えない・AA 済。`@theme` で `--color-*` 公開。

**追加ゲート（Codex）:**

- Phase 2 の globals.css 提案は light/dark 値・`@theme --color-*` 公開・bg-card/bg-muted/white 等 PH-OS サーフェス上のコントラスト証明を含める。
- Phase 2/3 は影響 UI クラスタの before/after screenshot か gstack visual check を付ける。
- **P1-e/select-mode は自動的に state ではない**。各 UI を再 read し、status/権限/可用性を表す時のみ state トークン、でなければ Phase 2 識別トークンへ送る。
- business-holiday: closed → state-blocked、special/open 例外 → tag-info（完了ワークフロー状態でない限り）。
- medication weekend（P1-a）は weekend トークン作業として承認済。
