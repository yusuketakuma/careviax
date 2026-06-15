# デザイン忠実化ループ 進捗(2026-06-13)

前日ログ: `.codex/design-fidelity-loop-20260612.md`(new 14 枚全合格+P0/P1 大半消化済み)
ユーザー指示(再掲): design/ の写真と一致するまで撮影→比較→修正→再撮影を反復。new/ 優先、残りは design/images/ P0/P1 の未処理分のみ。
体制: サブエージェントが実装、本体は品質確認(撮影→視覚比較→合否判定→差し戻し)+コミット。

## 環境

- 撮影: `DESIGN_SCREEN_IDS=<id> pnpm test:e2e:local -- ui-design-fidelity --project=chromium`
- dev サーバー: `pnpm dev:e2e:local`(3012)稼働中。DB: 5433 ph_os_e2e seed 済み
- 前セッション残の patient-detail リファクタ(labs/workflow-preview 抽出)は検証して 6f85f804 でコミット済み

## 残対象(前日からの引き継ぎ)

1. 精査組: p1_03 / p1_05 / p1_07 / p0_45
2. 新規実装組(D-8): p1_01 / p1_02 / p1_09 / p1_11(外部依存 cc:blocked 候補)/ p1_12 / p1_13
3. route:null 残り: p0_31 / p0_32 / p0_33 / p0_43 / p0_47 / p0_48
4. p0_23 撮影確認 → 本日判定済み(下記)

## 本日の判定

- **p0_23 = 実装案件(E-2d モバイル訪問モード)**: target はモバイル没入型ウィザード(専用ヘッダ PH-OS+未同期2バッジ/患者名+訪問中時刻/ステップドット1-10/未同期写真の橙バナー/1ステップ1画面=服薬3択+メモ/下部バー 保存+次へ)。actual は旧「訪問記録入力」ページのモバイル表示(グローバルヘッダ+入力の流れ+工程カード)で別物。xl 左レール+下部バー(E-2a/2b)はモバイルでは非表示
- 6 枚の target 読解完了: p0_31(残薬調整 3カラム)/ p0_32(薬の安全チェック: CDS 気になる点+確認の流れ 4 ステップ)/ p0_33(証跡の種類 6 種+画像グリッド・同期バッジ)/ p0_43(車両マスター 3 カラム: カテゴリ/一覧 8 件/詳細編集)/ p0_47(印刷するもの 5 種/A4 プレビュー/出力設定+印刷する)/ p0_48(モバイル 390: カメラ+種類チップ 3+写真を撮る+オフライン橙注記)
- 基盤確認: residual-medications / medication-issues + cds/check / visit-vehicle-resources / files(presigned-upload) すべて API あり。UI 実装中心で対応可能

## 実行中(サブエージェント)

- impl-p1-03: /visits/[id]/brief 訪問前まとめ確認(3カラム、visit-brief API + feedback API 接続)
- impl-p1-05: 報告書の共有プレビュー+返信確認(reports 配下、care-team role 別+shared-viewer 射影)
- impl-p0-31: 残薬調整フロー(residual-medications 接続)

## 実装キュー(未着手)

1. p0_32 薬の安全チェック(cds/check + medication-issues)
2. p0_33 証跡写真一覧(files 系)
3. p0_43 車両マスター(visit-vehicle-resources、new_13 マスター画面への統合可否を判断)
4. p0_47 印刷プレビュー(セット指示書等、window.print)
5. p0_48 モバイル証跡撮影(390px、オフライン注記)
6. p0_23 = E-2d モバイル訪問モード(大きめ)
7. p1_07 在庫予測(新 BFF 要 — rate-limit カタログ競合のため単独で)
8. p0_45 キャパシティ(新 BFF 要 — 同上。cockpit/team-capacity から内製)
9. D-8 新規組: p1_01 保存ビュー / p1_02 分割WS / p1_09 ヒヤリハット / p1_12 ルート比較 / p1_13 presence / p1_11 音声メモ(cc:blocked 候補)

## p1_03 完了(本日 1 巡目)— 5357a293

- **p1_03 合格**: /visits/[id]/brief 新設(3 カラム: 根拠になる情報 5 カード=実在タブへのリンク解決 / AI まとめ+薬剤師の確認 3 択 / 次にやること: 訪問モードへ+原文を確認インライン開閉)。id は visit-schedules→visit-records の順で患者解決。3 択は visit-brief-feedback の 2 値 enum へマッピング(needs_review+comment 区別)
- 撮影 setup: visit-brief-paragraph 待ち+「内容は正しい」クリック+トースト出現→消滅待ち(detached 単独待ちは未出現時に即解決して写り込む — attached→detached の順で待つこと)
- 意図的差分: 患者名+生成日時の小書き/fallback 注記/根拠カードの説明+シェブロン(リンク明示)。本文はルール要約(AI プロバイダ未設定環境)のデータ差

## p1_05 完了 — 7ec074a8

- **p1_05 合格**: /reports/[id]/share 新設(3 カラム: 共有する相手 5 区分=care-team role+連絡先補完(施設=facility_staff/家族=続柄)/ 相手に見える内容 5 セクション=報告 content 射影 / 返信・確認=communication-requests 2 段取得+「次回タスクにする」=POST /api/tasks dedupe_key 付き)。新 API なし
- 撮影: 加藤ミサ報告書 cmnhdemorep001amq9ph-os。初期選択はケアマネ(薄青)で target 一致。seed: 加藤ケアチーム 3 件+家族連絡先+ケアマネ返信(responded_at=昨日で new_10 集計を汚染しない)
- 意図的差分: 担当者名サブテキスト/実本文プレビュー/返信見出しの相手連動/WorkflowPageIntro(規約準拠)
- **seed-design-demo.ts は p0_31 分と混在中のためコミット保留**(p0_31 判定後にまとめてコミット)

## p0_31 完了 — (本コミット)

- **p0_31 合格**: /patients/[id]/residual-adjustment 新設(3 カラム: 残薬の確認 3 カード=残N日橙 / 調整案テーブル+医師の指示記録=回答済み疑義照会 inq004 / 次にやること: 残薬写真を追加=青(files presigned 実アップロード)+調整案を確定=緑(POST /api/interventions dose_adjustment+ConfirmDialog))。新 API 0 本
- 提案文は ResidualMedication のみから導出(1日量=残量÷残日数)。頓用(prescribed_quantity null)はテーブル対象外。麻薬 is_prohibited_reduction は BlockedReasonsPanel 行き
- 撮影値も target と同一(28/10/14日、今回は中止・回収/14日分へ調整)。ナビアクティブ「カード」は患者配下配置による意図的差分
- seed(p1_05+p0_31 分)は p0_32 が編集中のため引き続きコミット保留。action-rail.tsx も p0_32 が変更中

## p0_32 完了 — 2de43dee

- **p0_32 合格**: /patients/[id]/safety-check 新設(3 カラム: 気になる点 4 カテゴリ=MedicationIssue+CDS 射影・critical 赤見出し / 確認の流れ 4 ステップ=issue status から済/未導出(in_progress→2済)/ 次にやること=医師への確認を記録(青)+問題なしにする(アウトライン))。新 API 0 本
- action-rail の NextActionPanel に副操作(アウトライン)を optional 追加(既存呼び出し不変、テスト 15 件 green)
- seed: MedicationIssue 4 件追加(issu001〜004)。p1_05+p0_31+p0_32 の seed 分をまとめて本コミットに同梱
- 実行中: impl-p0-43(車両マスター)/ impl-p0-47(印刷プレビュー)/ impl-p0-33(画像・証跡)

## p0_43 / p0_33 / p0_47 完了 — 2a284a70 / 7eea4329 / 85c57279

- **p0_43 合格**: /admin/vehicles(カテゴリ 7=実在 admin ページへのリンク・タグのみ準備中 / 車両 8 台 seed+有効緑 / 編集フォーム+PATCH 新 API 1 本=rate-limit 登録済み)。表示するタグ/メモ→モデル実フィールド(稼働状態/最大訪問件数)の意図的差分
- **p0_33 合格**: /visits/evidence(証跡 6 区分射影+グリッド。未同期橙/同期済み緑+撮影 HH:MM が target のバッジ並びまで一致)。dev 限定 __phosSeedEvidenceDemo 注入。新 API 0 本
- **p0_47 合格**: /reports/print(5 帳票切替+A4 実データプレビュー+出力設定 4 チェック即時反映+window.print)。app-shell の minimal shell 例外に /reports/print 追加。新 API 0 本
- 教訓: screen-map の setup testid は実装の testid を grep で確認してから書く(vehicle-list-row と書いて 30s 待ちが発生→修正で 37s→4s)。並行エージェントが screen-map を編集することがある(Edit 前に再読)

## new 14 枚の回帰確認(共有部品変更後)

- 一括撮影 14 枚 exit 0(全画面描画成功)。new_06(action-rail が最も濃い画面)を視覚確認 → 合格時構成を維持、回帰なし
- 注意: 並行エージェント稼働中の一括撮影は dev 再コンパイルと重なりローディング撮影 flake が出る(new_06 で発生→単独再撮影で解消)。最終回帰確認は全エージェント完了後に行うこと

## p0_48 完了 — fdc07f7e

- **p0_48 合格**: /visits/[id]/capture(没入型モバイル 390。PH-OS 写真+患者名+カメラ黒枠(getUserMedia 失敗時=target どおり)+チップ 3 種(残薬=紫/セット設置=緑/説明資料=紫)+写真を撮る青全幅+オフライン橙注記)
- 基盤: evidence-drafts(dataURL AES-GCM 暗号化、Dexie v7 evidenceDrafts、online イベント自動同期: presigned→PUT→complete→記録 PATCH)。p0_33 ギャラリーに端末ドラフトが「未同期」でマージ表示される
- チップ→p0_33 区分: residual_photo / set_photo / document_delivery(ファイル名往復一致をテスト保証)
- コミット注意: app-shell.test.ts(.ts=純関数)と .test.tsx(レンダー)の 2 ファイルがある — add 時に拡張子を取り違えない(amend で追補した)

## p1_07 / p0_45 完了 — f88cb540 / (本コミット)

- **p1_07 合格**: /admin/inventory-forecast(+BFF canAdmin)。来週=翌週月〜日の visit-schedules×active prescriptions→必要量見込み→在庫突合(要発注<50%<発注候補<100%≤余裕あり)。行順・バッジ色・患者カード 4 枚(施設A 5名集約)まで target 一致。数値は比率一致の現実用量
- **p0_45 合格**: /admin/capacity(+BFF)。KPI 4(訪問枠/調剤セット/稼働%/緊急余力=余白÷60分・橙固定)+行程 6 本+スタッフ負荷+注意点ルール導出。スタッフ 3 本(5人目は new_01 チームの余白を壊すため見送り)・注意点 4 件目は夕方のみ=時間依存の既知差分
- 精査組(p1_03/05/07, p0_45)全消化。route:null 組も p0_31/32/33/43/47/48 全消化
- 残り: E-2d モバイル訪問モード(p0_23)/ D-8 新規組(p1_01 保存ビュー・p1_02 分割WS・p1_09 ヒヤリハット・p1_12 ルート比較・p1_13 presence・p1_11 音声=blocked 候補)

## p1_01 完了 — 0f94502e

- **p1_01 合格**: /views 新設(プリセット 4 枚=定数+純関数、遷移先: 朝の確認→/my-day?focus=visits&visit_filter=unprepared / セット→/medication-sets / 事務→/clerk-support / 管理者→/dashboard。今の絞り込み条件 5 チップ+保存=PATCH me/preferences saved_view optional 追加)。ダッシュボードショートカットに導線
- 既知差分: 「薬切れ近い」等の一部条件は対応クエリ未提供→最も近い一覧へ遷移。保存済みバッジは追加表示

## p1_02 完了 — (本コミット)

- **p1_02 合格**: /patients/compare(?patients=3 ID or board 導出の注目 3 枚)。種別ラベル=prescription_category から導出(emergency seed 無しのため臨時は既定に出ない=既知差分)。今日の見どころ/止まっている理由(重大赤・注意橙)/次にやること(薄青+主操作)/このカードへ。card-workspace の分割表示スタブを実リンク化

## p1_09 完了 — (本コミット)

- **p1_09 合格**: 新モデル IncidentReport(MedicationIssue=患者必須・Task=一覧汚染のため転用不採用、gap-analysis L1300 準拠)+ migration(RLS: ENABLE→POLICY→FORCE 既存作法)+ /api/incident-reports GET/POST+[id] PATCH(status 変更は canAdmin、監査ログは自由記述本文を含めない)+ /admin/incidents 2 カラム
- **教訓: 新 Prisma モデル追加時は dev サーバー再起動が必須**(起動中プロセスは古い Prisma Client を保持 → prisma.incidentReport undefined で 500。generate 済みでも再起動するまで直らない)。migration は E2E DB(5433)適用済み・dev DB(5432)未適用

## p1_13 / p1_12 完了 — 直近 2 コミット

- **p1_13 合格**: /patients/[id]/collaboration(同じカードを見ている人=実 presence 基盤 /api/presence 30s ハートビート+5s ポーリング、E2E は __phosSeedPresenceDemo 注入 / コメント・確認=recent_activities 射影 / 最新を読み込む=実 invalidate)。collaboration-access に patient エンティティ追加
- **p1_12 合格**: /schedules/route-compare(3 案=buildRouteScenarios 純関数: A 同一建物まとめ+早い順/B 希望時間+帰局置換/C 優先度前倒し+都度帰局。移動分は定数近似 16/20/5 分)。適用=PATCH /api/visit-schedules/reorder(担当ごと 1 から振り直し+施設分末尾維持)。ノード数・移動分は本日訪問数依存のデータ差(p0_45 seed の佐藤午後 2 件で 5 ノード化)
- 残り: p1_11(音声メモ第一版、実行中)/ E-2d(モバイル訪問モード、未投入)

## p1_11 完了(第一版)— 直近コミット

- **p1_11 合格(第一版)**: /visits/[id]/voice-memo(録音=MediaRecorder→AES-GCM 暗号化 IndexedDB(Dexie v8 voiceMemoDrafts、訪問につき最新 1 件)→再生/訪問記録へ入れる=soap_subjective へ PATCH 追記(楽観ロック対応))。波形は決定的ダミー
- **cc:blocked**: 文字起こしエンジン(STT 外部依存)— 「文字にする」は準備中スタブ+__phosSeedVoiceMemoDemo で転写済み状態を注入して撮影。音声のサーバー保存も第一版対象外(files API の visit-photo mime が画像/PDF のみ — STT 接続時に語彙拡張と合わせる)
- 残り: E-2d(p0_23 モバイル訪問モード)のみ実行中

## E-2d(p0_23)完了 — 6d2d725b + カタログ修正 16720de9

- **p0_23 合格**: モバイル訪問モードウィザード。シェルは CSS ベース(shouldUseMobileImmersiveShell → AppHeader/MobileNav を max-md:hidden、md 以上 DOM 不変)。専用ヘッダ(PH-OS+未同期バッジ=evidence-drafts 件数)+ステップドット 9(タップ移動)+橙バナー+1 ステップ 1 画面(全セクション常時マウント・CSS 表示制御で RHF 状態不変)+下部バー(保存+次へ、最終=訪問完了緑)
- 服薬 3 択: structured_soap.objective の既存 MEDICATION_STATUS_OPTIONS+adherence_score へ射影(新フィールドなし)。逆引きは該当ペアのみ(拒薬等を誤上書きしない)
- **p0_22(デスクトップ)回帰なしを撮影確認**。SoapStepWizard は未使用化(ファイル残置 — 削除判断は後続)
- **fix**: p1_09 の IncidentReport が data-explorer-catalog 未分類で full vitest 1 failed → frontend_api に分類追加(16720de9)。**教訓: 新 Prisma モデル追加時は data-explorer-catalog の分類登録も必須**(rate-limit カタログと同様の同期テストがある)
