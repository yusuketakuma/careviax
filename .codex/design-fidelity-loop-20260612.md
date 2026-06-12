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

## 最終検証の記録(2026-06-12 18:55)

- full vitest 2回実行: 1回目 2 failed / 2回目 4 failed(validate-phos-deploy-template, api-gateway-routes, day-view, schedule-proposals-content)— **すべて単独実行で green(98 tests)**。dev サーバー並走による高負荷 flaky(import 1468s = 通常の4倍超)で、回帰ではない。
- 全変更ファイルの focused テストは一貫して green。コミット済み変更は健全。

## P0/P1 フェーズ(進行中)

- 撮影: `DESIGN_SCREEN_IDS=p0_,p1_ --project=chromium` 実行中(route 確定の約30画面)
- 比較対象(new 未カバー+route 確定 ≈16枚): p0_01 login / p0_04 notifications / p0_05 search(D-2 残: 再撮影未確認)/ p0_06 search modal / p0_10 prescriptions/new 期間入力 / p0_17 proposals / p0_22-24 visits(タブレット・スマホ・施設)/ p0_25 my-day / p0_26 contact-profiles / p0_29 communications/requests / p0_38 patients プロフィール / p0_45 capacity(PHOS_API 依存注意)/ p1_04 reports AI 下書き / p1_06 admin/analytics
- route: null ≈24枚は未実装の新規画面(D-6: p0_02/03 薬局・モード選択, p0_34/35 オフライン同期 / D-8: p1 大半)→ 実装タスクとして Plans.md 対応。撮影ループの範囲外

## P0/P1 1巡目の判定(2026-06-12 19:25 時点)

- 撮影: 比較対象16画面すべて captured(40 passed)。撮影終盤に dev サーバーがコンパイル中に死亡 → 再起動済み(撮影成果には影響なし)
- p0_05 検索: 「検索中...」のまま撮影(一括撮影中の cold compile 渋滞で 6 並列 fetch が 20s 内に揃わず)→ warm 再撮影で再判定
- **p0_22/23(訪問モード)は実装案件**: target はステップウィザード(1.到着確認〜10.完了チェック+服薬3択+写真・証跡+一時保存/次へ/訪問完了バー)。現実装 /visits/[id]/record は SOAP フォーム(1858行)で別物。Plans.md D-4 に対応。screen-map ルートも暫定(/visits 一覧)のまま
- p0_24(施設一括訪問パケット)も同様に D-4 範囲の可能性大
- 残り比較対象(未比較): p0_01 login / p0_04 notifications(D-2合格済み・再確認のみ)/ p0_10 期間入力(ステップ操作要)/ p0_17 proposals / p0_25 my-day / p0_26 contact-profiles / p0_29 communications/requests / p0_38 patients profile / p0_45 capacity / p1_04 / p1_06

## P0/P1 比較の確定判定(2026-06-12 19:40)

- **p0_05 合格**(単独 warm 再撮影で結果カード+チップ件数表示を確認)。「検索中...」は p0_05/06 連続実行時の撮影 flake(API は並列でも 50ms、ブラウザ再現でも 6/6 成功)。カテゴリ選択式は D-2 設計判断済みの意図的差分 → Plans.md D-2/D-2-3b を cc:完了 化
- **p0_22/23(訪問モード)= 実装案件**: target はステップウィザード(到着確認〜完了チェック 10 ステップ+服薬3択+写真・証跡)。現 /visits/[id]/record は SOAP フォーム。D-4 対応
- **p0_25(事務サポート)= 実装案件**: target は事務ロール専用ダッシュボード(事務でできること 6 KPI+作業テーブル+薬剤師相談リスト)。現 /my-day は薬剤師向け別物
- 残り未比較(次ループ): p0_01 / p0_04 / p0_10 / p0_17 / p0_24 / p0_26 / p0_29 / p0_38 / p0_45 / p1_04 / p1_06(actual はすべて captured 済み、target との見比べのみ)

## P0/P1 2巡目の判定(2026-06-12 19:55)

- **p0_38 合格(意図的差分)**: 旧3カラム静的プロフィールは D-2-2 のタブ型ワークスペース(?view=profile)に置き換え済み。screen-map ルートをデモ患者 ?view=profile に差し替え済み
- **p0_01 修正・合格(076af1bd)**: MFA 確認コード事前案内ボックス追加+「ログインする」+サブタイトル「在宅薬局オペレーション」統一+spec 追随
- **p0_17 = 実装案件**: target は提案確定フロー詳細(候補日時3択/5ステップ進行/確認メモ+了承済みにする)。actual は提案一覧ダッシュボードのみ。new_03「未確定」との設計整合を決めてから実装
- 残り未比較 7 画面: p0_10(期間入力 setup 要)/ p0_24(施設訪問 — D-4 寄り)/ p0_26(送付先編集)/ p0_29(返信管理)/ p0_45(キャパシティ — PHOS_API スタブ要)/ p1_04(AI 下書き setup 要)/ p1_06(分析)。actual は captured 済みで target 比較のみ
- 実装案件まとめ(設計→実装の順で次セッション以降): p0_17 確定フロー / p0_22-24 訪問モードウィザード(D-4)/ p0_25 事務サポート / route:null 群(D-6 オフライン同期・薬局選択、D-8 P1 系)

## 3巡目判定(2026-06-12 20:05)

- **p0_26 = 実装案件(設計判断要)**: target は患者単位の送付先一覧+編集(FAX未登録の赤警告等)。actual は admin の連携先プロファイル(マスタ)。患者文脈の送付先編集をカード/患者詳細配下に置くか、admin で代替かを決めてから実装
- **p0_29 = new_10 に統合済み(意図的差分)**: 返信待ち/再送/今日解決した待ちは new_10 報告・共有で合格済み。「返信内容詳細→次回カードへ残すこと→対応済み」の到達動線だけ未検証(設計確認事項)
- 残り未比較 5 枚: p0_10(期間入力 setup 要)/ p0_24(施設訪問 D-4寄り)/ p0_45(キャパシティ PHOS_API スタブ要)/ p1_04(AI下書き setup 要)/ p1_06(分析)

## 持続ループの次アクション(優先順)

1. p1_06(分析)/ p0_45 / p0_24 の比較判定(actual 撮影済み、target 見比べのみ)
2. p0_10 / p1_04 の撮影 setup 実装 → 撮影 → 判定
3. 実装案件の着手(小→大): p0_26 送付先編集(設計判断→実装)→ p0_17 確定フロー → p0_25 事務サポート → p0_22-24 訪問モードウィザード(D-4)→ route:null 群(D-6/D-8)
4. 各実装はレビュー→実装→テスト(focused vitest green)→撮影検証→コミットの順

## 4巡目判定(2026-06-12 20:15)— 比較可能分の判定完了

- **p1_06 = 部分統合+残実装(D-8 後方)**: 工程ボトルネック/改善ヒントは new_01(工程の今+詰まり注記+チームの余白)に運用統合済み。月次訪問件数グラフと「改善のヒント」分析ページが残
- **p0_24 = 部分統合+D-4 残実装**: 居室順/施設チェックリスト/配薬カートは new_04/new_09 に統合済み。施設パケット詳細(入館方法・駐車場・ナースステーション・服薬カート・申し送り+施設用メモ印刷)は D-4 訪問モードと一体で実装
- 撮影準備が必要な3枚(比較保留): p0_10(期間入力ステップ操作 setup)/ p0_45(PHOS_API スタブ)/ p1_04(AI下書きビュー操作 setup)

→ **target 画像 62 枚すべてについて「合格/意図的差分/実装案件/撮影準備要」の判定が完了**

## 確定した実装案件キュー(レビュー→実装→テストで順次消化)

A. p0_26 患者送付先編集(設計判断: カード配下 vs admin 代替)— 小〜中
B. p0_17 提案確定フロー詳細(new_03 未確定との整合)— 中
C. p0_25 事務サポートダッシュボード(事務モード時のホーム)— 中
D. p0_10 期間入力 setup +判定 / p1_04 AI下書き setup +判定 — 小(撮影基盤)
E. p0_22-24 訪問モードウィザード+施設パケット(D-4)— 大
F. route:null 群: p0_02/03 薬局・モード選択、p0_34/35 オフライン同期(D-6)、p0_31/33/36/37/43/47/48、p1 系(D-8)— 大(複数画面)

## 5巡目: p0_10 判定+実装案件 A の設計(2026-06-12 20:25)

- **p0_10 = 部分統合+実装案件(中)**: 期間入力は new_05 取込→構造化入力に対応。専用の「服用期間+薬の加工指定チップ(一包化/粉砕/分包しない/別包/セット対象外)+止まっている理由(回収予定未入力/粉砕可否確認)」ビューは残実装。実装キュー D→中規模に再分類

### 実装案件 A(p0_26 患者送付先編集)設計案 — 次ループで実装

- 基盤は既存: CareTeamLink(role/name/organization_name/phone/email/fax)+ `/api/patients/[id]/care-team` route
- 次ループ手順:
  1. care-team route の GET/POST/PATCH 能力と認可・監査を確認(レビュー)
  2. UI: 患者詳細 ?view=profile の基本情報系に「送付先・連絡先」セクション新設 — 一覧カード(role 別ラベル: 主治医/ケアマネ/訪看/家族、FAX未登録は赤警告、メールOK/電話のみのサブ文)+ 編集(宛先/担当者/FAX/電話/送付方法)
  3. 送付方法は new_10 のテンプレート文脈(PH-OS共有/FAX/PDF)と整合させる(CareTeamLink.preferred_channel 的な既存列が無ければ第一版は表示のみ)
  4. focused vitest + p0_26 ルートを ?view=profile 側に差し替えるか判断 → 撮影検証 → コミット
