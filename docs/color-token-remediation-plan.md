# 配色トークン是正 段階計画（生 Tailwind 状態色の撲滅）

**Status:** Phase 1 **完了** + Phase 2 **完了**（23 識別トークン globals.css land）+ Phase 3 **完了**（6 family 展開 + drug-class=tag-hazard 流用 + 装飾中立化、全 commit land・全 Codex APPROVED）+ Phase 3b **実装中**（残留識別色 2 群: intake-lane 新 family + safety-board handling tones の hazard/method 寄せ）。残課題: ①横断 visual QA（/browse）。

**Phase 3 実装記録（2026-06-28）:**

- P3-soap `5780ded7` SOAP step 色 chart-\* → --soap-\*（APPROVED）
- P3-intervention `2e5a730c` INTERVENTION_TYPE_COLORS → --intervention-\*（APPROVED）
- P3-time-slot `47b31527` SLOT_COLORS → --time-slot-\*（APPROVED）
- P3-role `47455d10` action-rail BLOCKED_CATEGORY_TONES → --role-\*、container 色パネル撤去→左帯（APPROVED）
- P3-prescription-history `2ff1f7e6` route→--route-\* / method→--method-\* / drug 安全分類→tag-hazard 流用（APPROVED）
- P3-decorative `9d3ee3c0`/`492b0de0`/`e6225e86` care-team / shared-viewer / select-mode の装飾色中立化（APPROVED）
- 関連: build-blocker（buttonVariants server-call）を `4776d257` で修正（buttonVariants を非 client の button-variants.ts へ抽出、HEAD build green 回復、APPROVED）
- **残留識別色（合意6 family 外・要 family 判断）**: safety-board の cold/unitDose/caution handling tones（teal/blue/amber）と intake-triage の lane バッジ（fax/online/walk_in）。いずれも P1 で「Phase2/3 識別へ」と deferred したが 6 family scoping に含めていなかった分。Codex と family 方針を確定後に Phase 3b として展開予定。medication-calendar の print patient-id は純中立だったので `text-muted-foreground` へ即修正（別 commit）。

**Phase 3b 実装記録（2026-06-28）— 残留識別色 2 群（Codex DESIGN_REPLY 2026-06-27T18:02:28Z 合意）:**

Phase 3 最終 sweep で surfaced した「合意6 family 外」の残留識別色を、Codex の family 判断に従って解消する。新 family は **intake-lane のみ**（storage-cold 等は作らない）。

- **intake-lane 新 family（globals.css）**: `--intake-lane-fax`(blue H256) / `--intake-lane-online`(violet H285) / `--intake-lane-walk-in`(grey H250)。経路（FAX/オンライン/持込）の識別であり status ではない。light/dark + `@theme --color-*` 公開。hue は Phase 2 で AA 実証済の系統（fax=route-internal 系 blue256、online=intervention 系 violet285、walk-in=低彩度 grey）を流用し、新規コントラスト計算は不要（同一 hue/明度帯）。小バッジ `bg-…/10 text-…`（面塗り最小）。
  - 適用: `intake-triage.shared.ts` `INTAKE_LANE_BADGE_CLASSES`（旧 teal/sky/slate 等の生 Tailwind → intake-lane トークン）。
- **safety-board handling tones（family 新設せず既存へ寄せ）**: Codex 判断 B+修正。
  - `cold`（冷所）/`caution`（半錠・分割 / 粉砕禁止）= 取扱**警告** → **tag-hazard**（ガイドラインの hazard 定義に含まれる取扱注意）。旧 teal/amber 生 Tailwind を撤去。
  - `unitDose`（一包化）= 調剤**方法**の識別 → 既存 **--method-unit-dose** 流用（新 family を作らない）。旧 blue 生 Tailwind を撤去。
  - `narcotic` / `hazardToken`（感染隔離・procedure:\*）/ `neutral` は P1-d のまま不変。
  - test `safety-board.test.tsx`: cold→`text-tag-hazard` / unitDose→`text-method-unit-dose` に更新（旧 teal/blue 生 Tailwind アサーション撤去）。
- **方針根拠**: 「識別 vs 状態」§8 — 一包化は調剤方法カテゴリ（識別）、冷所/分割/粉砕は安全・取扱警告（hazard）。一律 hazard 化はしない（一包化は method 識別に留める）。

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

#### Phase 2 grounding 結果（2026-06-27・対象8ファイル再 read、Codex 確定待ち）

実使用を行番号付きで列挙した結果、§8 の family リストは不完全と判明。確定/新規/要判定を分離（DESIGN_CONSULT 送信済）:

- **確定 family（実使用一致・要 oklch+AA）**: `--route-internal/external/injection`(3, ROUTE_CONFIG)、`--intervention-*`(6 semantic, INTERVENTION_TYPE_COLORS, 1対1)、`--role-patient/clerk/institution`(3, action-rail BLOCKED_CATEGORY_TONES)、`--time-slot-morning/noon/evening/bedtime`(4, SLOT_COLORS。朝昼夕眠前=4で確定)。
- **新 family（§8 に無い・要判定）**: `--method-standard/unit-dose/crushed`(3, METHOD_CONFIG。履歴の記述カテゴリ=識別と解釈、粉砕の hazard 化是非を確認)、`--drug-classification-narcotic/psychotropic/high-risk/lasa`(4, Drug Master インライン。一覧で4分類区別が要るため独立 family 案。麻薬を safety-board の tag-hazard と揃えるか確認)。
- **コード現実との矛盾**: SOAP は既に `text-chart-1/2/5/3` 使用中（§8 の「専用 --soap-_ 新設・chart流用禁止」と矛盾）。新設 vs 据置を確認（推奨: §8 通り --soap-_ 新設）。
- **識別でない/装飾（トークン化しない案）**: `select-mode` の work-mode 見出し色（薬剤師/事務/管理 3）は専用 `--work-mode-*` 小族 or 中立化、care-team panel emerald・shared-viewer section アイコン（emerald/sky/indigo/rose）は純装飾 → 中立化（新トークン不要）。
- **既に移行済（対象外）**: prescription-history の CHANGE_BADGES は state トークン(tag-info/state-blocked/state-confirm)化済。

#### Phase 2 確定値 + AA 証明（2026-06-27・Codex DESIGN_CONSULT 合意済）

Codex 合意で **23 識別トークン**を確定（除外: drug-classification=麻薬等は tag-hazard 流用 / work-mode=中立化 / 装飾アイコン=中立化）。値が同一の family も将来の個別調整のため別トークンで定義。実装は `src/app/globals.css`（`:root` light / `.dark` dark / `@theme inline` で `--color-*` 公開）。

**識別トークンであり status ではない**（緊急/警告/状態は `--state-*`/`--tag-*` を使う）。全て低彩度で state（高彩度・アラート）と弁別し（light は C≤0.12、dark は AA/可読性のため text インクを C≤0.13 まで許容）、使用は text/border/dot/小チップのみ・大面積塗り禁止（§L311-317）。赤系は state-blocked と競合しないよう side_effect_management=rose(H12) / method-crushed=rust(H55) に退避。

AA は oklch→linear sRGB→相対輝度で計算（weekend と同手法）。12px=normal text 扱い ≥4.5:1。**全 23 トークン合格**（binding=最小値、light の on muted=oklch(0.95) が最厳）:

| family       | tokens (oklch L C H, light/dark)                                                                                                                                                                                                | AA 最小（light on muted / dark on muted） |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| route        | internal 0.51/0.105/256·0.74/0.11/256, external 0.52/0.09/162·0.77/0.10/162, injection 0.50/0.12/308·0.76/0.13/308                                                                                                              | 4.55 / 7.49                               |
| intervention | dose-adjustment=blue256, drug-change=purple308, side-effect-management 0.51/0.10/12·0.76/0.12/12, adherence-support=green162, prescriber-consultation 0.53/0.115/48·0.78/0.12/48, patient-education 0.52/0.08/195·0.76/0.08/195 | 4.55 / 7.49                               |
| role         | patient 0.50/0.12/285·0.75/0.13/285, clerk 0.52/0.10/88·0.80/0.11/88, institution=blue256                                                                                                                                       | 4.79 / 7.49                               |
| time-slot    | morning 0.52/0.105/92·0.83/0.11/92, noon=blue256, evening=orange48, bedtime=purple308                                                                                                                                           | 4.77 / 7.49                               |
| method       | standard 0.52/0.015/250·0.72/0.02/250, unit-dose=amber88, crushed 0.50/0.055/55·0.74/0.07/55                                                                                                                                    | 4.76 / 6.98                               |
| soap         | s=blue256, o 0.51/0.085/182·0.76/0.09/182, a=violet285, p=orange48                                                                                                                                                              | 4.75 / 7.49                               |

最小 AA = 4.55（route-external / adherence-support の light on muted）。全 surface（white/muted, card/muted）で ≥4.5。hue 共有（blue256 が route/intervention/role/time-slot/soap、orange48 が intervention/time-slot/soap 等）は Codex 合意済（低彩度・非 status 文脈・別トークン名なので将来分岐可）。視覚 QA は Phase 3 展開後に /browse で実施し、混同が出た family のみ個別調整。

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
