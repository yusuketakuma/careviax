# デザイン忠実化ループ 進捗(2026-06-12 夕)

ユーザー指示: ①design/images/new/ 14枚と一致するまで撮影→比較→修正→再撮影を反復。
②14枚完了後、design/images/(P0/P1)のうち new でカバーされない画像のみを読み取り反映。
レビュー→実装→テストの順を守る。

## 環境

- 撮影: `DESIGN_SCREEN_IDS=new_XX pnpm test:e2e:local -- ui-design-fidelity --project=chromium`
- 出力: `tools/tests/.artifacts/design-fidelity/<id>.actual.png`(4400x2750 = 1600x1000 の 2.75x)
- 比較: PIL クロップ(/tmp/design-crops/)で精査。座標は 1600 基準 × (width/1600)
- dev サーバー: `pnpm dev:e2e:local`(3012)、DB: 5433 ph_os_e2e。seed 済み(事務2名追加済み)

## 画面別状態

| 画面 | 状態 | 残差分 |
|------|------|--------|
| new_01 dashboard | 合格(再撮影済み) | なし(時刻起因のデータ差のみ) |
| new_02 patient_list | 4列化修正→再撮影で4列確認済み | 合格 |
| new_03 schedule | **構成合格**(3レーン+訪問ブロック+リスクバナー+未確定) | day-board UTC境界修正(67323b09)+休み除外(次コミット)で解消 |
| new_04 visit | **構成合格**(伊藤4/4緑・田中⚠+繰り下げ注記+3/4橙) | 描画待ち setup 追加で解消。件数/滞在分はデータ差 |
| new_05 import | **構成合格**(キュー表+重複検知バナー+工程チップ) | オンライン受入判断行は seed データ差。右レールは修正済み・最終一括再撮影で確認 |
| new_06 card | 差分1件 | **「このカードに紐づく今日」が右レール内 → target は本文中央の独立カラム(3カラム)。card-workspace.tsx の 2xl 3カラム化が必要** |
| new_07 dispense | 構成合格 | キュー件数=データ差 |
| new_08 audit | 構成合格 | 計数進行状態=データ差 |
| new_09 set | 構成合格 | 居室数・担当者=データ差 |
| new_10 report | 構成合格 | 患者ラベル電話番号事象も解消済み |
| new_11 billing | 構成合格 | 件数=データ差 |
| new_12 handoff | 構成合格 | 文言レベルで一致 |
| new_13 master | 構成合格 | バッジ状態=データ差 |
| new_14 settings | 構成合格 | 「WIP設定」vs target「WIP目安」の文言要確認 |

## 2巡目完了(2026-06-12 18:40)

- new_06 3カラム化を最終一括再撮影で検証 → **合格**(紐づく今日が中央カラム、右レールにボタン先・患者=紫/事務=黄/医療機関=青が反映)
- **new_01〜14 全画面構成合格**。残るは full vitest 最終検証のみ
- 副産物: gitignore reports/ に隠れて未コミットだった実装13ファイルを救出(bf01881a, bfaaa577)

## 次フェーズ: design/images/ P0/P1(new 未カバー分 約40枚)

new がカバー済み(new を正とする): p0_07(=new_01), p0_16(=new_03), p0_09(=new_05), p0_08(=new_06), p0_12(=new_07), p0_13(=new_08), p0_14/15(=new_09), p0_28/29(=new_10), p0_30(=new_11), p0_27(=new_12), p0_39-43 概要(=new_13), p0_44(=new_14)
対象(旧画像が有効): p0_01-06, p0_10, p0_11, p0_17-26, p0_31-38, p0_45-48, p1_01-14
手順: `DESIGN_SCREEN_IDS=p0_,p1_ pnpm test:e2e:local -- ui-design-fidelity --project=chromium` で一括撮影(screen-map に 62 画面マッピング済み)→ 1画面ずつ target/actual 比較 → 差分修正。
P0 の過去判定: p0_04/05/06/07/08 は D-2 で合格済み(p0_05 のみ再撮影未確認)。

## 発見した実バグ(デザインループの副産物)

- **day-board の JST 当日取りこぼし**(67323b09 で修正): `new Date('<key>T00:00:00')`(ローカル解釈)を @db.Date カラム条件に渡すと Prisma が UTC 日付へ切り捨て → JST では全日、前日の訪問だけ返していた。スケジュール画面のガント・リスクバナー・余白試算すべてに影響していた。回帰テスト3件追加。
- 同パターンの残存が他 route にある可能性 → `rg "T00:00:00\`" src/app/api` で横断確認する価値あり(次ループ候補)。

## 完了した修正(コミット済み)

- de184ed fix: show patient summary mini card on mobile
- 5a5f6ba feat: align dashboard cockpit rail with the new design target
  (NextActionPanel ボタン先、患者=violet/事務=amber/医療機関=blue、私の今日削除、family_consent_pending→患者)
- 3a72ef0 feat: add team capacity card to the dashboard cockpit
  (team_capacity API+TeamCapacityCard+buildTeamHandoffSuggestion+seed 事務2名(鈴木=勤務/田中真=本日休み)+gitignore /reports/ 誤爆修正)
- 355795a fix: restore four-column patient board at 1600px(2xl:grid-cols-4)

## 既知の意図的差分(差分にカウントしない: Plans.md L117)

- 止まっている理由見出しの赤丸件数バッジ非対応
- SafetyBoard サブタイトル常時表示
- EvidencePanel の「開く」はアウトラインボタン(target は青テキストリンク)

## 注意

- Route Handler は GET 以外 export 禁止 → ヘルパーは隣接ファイルに切る(team-capacity.ts 方式)
- DashboardCockpitResponse を使うテストフィクスチャは7+1ファイル(team_capacity 必須)
- mobile-chromium プロジェクトでも fidelity spec が走る(new_05 で1失敗あり、未調査)。撮影は --project=chromium 指定が速い
- Tailwind named breakpoint 同士でないと CSS 順序が不定(min-[...] が xl に負けた前例)
