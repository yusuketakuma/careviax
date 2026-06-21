# F-011 Stage1b — DispensingWorkbench inline 色トークン化 実行スペック

Stage1a(module.css chrome)に続く Stage1b の実行台帳。recon(read-only)で全 JS inline hex を意味分類済。
**着手は codex の Stage1a chrome PATCH 承認(配色 philosophy 確定)後**。lock=dispense-workbench/\*\*(取得済)。

## 方針(codex approved_with_notes 厳守)

- presentational only。hex 文字列 → CSS変数参照(`var(--*)`)。view field の shape・PHASE_ROUTE/PHASE_HREF/
  fkeys/runAction/keydown/store 結線は不変。色"値"のみ差替。
- **B/C/D の分離が肝**: 同じ緑でも「完了状態=state-done(B)」と「audit phase テーマ=phase accent(C)」は別 token。
  紫も waiting状態 / setp phase / compare category の三者別管理。一律 state 化禁止。

## トークン定義(globals.css に追記 or module.css `:root` ローカル。命名・ドキュメント必須)

### 6軸 state(既存・globals.css)へ寄せる(B)

- 完了/監査OK/セット済/調剤済 → `--state-done`(薄背景=tint)
- 差戻し/NG/未調剤/エラー/粉砕バッジ → `--state-blocked`(+tint)
- 保留/監査待ち/作業中/注意/賦形 → `--state-confirm`(+tint)
- 未着手/未セット/disabled/閲覧のみ → `--state-readonly`
- 情報(返信待ち等) → `--tag-info`
- 麻薬 → `--tag-hazard`（6軸 SSOT が麻薬/冷所=hazard。ただし冷所は下記 category 維持で teal 区別を残す＝要最終判断）

### phase accent(C)= local token。state へ map しない。3段構成(dot/strong/border)を保持

| token              | dot(明) | strong(primaryBg) | border(暗) |
| ------------------ | ------- | ----------------- | ---------- |
| `--wb-phase-disp`  | #2f80ed | #2f6fd6           | #245aad    |
| `--wb-phase-audit` | #27ae60 | #2c9a4e           | #218040    |
| `--wb-phase-setp`  | #b07cd6 | #9558c4           | #7c43ab    |
| `--wb-phase-seta`  | #d6905a | #c97b3e           | #a9632c    |

- subdued+palette-aligned 化: hue 維持(disp青/audit緑/setp紫/seta橙)、彩度を navy 帯(S≈40-55%)へ寄せる。
  最終 oklch 値は実装時に決定。dot/strong/border の役割対応を崩さない。
- **rp の「次にセット枠=disp青」「SetAudit枠=audit緑」**(右ペイン cross-phase accent)は現値を該当 phase token で
  そのまま保持(見た目不変)。reclassify しない。

### category/semantic(D)= local token。state/phase へ畳まない

- `--wb-compare`(前回比較=紫 #7c43ab / tint #f3ecf8 / border #ddc8ec)
- `--wb-ptp`(PTP 識別=青 #1d6fb8 / #e6f0fb / #bcd8f3)
- `--wb-reisho`(別包/冷所/特殊=teal #2a7d8f / #e4f3f5 / #bce0e5)
- `--wb-shoni`(小児/注射=rose #a04a6a / #fbe9f0 / #eec4d4)
- `--wb-gaiyo`(外用/残薬=橙茶 #b75a28 / #fdeee6 / #f3cbb3)
- `--wb-tonyo`(頓用/頓服=紫 #7b4ba0、compare と近色だが用途別)
- `--wb-avatar-1..8`(AV_PAL uwv:105-114 患者アバター回転8色)
- `--wb-chip-1..5`(CHIP_PAL uwv:115-121 属性チップ回転5色)

### chrome(A)→ 標準 var(--background/--card/--muted/--muted-foreground/--secondary/--accent/--border/--foreground/--primary)

## LEGEND drift 解消(plp:29-33 ⇄ uwv:291-299)

現状 2/3 状態が値不一致(監査済 #8fd07a≠#5aa84a、作業中 #f3b54a≠#e0972b、未着手のみ一致)。
LEGEND と status を**同一 state token**(done/confirm/readonly)へ寄せ、構造的に drift 解消。
plp:26-28 のコメント(「view 側変更時ここも」)も token 参照へ更新。

## テスト(dispense-workbench/\*.test.tsx)

hex は全て **fixture(view へ渡す入力データ)**。`toHaveStyle`/`toBe('#..')` の DOM style アサートは**無し**。
→ source の var 化でテストは**更新不要で通る見込み**。ただし fixture を実 view と整合させるなら var 文字列へ
揃えるのが望ましい(任意・非必須)。該当: prescription-grid.test:36-40 / medication-calendar-grid.test:25-59 /
prescription-compare-dialog.test:19。

## 要・最終判断(実装時)

1. 冷所を `--tag-hazard`(6軸 SSOT)へ寄せるか、teal `--wb-reisho` で区別維持か(現状 teal で麻薬 amber と区別)。
2. form badge 色の SSOT が `dispensing-workbench.logic.ts` `formOf()` にある可能性(推測)。logic は触らない方針→
   color 値のみ token 化可能か、logic 内 presentational 定数として扱うか実装時に確認。
3. phase accent の subdued 最終 oklch 値。

## 実行順(1b)

1. globals.css に `--wb-*` token を1ブロックで定義(phase/category)+ subdued 値確定。
2. use-workbench-view.ts(色生成中心)を hex→token。B/C/D を分類表通りに。
3. 消費側(right-pane/prescription-grid/medication-calendar-grid/dispensing-workbench/patient-list-panel/
   phase-tabs/dialogs)の残 hex を token へ。LEGEND を status と同 source 化。
4. focused workbench tests + typecheck/no-unused/eslint/prettier/build + hex drift 低減確認 + 4画面 smoke。
5. codex PATCH_REVIEW(Stage1b)。
