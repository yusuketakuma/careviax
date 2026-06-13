# DESIGN_LANGUAGE — careviax 設計言語（recon 草案）

> F0/F1 recon（Ensemble 協調）でコードと SSOT を突合した草案。**確定は `/ground` フェーズ**（人手承認）。
> 引用は HEAD `16720de9` 基準。SSOT = `docs/ui-ux-design-guidelines.md` + `docs/design-gap-analysis-new.md`。

## 1. 配色 ✅ SSOT 準拠（src/app/globals.css:52-106）
- `--primary` oklch(0.45 0.12 240)（dark 0.60）= hue240・低彩度ブルー → 「落ち着いたブルー系」完全準拠
- `--background`/`--card` oklch(1 0 0)=純白、前景ほぼ黒（本文コントラスト ≈16:1）→「白ベース・高コントラスト」
- `--destructive` hue27 赤 / `--ring` 青フォーカス（可視）/ charts 5色（青240/緑160/琥珀55/橙30/紫270）
- `--sidebar` oklch(0.24 0.045 262)=ダークネイビー殻 → 前景コントラスト要確認（codex-2）

## 2. タイポ ✅ 準拠（layout.tsx:7-11 / globals.css:142-153）
- Noto Sans JP（next/font, 400/500/700）/ body 14px / line-height 1.6 → 本文・行間 SSOT 準拠
- ⚠ `layout.tsx:9 subsets:['latin']` のみ＝日本語サブセット未宣言（CJK は fallback 依存、グリフ読込要確認・軽微）
- ⚠ 「ラベル12px+」のグローバル強制なし → `text-[10px]/[11px]/2xs` が **233件**（印刷専用か実UIか要サンプル裏取り）

## 3. 角丸 ✅ 意図的抑制（globals.css:42-48,95）
- `--radius: 0.375rem`（控えめ、CLAUDE.md 準拠）。`rounded-2xl` は **token 上書きで 0.675rem(≈10.8px)**＝Tailwind 既定16pxではない → 逸脱ではない。

## 4. 密度・余白 △ 機構違い（page-scaffold.tsx）
- 主要グループ間 `space-y-3 sm:4 xl:5`（12/16/20px）＝SSOT「24px+」を下回る。
- ただし card variant が各子を `border-border/70 + bg-card + shadow-sm` で包む（:10-30）→ 分離は**枠線が担保**（SSOT「枠線で明示」には合致）。マージン量基準未満を枠線で代替する構図。

## 5. 印刷 ✅ 一級対応（globals.css:156-236）
- @page A4 / table枠線 / badge アウトライン化 / data-print-skip / page-break 制御。reports/print 系は充実。

## 6. ★ 状態色 — 最重要課題（U-1）
**globals.css に `--status-*`/`--priority-*` の中央トークンが存在しない**。状態色が2機構に分裂し、いずれも短い状態色 SSOT に違反:

### 機構A: shadcn Badge variant（4値: default青/secondary灰/outline/destructive赤）
`src/lib/constants/status-labels.ts`:
- `CASE_STATUS_VARIANTS`(:10-17): active→`default`(青) / on_hold→`outline` / discharged→`outline`
  - SSOT患者[稼働中=緑/保留=橙/終了=灰] に対し **稼働中=青(緑でない)・保留=outline(橙でない)**。Badge に緑/橙 variant が無く**構造的に表現不能**。
- `PRIORITY_VARIANTS`(:49-53): emergency→destructive(赤✓) / urgent→secondary(灰, SSOT高=橙✗) / normal→default(青=中✓)

### 機構B: 生 Tailwind パレットクラス
- `SCHEDULE_STATUS_STYLES`(:97-106): planned=blue-100 / ready=green-100 / departed=green-200 / in_progress=**yellow**-100 / completed=gray-100 / cancelled=red-100 / postponed=orange-100
  - SSOTワークフロー[待ち=青/進行中=緑/差戻し=赤/完了=灰] に対し **in_progress=黄（緑のはず）**、緑が ready/departed に割当＝**反転**。
- 生パレット蔓延（525 tsx 中）: green/emerald=113 / amber/orange=151 / red/rose=76 / blue/sky=105 / gray/slate=61 ファイル。
- 状態解決ロジックも二重化: `status-labels.ts`(dashboard系) と `src/phos/domain/status/resolveDisplayStatus.ts`(phos系)。

## 7. 実在する多層パレット（codex-2 — コードの実態）
コードは単一状態色ではなく **意図的な多層セマンティックパレット**:
- ブランド/主操作: calm blue（primary）
- スキャフォールド: navy sidebar
- **危険表示** `safety-board.tsx:45-163`: 麻薬=赤 / 冷所=teal / 一包化=青 / 注意=amber / 中立=grey
- **工程進行** `process-chips.tsx` + `cycle-workspace.ts:172-217`: 9工程(取込→…→算定) done=緑 / current=青 / upcoming=灰
- 患者カード attention: 赤/緑/琥珀/青/紫/灰

## 8. ★ 状態色ガバナンス — 決定（design v1.9 `p0_46` で grounding 済）
`design/images/P0/p0_46_ui_state_reference.png`「画面で使う言葉をそろえる」が状態色の**正本**。CLAUDE.md の短い状態色 spec（患者緑橙灰 / 優先度赤橙青灰）は**不採用**（参照 docs 3点が実在せず陳腐化、かつ p0_46 と非整合）。

### design-grounded セマンティック軸（p0_46 の明示定義）
| 意味 | 色 | 設計の用途 | トークン(案) |
|---|---|---|---|
| 通常の主操作 | **青** | 主ボタン「押せます/実行できます」・current・情報タグ(処方変更/セット変更/返信待ち「一覧に出す」) | `--primary`(既存) / `--tag-info` |
| 止まっている理由 | **赤** | ブロッカー「止まっている理由」・通信なし「あとで同期」 | `--state-blocked` |
| 完了 | **緑** | done/完了 | `--state-done` |
| 確認が必要 | **橙/amber** | 「先に不足を確認」・危険タグ(麻薬/冷所「絶対に隠さない」) | `--state-confirm` / `--tag-hazard` |
| 別の人の確認待ち | **紫** | 「薬剤師/事務など」他者待ち | `--state-waiting` |
| 権限なし・閲覧のみ | **灰** | 「見るだけ」 | `--state-readonly` |

### 決定 = **(b) + 中央トークン化**
- 上記6軸を `globals.css` に `--state-*` / `--tag-*` として中央定義し、全エンティティ状態（患者/工程/スケジュール/優先度）を**この軸へ写像**。entity 固有パレットの新設は**禁止**。
- 既存逸脱の是正方針（U-1）:
  - `SCHEDULE_STATUS_STYLES`: in_progress 黄→**青(active/current)**、completed 灰→**緑(完了)**、cancelled 赤(=止まる)、postponed 橙(=確認/保留) は軸整合。
  - `CASE_STATUS_VARIANTS` / `PRIORITY_VARIANTS`: shadcn Badge の4 variant では軸を表現しきれない → semantic な `StateBadge`/`StatusDot`（`--state-*` 参照）を新設し、Badge variant 直マップを置換。
  - `ProcessChips`(done=緑/current=青/upcoming=灰)・`SafetyBoard`(危険=赤/amber) は軸に既に整合 → トークン参照へ寄せるのみ。
  - 患者ライフサイクル(稼働中/保留/終了)は色の新意味を作らず、稼働中=中立、保留=`--state-confirm`、終了=`--state-readonly` に写像。
- 印刷/(phos) の二重状態系統（`resolveDisplayStatus.ts`）も同一トークンを参照させ単一化。
