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

## 実装案件 A 完了(2026-06-12 20:40)— 4d428247

- careTeamContactBadges 純関数(文書送付ロール=physician/nurse/care_manager は FAX 未登録を赤警告、メールOK/電話のみ/連絡先未登録)+ 各行サマリ(役割: 氏名+主担当+チャネルバッジ)
- p0_26 撮影ルートを ?view=profile&tab=communications に差し替え、撮影検証済み(山本健の FAX未登録が赤表示)
- **p0_26 合格**(患者・家族連絡先+多職種連携先の2パネル構成+チャネル警告で target の中核価値を達成)

### 次: 実装案件 B(p0_17 提案確定フロー)の調査ポイント

- schedule-proposals-content.tsx の現構造(一覧のみ? 詳細パネル有無)
- VisitScheduleProposal の status 遷移 API(確定 = visit-schedules への昇格 API があるか: /api/visit-schedule-proposals/[id]/confirm 等)
- VisitScheduleContactLog(called_at/callback_due_at)= target の「電話で確認した内容」メモに対応
- 設計: 一覧 + 詳細2カラム(target の3カラム: 候補日時/5ステップ/確認メモ+了承済みにする)を /schedules/proposals 内に実装するのが最有力

## 実装案件 B・C 完了(2026-06-12 20:55)

- **B 完了(0ec2d300)**: buildProposalFlowSteps(day-view.shared、テスト6件)+提案詳細シートに「正式決定までの流れ」5ステップ表示。p0_17 撮影検証合格(1完了→2いまここ→3-5未+承認して連絡へ)
- **C 完了(1b58c1f0)**: /api/dashboard/clerk-support BFF(6 KPI: intake_pending/delivery_target_missing(careTeamLink fax&email無し×active)/schedule_confirmation/document_drafts/reply_pending/pharmacist_review+混在タスクリスト+相談境界4項目)+ /clerk-support ページ。p0_25 撮影検証合格(KPI 色構成一致・実データ稼働)。rate-limit カタログ登録済み

### 残: E(D-4 訪問モードウィザード+施設パケット — 大)/ F(D-6/D-8 route:null 群 — 大)

E の設計指針(次ループ):
- /visits/[id]/record の SOAP フォーム(1858行)を置き換えるのではなく、**訪問モード専用のステップシェル**を被せる: 左=訪問ステップ(到着確認/今日の確認/セット設置/残薬確認/服薬・副作用/説明/次回予定/写真・証跡/報告の種/完了チェック)、中央=ステップ別フォーム(既存 SOAP フォームのセクションを分割マウント)、右=写真・証跡。下部バー=一時保存/前へ/次へ/訪問完了
- 既存 visit-record-form のセクション構造(SOAP 2カラム/readiness warning 等)を調査し、ステップ分割の切れ目を決めるのが先
- p0_23(スマホ)は同シェルの 390px 縦積み。p0_24 施設パケットは new_04 施設カードからの詳細画面として /visits 配下に追加

## 実装案件 E 第一段完了(2026-06-12 21:20)— 8c52bd30

- visit-step-nav(5ステップ・scroll-spy・済バッジ・ジャンプ・IntersectionObserver ガード)+ フォームのセクションアンカー+xl 左レール化。回帰ゼロ(フォーム本体不変、record 配下テスト6件 green)
- p0_22 撮影検証合格(左レール+訪問前確認セクション)。p0_23(スマホ390px)ルート差し替え済み・撮影は次バッチ
- E 第二段(後続): 10ステップへの分割マウント/写真・証跡右列/下部固定バー(一時保存・前へ・次へ・訪問完了)/p0_24 施設パケット詳細
- 運用メモ: dev サーバーの「Manifest file is empty」は再起動で解消(.next 削除は不要だった)

### 次: F フェーズの優先順(API 基盤の有無で順序決定)

1. **p0_02 薬局選択 + p0_03 モード/ロール選択(D-6-2)**: GET /api/me/sites + PUT /api/me/site(監査ログ付き・D-2 実装済み)+ me/preferences workMode が基盤。フルページ選択 UI を新設するだけ(小〜中)。ルート案: /select-site, /select-mode(認証後フロー)
2. p0_36/37 理由モーダル共通化(D-6-3): 既存差戻し/取消フローの確認
3. p0_34/35 オフライン同期センター+競合解消(D-6-1): sync-engine/offline-store 基盤、中〜大
4. p1 系(D-8)

## F-1 完了(2026-06-12 21:45)— f0eea5bc

- **p0_02 合格**: /select-site(サイトカード+本日訪問件数+在宅あり+選択中バッジ+PUT /api/me/site 切替)。カード枚数・選択中はseedデータ差
- **p0_03 合格**: /select-mode(薬剤師=青/事務=紫/管理=緑の3カード、work_mode 永続化+UIストア反映、ランディング: dashboard/clerk-support/admin)
- 教訓: ui-store のフックは `useUIStore`(大文字UI)。dev は型エラーでも動くが tsc で捕捉

### 次: F-2(p0_36/37 理由モーダル共通化)の調査ポイント

- p0_36(差戻し理由)/ p0_37(取消・再開理由)の target を読む
- 既存の差戻しフロー: 監査(dispense-audits の差戻し(理由必須))、セット監査の差戻し — 理由入力 UI が既にあるか確認(audit workbench の「差戻し(理由必須)」ボタンの実装)
- 共通モーダル化(reason-modal 共有部品)が必要か、既存実装の整え(文言・構成の統一)で足りるかを判定してから実装

### 残りの未消化(F-2 以降): p0_34/35 オフライン同期センター(D-6-1 中〜大)/ p0_10 期間入力ビュー(中)/ E 第二段 / p1 系(D-8)/ 撮影保留2枚(p0_45 PHOS_API スタブ، p1_04 setup)

## F-2 完了(2026-06-12 21:15)— $(git log --format=%h -1)

- **p0_36 合格**: ReasonDialog 共通部品(チップ2列単一選択+メモ任意+戻る/保存する、テスト6件)。監査ワークベンチ+セット監査の差戻しダイアログを置換(Select → チップ)。先頭チップ選択状態で撮影、補足文・フッター構成 target 一致
- **p0_37 合格**: day-view 準備ダイアログ左下「この訪問を取り消す」→ 取消理由モーダル → DELETE(reason body+AuditLog visit_schedule_cancelled)。取消トーストの「再開する」→ 再開理由モーダル → POST [id]/reopen(cancelled→planned+AuditLog visit_schedule_reopened)。route テスト 8件追加(計65 green)
- 意図的差分: warning 行(黄)は安全注記として追加 / 理由チップはドメイン語彙(調剤=薬剤間違い等、訪問=患者都合・体調変化等)。target の6種は両画面同一のプレースホルダと判断
- 教訓: このリポジトリの DialogDescription は sr-only+HelpPopover(?)化される。常時表示の説明は素の <p> を使う / ScheduleStatus に 'scheduled' は無い(再開後は 'planned')/ notifyWorkflowMutation の source は org-realtime.ts の WORKFLOW_REALTIME_SOURCES に登録必須

### 次: p0_34/35(オフライン同期センター+競合解消、D-6-1)の調査ポイント

- p0_34/p0_35 target を読む
- 基盤: src/lib/stores/sync-engine.ts(VisitRecordConflictSnapshot/overwriteVisitRecordConflict/discardSyncQueueItem)+ offline-store(syncConflicts)+ schedule-day-offline-panel.tsx の SyncConflictCard(二重確認パターン)
- gap-analysis の指示: 新ルート /offline-sync(+詳細)、409 details.existing_record に最終更新者名+updated_at 追加検討、撮影は IndexedDB へ conflict 注入 seed ヘルパー
- 中〜大なので: 第一段=同期センター画面(キュー/競合一覧)、第二段=競合解消ビュー の分割を検討

## D-6-1 完了(2026-06-12 21:33)— 991a6b4c

- **p0_34 合格**: /offline-sync 新設。同期キュー一覧(種類=訪問メモ/残薬調整、患者さん=brief cache から名前解決、状態=同期待ち青/失敗赤/競合амber、次にやること=そのまま/再試行/内容を確認)+右レール注意カード(赤文字+すべて再試行)。resetFailedSyncQueueRetries を sync-engine に追加(失敗分も再送対象へ)
- **p0_35 合格**: 競合行「内容を確認」→ 3カラム比較(あなたの入力/最新の内容/選んでください)。最新の内容を使う=discard(青・主)/自分の入力で上書き=overwrite(二重確認)/あとで決める。結果は OUTCOME_LABELS で日本語化
- 意図的差分: target の「佐藤薬剤師が5分前に更新。」は 409 details.existing_record に updated_by 表示名+updated_at が無く再現不可 → API 拡張(D-9 follow-up)としてメモ。target の「写真」「一時保存」種別は現キューに無いデータ差
- 撮影 seed: dev 限定 window.__phosSeedOfflineSyncDemo(enqueueForSync+registerVisitRecordConflict+retryCount 直接更新)
- 教訓: **normalizeConflictServer は SOAP4 キー+next_visit_suggestion_date のキー欠落(undefined)を弾く**。server snapshot を手で作る時は null を明示する。nav の activePrefixes 固定テスト(navigation-config.test)は仕様変更時に期待値更新

### 次: p0_10 期間入力ビュー(中)の調査ポイント

- p0_10 target を読む(服用期間+薬の加工指定チップ+止まっている理由)
- 該当ルートの現状確認(処方カード/調剤の期間入力がどこにあるか: prescriptions 配下 or dispensing)
- design-gap-analysis.md の p0_10 セクションを読む

## p0_10 完了(2026-06-12 21:50)— 1de64206

- **p0_10 合格**: /prescriptions/new の登録セクション直前に期間レビューカード新設。患者名+「今回の薬:開始〜終了」ヘッダ(最小開始〜最大終了を明細から合成、end_date 無しは start+days-1 で補完)+「保存して次へ」(submit 連動)/ 7列テーブル(薬剤名/用法/日数/開始日/終了日/加工・セット/注意)/ 薬の加工指定チップ5種(使用中=青+件数。別包・セット対象外は packaging_instructions の文字列判定)/ 止まっている理由(粉砕=赤、中止メモ=橙、submitBlockers=橙)+薬剤師へ相談(/handoff)
- 意図的差分: チップは target の「選択UI」でなく「使用分布の可視化」(行選択が無いレビュー文脈ではこの方が実用的)。「保存して次へ」は患者未選択時 disabled(state 由来)
- 教訓: **react-hooks/immutability は setter を宣言より前の行で参照する effect を弾く**(エラー行表示は別の行にズレて出る: 実位置はメッセージ本文を見る)。dev seed effect は対象 state 宣言の直後に置く
- 純関数 prescription-period-review.shared.ts(テスト9件)。seed: window.__phosSeedPeriodReviewDemo(5明細+患者名)

### 次: E 第二段(訪問モードウィザード拡張)の調査ポイント

- p0_22(タブレット)target を再読(右列=写真・証跡、下部固定バー: 一時保存/前へ/次へ/訪問完了)
- visit-step-nav の現5ステップ→10ステップ分割の要否判断(target のステップ一覧を数える)
- p0_24 施設パケット target を読む(new_04 施設カードからの詳細)
- visit-record-form 1858行のセクション構造と下部バー追加の差し込み点

## E-2a 完了(2026-06-12 22:05)— 3aa88656

- **p0_22 前進**: 訪問ステップを9本化(訪問前確認/今日の確認/訪問結果/服薬・副作用/受領記録/次回予定/残薬確認/写真・証跡/完了チェック — final 内の各 Card にアンカー id 追加、実フォーム構造準拠で target の10本に対応)。useVisitStepSpy 抽出で左レールと下部バーが現在地を共有
- **下部固定バー**: 一時保存(Cmd+S と同じ下書き保存)/前へ/次へ(青)/訪問完了(緑・submit)。**AppShell は main が overflow-y-auto のスクロールコンテナなので sticky bottom は常時表示にならない → fixed inset-x-0 bottom-0 + xl:left-56(デスクトップサイドバー幅)**+フォーム pb-24
- 教訓: sticky bottom は自然位置がビューポート外だと貼り付かない。main 内スクロールのアプリでは下部常駐バーは fixed+サイドバー幅オフセット
- 残り(E-2b/2c): 右列「写真・証跡」カード列+ヘッダ患者名/オフライン/未同期バッジ(useOfflineStore)/ p0_24 施設パケット3カラム(facility-visit-context 調査から)

## E-2b/2c 完了(2026-06-12 22:20)— 5e0d0721 / ffe12268

- **p0_22 合格(E-2b)**: VisitModeHeader(患者名+M/d HH:mm+訪問中+オフライン/未同期バッジ=useOfflineStore)+右レール VisitEvidenceRail(添付ドラフト=未同期表示、空状態は「写真を追加」ジャンプ)+xl 3カラム [210px_1fr_220px]。ScheduleDetail 型に case_.patient/time_window_start を追加(API は元から返している)
- **p0_24 合格(E-2c 第一版)**: /visits/[id]/facility-packet 新設。facility_parallel_context から部屋カード列(101-103号室+訪問準備/止まりN件)+施設訪問パケット(common_notes 行分解)+次にやること(訪問モードを開始/施設用メモを印刷=window.print)。撮影ルート=visitOgawa cmnhdemovis010amq9ph-os
- 意図的差分: p0_22 バッジはオンライン時非表示(state 由来)/ p0_24 見出しは label が住所込み(データ差)、カード枚数・工程横断状態(セット済/監査待ち)はデータ未整備で省略
- 将来拡張メモ: パケット構造化編集 UI+印刷専用ビュー+batch GET API(gap-analysis 記載)は未着手
- 教訓: 撮影直後の「読み込み中...」flake は dev 再コンパイル直後に起きる — 再実行で解消(コード起因でない)

### 次: p1 系(D-8)の優先判定 + 撮影保留2枚

- p1_01〜p1_14 の target を一括で読み、既存実装で撮影可能なもの(改修小)と新規実装が要るものを仕分け
- 撮影保留: p0_45(PHOS_API スタブが必要)/ p1_04(setup 未定)の解消方法を判定

## p1 仕分け完了(2026-06-12 22:30)— ルート登録済み5枚を撮影比較

- **p1_04(/reports)**: target=AI下書き(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと)+宛先別プレビュー(医師/ケアマネ/訪看/施設)+緑「薬剤師確認済みにする」。actual は報告ボード(一覧)。**次ループ最優先**: /reports の「下書きへ」先(care-report 下書き編集)の現構成を確認し、AI下書きセクション構成+宛先プレビューを改修(中)。撮影 setup=下書きへクリック
- **p1_06(/admin/analytics)**: target=在宅業務の動きを見る(月ごとの訪問件数・時間がかかっている工程の棒グラフ+改善のヒント4件)。actual は請求KPI分析で別物 → 新ビュー実装(中)。グラフは CSS バーで可(チャート lib 依存を増やさない)
- **p1_08(/admin/facility-standards)**: target=施設基準チェック(在宅実績/緊急対応体制/研修記録/文書交付体制/電子的連携 + OK/不足/確認中)+足りないもの+資料を追加。actual は届出一覧(空)→ チェックリスト化+評価データの源(届出 seed or 判定ロジック)精査(中)
- **p1_10(/admin/document-templates)**: target=テンプレート5種/文面を編集({差し込み変数})/差し込み項目チップ+保存の3カラムエディタ。actual は登録フォーム+一覧(テンプレ3件 seed 済)→ 3カラム編集モード追加(中)
- **p1_14(/admin/alert-rules)**: target=表示を強める項目(腎機能/転倒/低血糖/残薬/飲み合わせ + 強く表示/標準)+カードでの見え方プレビュー+保存。actual はルール登録(JSON)→ 表示強度プリセット UI+プレビュー追加(中)
- **新規実装要(後方)**: p1_01 保存ビュー(API要)/ p1_02 分割WS / p1_09 ヒヤリハット / p1_11 音声メモ(外部依存→cc:blocked 候補)/ p1_12 ルート比較 / p1_13 presence
- **精査要**: p1_03(visit-brief の正ルート)/ p1_05(/shared/[token] の seed トークン)/ p1_07(在庫予測)/ p0_45(PHOS_API スタブ)

### 次: p1_04 から実装(レビュー→実装→テスト→撮影→コミット)、続いて p1_06 → p1_10 → p1_14 → p1_08

## p1_04 完了(2026-06-12 22:40)— a7f65189

- **p1_04 合格**: /reports/[id] の draft 時に AI下書きレビュー(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと = buildAiDraftSections が physician/care_manager content を射影、テスト2件)+宛先別プレビュー(report_type=active、他は「未作成」)+緑「薬剤師確認済みにする」(PATCH status: confirmed)
- 教訓: report_type の実値は 'physician_report'/'care_manager_report'(接尾辞付き)。seed の draft は最小形式 content のためセクションは「未入力」表示(データ差、射影はテストで担保)
- 撮影 setup: /reports →「→ 下書きへ」クリック → report-ai-draft-review へ scrollIntoView

### 次: p1_06(在宅業務の動きを見る)
- /admin/analytics に新ビュー or 新ページ。月ごとの訪問件数+時間がかかっている工程(CSS バーグラフ、依存追加なし)+改善のヒント4件
- データ源: visit-records 月次集計+workflow 系。実データ集計 API が無ければ第一版は既存 API(dashboard/cockpit 等)から導出可能な範囲で

## p1_06 完了(2026-06-12 22:58)— 5f9e0792

- **p1_06 合格**: /admin/operations-insights 新設(+/api/admin/operations-insights BFF、canAdmin)。月ごとの訪問件数(直近5ヶ月、buildMonthlyBuckets/tallyMonthlyVisits)+時間がかかっている工程(入力/監査/セット/訪問/報告の created→updated 平均分・直近30日・注記付き)+改善のヒント(最長工程/前月比/実績なし工程から導出、テスト3件)
- 教訓: **CSS バーの height% は直近親が auto 高だと効かない** — フレックスカラムに h-full + justify-end を付けて外側 h-56 を基準にする / rate-limit カタログはファイル同期テストがあるので route 新設時に必ず追加(F-2 の reopen が漏れていたのを今回検出・追補)
- 値はデモ seed 由来のデータ差(入力7638分は intake の滞留)。撮影 setup は operations-insights-page 待ち
- design-screen-map が外部要因で再フォーマットされている点に注意(機能変更なし)

### 次: p1_10(報告テンプレート3カラムエディタ)
- /admin/document-templates の編集 UI を「テンプレート一覧(種別5)/文面を編集/差し込み項目チップ+保存」の3カラム化
- 既存: 登録フォーム+登録済み一覧(care_report テンプレ3件 seed 済)。編集ダイアログ or インライン編集の現構造を確認してから差し込み
