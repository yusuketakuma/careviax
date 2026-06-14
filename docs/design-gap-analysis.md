# Design Gap Analysis — design/ v1.9 画面別ギャップ調査

> 生成: 2026-06-11 マルチエージェント並列調査(9 エージェント)による。
> SSOT は `docs/design-fidelity-mapping.md`(進捗管理)。本書は画面別の詳細ギャップ・バックエンド提案の参照資料。
> 機械可読版: `docs/design-gap-analysis.json`

## 画面別ギャップ一覧

### p0_04_notification_center

- 種別: 改修 / 工数: M / 対応ルート: `/notifications`
- デザイン: 見出し「お知らせ」+説明「急ぎの確認、返信待ち、未同期をまとめて見ます。」の下に、フィルタチップ 1 行(すべて[青選択]/急ぎ/薬剤師確認/事務で対応/返信待ち/未同期)。本文は通知カードの縦リストで、各行は左にカテゴリバッジ(急ぎ=赤、事務で対応=橙、薬剤師確認=青、返信待ち=紫)+太字タイトル+「患者名様:補足」のサブ文+右端「開く」アウトラインボタン。右パネルなしの全幅レイアウト。
- 現状: /notifications は WorkflowPageHeader(タイトル「通知」、英語 eyebrow「Notifications」)+未読/すべてタブ+「全て既読」ボタン+種別チップ(緊急/業務/リマインダー/システム、件数バッジ付き)+SectionIntro 見出し 2 つの構成。通知カードはアイコン丸+バッジ+相対時刻+「詳細を見る」リンク+「既読にする」リンク。データは GET /api/notifications(is_read/limit)+SSE stream のライブ更新+PATCH 既読で、Notification.type は urgent/business/reminder/system の 4 値。
- UI ギャップ:
  - 見出し・説明文言の差: 「通知/未読・既読の通知一覧」→「お知らせ/急ぎの確認、返信待ち、未同期をまとめて見ます。」
  - フィルタ語彙が異なる: 現状チップは緊急/業務/リマインダー/システム。デザインは急ぎ/薬剤師確認/事務で対応/返信待ち/未同期(担当ロール×状態の分類)で、薬剤師確認・事務で対応・返信待ち・未同期に対応する分類が存在しない
  - 未読/すべてタブ・「全て既読」ボタン・SectionIntro(「絞り込み」「通知一覧」)・チップの件数バッジはデザインに無い(残すなら配置整理が必要)
  - カード行フォーマット差: 右端「開く」アウトラインボタンが無い(現状は「詳細を見る」テキストリンク)。アイコン丸・未読ドット・相対時刻はデザインに無い
  - サブ文の規約「患者名様:説明文」が無い(現状 message は自由文で患者名が構造化されていない)
  - 右パネル: デザインも右パネル無しのため WorkspaceActionRail 組込は不要
- バックエンド:
  - NotificationType(urgent/business/reminder/system)とデザイン 5 分類(急ぎ/薬剤師確認/事務で対応/返信待ち/未同期)のマッピング設計が必要。enum 拡張(migration 要)か event_type/metadata からの表示時派生かの設計判断
  - 「未同期」はサーバ通知ではなくクライアント側 offline-store(pendingSyncCount/pendingQueue)からの合成行 → API 不足は無いがクライアント合成ロジックが必要
  - 「患者名様:説明」表示のため通知生成側で metadata.patient_name または title/message の規約整備(各通知発行箇所の修正)
  - 一覧取得・既読化は不足なし(既存 GET/PATCH /api/notifications と /api/notifications/stream を利用)
- データ源: `src/app/api/notifications/route.ts(GET/PATCH、org+user スコープ、withOrgContext RLS)` / `src/app/api/notifications/stream(SSE)+ src/lib/notifications/stream-payload.ts` / `src/app/(dashboard)/notifications/notifications-content.tsx / notifications-query-state.ts` / `prisma/schema/admin.prisma の Notification モデル(type/event_type/metadata/dedupe_key)` / `src/lib/stores/offline-store.ts(未同期件数・キュー)` / `src/lib/dashboard/home-link-builders.ts(NotificationTab/NotificationTypeFilter 型)`
- 撮影セットアップ: design-screen-map.ts に登録済(route /notifications)。ただし prisma/seed.ts に notification の seed が無いため、デモ通知 4 件(急ぎ/事務で対応/薬剤師確認/返信待ち、患者名入りメッセージ)を seed に追加して「すべて」チップ初期状態で撮影する。

### p0_05_global_search

- 種別: 改修 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 見出し「全体検索」+大型検索ボックス(プレースホルダ「田中 一郎 アムロジピン 施設A などで検索」)+カテゴリチップ(患者[青選択]/処方カード/薬剤/施設/報告書/連絡先)。結果は縦カードリストで、種別バッジ+太字タイトル(田中 一郎 様 / RX-202405-0001 / アムロジピン錠5mg / 5/20 訪問報告)+文脈サブ文(次回訪問 6/17、前回薬 5/21まで処方変更あり、一包化対象残薬あり、ケアマネ返信待ち)+右端「開く」ボタン。メイン領域全幅のページ風レイアウト。
- 現状: `/search` ページへ移行済み。Cmd+K は app-shell から `/search` へ遷移し、空クエリ時は `src/lib/navigation/recent-operations.ts` の最近の操作履歴を利用する。
- UI ギャップ:
  - 文言差: 「グローバル検索」→「全体検索」、プレースホルダを「田中 一郎 アムロジピン 施設A などで検索」へ
  - カテゴリ絞り込みチップ(選択中=青)が無い: 現状は結果のグルーピング表示のみでカテゴリ切替 UI が存在しない
  - カテゴリ構成差: デザインの「報告書」「連絡先」カテゴリが無い。逆に現状のスタッフ/タスク/訪問記録はデザインのチップに無い
  - 「処方カード」の表示が RX-202405-0001 形式の番号でなく患者名+処方日になっている
  - 結果行フォーマット差: 種別バッジ+右端「開く」アウトラインボタンが無い(現状は 2 行テキストのリンクカード)
  - サブ文が文脈要約でない: デザインは「心不全・糖尿病。次回訪問 6/17」等の業務文脈。現状はカナ/住所/YJ コード等のマスタ属性
  - 表示形態: デザインはページ風全幅。モーダル維持なら大型化、またはページ化(/search)の設計判断が必要
  - 右パネル: デザインも右パネル無しのため組込不要
- バックエンド:
  - 報告書検索は既存 /api/care-reports(q パラメータあり)、連絡先は既存 /api/contact-profiles(q/kind)で不足なし — モーダルへの接続のみ
  - 文脈サブ文(次回訪問・前回薬期限・処方変更あり・残薬あり・返信待ち)が既存検索レスポンスに無い → 横断検索集約 API(例 /api/search?q=)の新設か、各一覧 API への summary フィールド追加が必要
  - 処方カードの人間可読番号(RX-YYYYMM-NNNN)が PrescriptionIntake に無い(id は cuid)→ 採番フィールド追加または表示用フォーマッタの新設
  - 患者検索 /api/patients?q= は residences/cases を返すが病名(conditions)と次回訪問は含まない → サブ文用に拡張要
- データ源: `src/app/(dashboard)/search/search-content.tsx / src/components/layout/app-shell.tsx(Cmd+K → /search)` / `/api/search` / `/api/patients(src/app/api/patients/route.ts、q+豊富なフィルタ)` / `/api/drug-masters, /api/facilities, /api/prescription-intakes, /api/visit-records(いずれも q 対応)` / `/api/care-reports(src/app/api/care-reports/route.ts、q 対応)` / `/api/contact-profiles(src/app/api/contact-profiles/route.ts、q+kind 対応)` / `src/lib/navigation/recent-operations.ts(空クエリ時の履歴)`
- 撮影セットアップ: 登録済(route /dashboard + setup で ControlOrMeta+k)。デザインは検索結果が出た状態なので setup に検索語入力を追加する(page.fill('[data-search-input]', '田中') → seed 患者「田中 美智子」がヒット)。処方カード/報告書カテゴリも見せるなら処方 intake と care-report の seed 追加が必要。

### p0_06_advanced_search_modal

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 中央カード型モーダル「詳しく絞り込む」+説明「患者名・日付・タグ・担当者で探せます。」。6 条件フォーム: 訪問日(今日〜今週)/担当者(山田 花子)/現在の工程(セット監査待ち)/注意ポイント(麻薬/冷所/処方変更)/予定の状態(患者確認待ち/正式決定)/薬切れ(3日以内)。フッターは左「リセット」(アウトライン)+右「この条件で探す」(青・この画面唯一の主操作)。
- 現状: 該当実装なし。`/search` ページに詳細条件 UI は無く、「詳しく絞り込む」という文言もリポジトリに存在しない(grep 0 件)。患者一覧(patients-table.tsx)には case_status/risk_level 等の別系統フィルタがあるが、デザインの 6 条件(工程・注意タグ・予定状態・薬切れ)を横断する絞り込みモーダルは未実装で、design-screen-map.ts でも route: null(導線精査待ち)。
- UI ギャップ:
  - 画面全体が新規: モーダル本体、ラベル+入力 6 行のフォーム、リセット/この条件で探すフッター
  - 起動導線が未定: 全体検索モーダル内のリンクか、ダッシュボードのカード一覧フィルタか(p0_05 との親子関係の設計判断)
  - 条件の UI 語彙が未定義: 「セット監査待ち」(MedicationCycleStatus の表示語)、「麻薬/冷所/処方変更」(注意タグ)、「患者確認待ち/正式決定」(VisitProposalStatus の表示語)、「3日以内」(薬切れ期限)
  - 右パネル: なし(デザインも無し)
- バックエンド:
  - 6 条件を AND 合成して 1 つの結果リスト(カード)を返す統合検索 API が存在しない → 新設が必要(例 /api/search/cards)。部分的には既存で賄える: 訪問日+担当者=/api/visit-schedules(date_from/date_to/pharmacist_id)、現在の工程=/api/medication-cycles?status=、予定の状態=/api/visit-schedule-proposals?status=(patient_contact_pending/confirmed)、薬切れ=/api/dashboard/medication-deadlines?within_days=
  - 注意ポイント(麻薬/冷所/処方変更)での絞り込みが未対応: PrescriptionLine.packaging_instruction_tags(narcotic/cold_storage)と処方差分(処方変更)を条件化するクエリが必要
  - 認可: 結果リストは担当スコープ(resolveDashboardAssignmentScope / buildCareCaseAssignmentWhere 相当)を必ず通すこと
  - PHI を含む横断検索のため limit 上限とページングの設計が必要(検索自体の AuditLog は不要の想定)
- データ源: `src/app/api/visit-schedules/route.ts(date_from/date_to/pharmacist_id/status_scope)` / `src/app/api/medication-cycles/route.ts(status/case_id/patient_id+担当スコープ適用済)` / `src/app/api/visit-schedule-proposals/route.ts(status/date_from/date_to)` / `src/app/api/dashboard/medication-deadlines/route.ts(within_days 0-365)` / `prisma/schema/visit.prisma(VisitProposalStatus: patient_contact_pending/confirmed 等)` / `prisma/schema/prescription.prisma(MedicationCycleStatus、PackagingInstructionTag: narcotic/cold_storage 等)`
- 撮影セットアップ: 起動導線の実装後に登録する。案: route /dashboard + setup(ControlOrMeta+k → モーダル内「詳しく絞り込む」ボタンを click)。撮影はプレースホルダのみの空フォーム状態で良いため追加 seed は不要。

### p0_08_card_detail_workspace

- 種別: 改修 / 工数: L / 対応ルート: `/patients/[id]`
- デザイン: 3 カラム構成。左=患者ミニカード(田中 一郎 様 84歳/男性/自宅、予定 5/22 10:30 正式決定、前回薬 5/21まで、今回薬 5/22〜6/18、次回訪問 6/17、現在工程=セット監査待ち、下に「カードを編集」(青)+「一覧へ戻る」)。中央=タブ(薬剤師メモ/工程/処方・監査/セット/訪問/報告/履歴)+「今日の見どころ」(箇条書き 4 点)+「処方の変化」(区分/薬剤/用法/日数のテーブル、追加/中止行)+「セットの注意」(セット方法・加工)。右=3 点セット(次にやること+「セット監査を始める」青ボタン、止まっている理由=赤「中止薬の回収袋が未確認です」橙「セット後写真がまだありません」、根拠・資料=処方せん画像/前回訪問メモ/お薬手帳画像/検査値メモ各「見る」)。
- 現状: 最も近い既存は /patients/[id](patient-detail-tabs.tsx)。md 以上で左 aside(患者ハブカード+詳細セクションナビ)、中央にタブ(基本情報/ケース/処方履歴/薬剤/訪問/連携/文書/タイムライン)+VisitBriefCard(「患者サマリー」)、2xl 以上で右に PatientWorkspaceRail(WorkspaceActionRail 適用済・visit_brief 駆動)という 3 カラム骨格が既に存在する。データは GET /api/patients/[id]/overview(getPatientOverview が visit_brief を同梱)。現マップ先の /workflow は org 全体の管制塔(20 セクション)で患者単位ワークスペースではない。
- UI ギャップ:
  - タブ構成・語彙差: デザイン「薬剤師メモ/工程/処方・監査/セット/訪問/報告/履歴」に対し現状「基本情報/ケース/処方履歴/薬剤/訪問/連携/文書/タイムライン」。工程・セット・報告に相当するタブが無い
  - 中央 3 セクション(「今日の見どころ」「処方の変化」「セットの注意」)が未実装(該当文言は grep 0 件)。VisitBriefCard は「患者サマリー」名で構成・見出しが異なる
  - 「処方の変化」テーブルの列(区分/薬剤/用法/日数)が組めない: visit_brief.medication_changes は drug_name/change_type/previous/current のみで用法・日数フィールドが無い
  - 左ミニカードの項目差: 予定(日時+正式決定バッジ)/前回薬/今回薬/次回訪問/現在工程の 5 項目構成でなく、現状は住所/次回訪問/リスク理由/未完了タスク/ステータス。現在工程(MedicationCycle.overall_status)が画面のどこにも表示されない
  - 主操作の差: デザインは左下「カードを編集」(青)1 つ+「一覧へ戻る」。現状はヘッダ右に「処方受付」(青)+「患者編集」+「アーカイブ」が並び主操作が分散
  - 右パネルは組込済(PatientWorkspaceRail)だが内容が工程駆動でない: 「次にやること」が工程ステータス由来のアクション(セット監査を始める)でなく未解決アイテム駆動
  - 右パネル「止まっている理由」に工程ブロッカー(中止薬回収袋未確認/セット後写真なし)が流れない(現状は task/issue/inquiry/billing の unresolved_items のみ)
  - 右パネル「根拠・資料」がタブ遷移リンクで、実資料(処方せん画像/前回訪問メモ/お薬手帳画像/検査値メモ)を指していない
  - 右パネルの表示ブレークポイントが 2xl(1536px)以上のみ — 1600 撮影では出るが lg〜xl で消える
- バックエンド:
  - カード詳細集約の不足フィールド: getPatientOverview / visit_brief に (a)現在工程(MedicationCycle.overall_status+sub_status)、(b)直近予定の確定状態(VisitSchedule+VisitProposalStatus の patient_contact_pending/confirmed)、(c)前回薬/今回薬の服用期間(PrescriptionLine.start_date/end_date 集約)を追加するか、新 API /api/patients/[id]/workspace を新設
  - medication_changes への用法(frequency)・日数(days)追加(src/lib/prescription/medication-diff.ts と visit-brief.ts の拡張)
  - 右パネル「止まっている理由」用に WorkflowException(exception_status)/SetPlan の回収袋・セット後写真ステータスを blocked_reasons として整形して返す仕組み(/api/workflow-exceptions は存在するが整形は無い)
  - 「根拠・資料」用に PrescriptionIntake.original_document_url の presigned URL 発行(/api/files 系)と前回 VisitRecord・検査値メモへのリンク整形
  - 工程操作は不足なし: POST /api/medication-cycles/[id]/transition が既存で、許可遷移チェック+CycleTransitionLog による証跡化済み。「セット監査を始める」はこれを利用
  - オフライン考慮: 訪問前に開く基準画面だが overview/visit_brief の Dexie キャッシュは未対応(将来課題として明記)
- データ源: `src/server/services/patient-detail.ts(getPatientOverview、visit_brief 同梱)+ /api/patients/[id]/overview` / `src/server/services/visit-brief.ts(getPatientVisitBrief: medication_changes/dispensing_items/must_check_today/ai_summary/unresolved_items)+ /api/patients/[id]/visit-brief` / `src/app/api/dashboard/cockpit/route.ts + src/app/api/patients/board/route.ts(旧 dashboard home API の後継)` / `src/types/visit-brief.ts / src/types/dashboard-home.ts(ActionItem・PatientCard 型は互換 type として継続)` / `src/app/api/medication-cycles/route.ts と [id]/transition・[id]/history(工程状態・遷移・履歴)` / `src/app/(dashboard)/patients/[id]/patient-workspace-rail.tsx + src/components/features/workspace/action-rail.tsx(右パネル 3 点セット)` / `prisma/schema/prescription.prisma(MedicationCycleStatus 16 値、PrescriptionLine.start_date/end_date)/ prisma/schema/visit.prisma(ScheduleStatus・VisitProposalStatus)`
- 撮影セットアップ: 現マップ(route /workflow)は不適なので差し替える。推奨は /patients/[id](動的 ID)— setup で /api/patients?q=佐藤 等から seed 患者 ID を取得して遷移する。seed.ts には MedicationCycle が無いため、工程・処方の変化・セットの注意を再現するにはデモサイクル一式(PrescriptionIntake+lines の追加/中止、SetPlan、VisitSchedule 正式決定)を seed に追加する。新規ルート案を採る場合は /patients/[id]/today を登録。

### p0_09_prescription_import

- 種別: 改修 / 工数: L / 対応ルート: `/prescriptions/new`
- デザイン: 3カラム構成。左「取込キュー」にソース種別バッジ(FAX/画像/電子)+患者名+状態文言(確認待ち/薬剤師へ確認/取込OK)のカード列。中央「処方プレビュー」は処方せん画像と「読み取り結果」(患者/医療機関/処方日/今回の薬/重複候補/読み取り精度)の対比+青の主操作「処方入力へ」。右パネルは「次にやること」内に緑見出し「事務で確認できること」(チェック3点)と橙見出し「薬剤師に確認してほしいこと」(箇条書き3点)、青「薬剤師へ確認を出す」+白「取込を保存」。事務員ロール想定。
- 現状: /prescriptions/new は単一カラムの長大フォーム(prescription-intake-form.tsx 2758行)で、入力の進め方→QR取込と事前共有→患者・ケース選択→処方箋情報→明細→疑義照会と縦に並ぶ。QR下書き取込(qr-scan-drafts)と原本アップロード(S3 presigned)は実装済みだが、取込キュー・画像プレビュー対比・右レールは無い。
- UI ギャップ:
  - 3カラム(取込キュー/処方プレビュー/次にやること)構成が無く単一カラムフォーム
  - 取込キュー(FAX/画像/電子バッジ+確認待ち/薬剤師へ確認/取込OK 状態文言のカード列)が無い
  - 処方せん画像と読み取り結果(患者/医療機関/処方日/今回の薬/重複候補/読み取り精度)の対比プレビューが無い
  - 右パネル未組込: 「事務で確認できること」(緑)/「薬剤師に確認してほしいこと」(橙)の2分割リスト、「薬剤師へ確認を出す」(青・主操作)と「取込を保存」が無い。流すデータ源は qr-scan-drafts の parse_errors/unmatchedDrugs(薬剤師確認事項)と患者/保険/送付先の入力充足状態(事務確認事項)
  - 主操作ボタンが画面に多数あり「処方入力へ」1つの青強調になっていない
- バックエンド:
  - 画像/FAX の OCR 読み取り API が存在しない(QR は /api/qr-scan-drafts の parsed_data で賄える)。読み取り精度・重複候補の算出は新規
  - 取込キューの状態(確認待ち/薬剤師へ確認/取込OK)に相当するフィールドが無い。PrescriptionIntake に status カラムは無く cycle.overall_status のみ。「薬剤師へ確認を出す」ハンドオフ操作の永続化 API が不足
  - 一覧自体は GET /api/prescription-intakes(status/source_type フィルタ有)+ /api/qr-scan-drafts で賄える。認可は既存 withAuth+withOrgContext を踏襲
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/qr-scan-drafts (parsed_data: 患者名/処方日/医療機関/明細/parseWarnings/unmatchedDrugs)` / `/Users/yusuke/workspace/careviax/src/app/api/prescription-intakes/route.ts (GET status/source_type フィルタ, POST)` / `/Users/yusuke/workspace/careviax/src/app/api/files/presigned-upload/route.ts (purpose=prescription) + /api/files/[id]/download` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/prescriptions/new/prescription-form.shared.ts (SOURCE_LABELS/SOURCE_CONFIG)` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx (WorkspaceActionRail)`
- 撮影セットアップ: design-screen-map.ts に /prescriptions/new で登録済み。3カラム化後は seed に FAX/画像/電子の intake または QR 下書き3件(状態違い)を追加し、先頭キューを選択した状態で撮影。原本画像はモック PNG を S3 ローカルスタブか data URL で用意

### p0_10_prescription_entry_period

- 種別: 改修 / 工数: M / 対応ルート: `/prescriptions/new`
- デザイン: 単一メインカード「処方入力・編集」(サブ文言「いつからいつまでの薬か、加工する薬かをここで確認します」)。ヘッダに「田中 一郎 様 今回の薬:2024/05/22〜2024/06/18」と右上に青の主操作「保存して次へ」。中央は 薬剤名/用法/日数/開始日/終了日/加工・セット/注意 の7列テーブル。下部左「薬の加工指定」は5種チップ(一包化/粉砕/分包しない/別包/セット対象外、選択は青背景)、下部右「止まっている理由」カード(橙: 中止薬の回収予定が未入力、赤: 粉砕可否は薬剤師確認が必要)+青「薬剤師へ相談」。
- 現状: 同じ /prescriptions/new フォーム内に明細行入力(DrugSuggest、dose/frequency/days/start_date/end_date/dispensing_method/包装指示タグ)は揃っているが、行ごとの縦長カード入力 UI。期間レビュー用の7列テーブルは無く、submitBlockers の文言リスト表示はあるが「止まっている理由」カード形式ではない。
- UI ギャップ:
  - 薬剤名/用法/日数/開始日/終了日/加工・セット/注意 の一覧テーブル(期間レビュー表)が無い
  - 患者名+「今回の薬:開始〜終了」のヘッダ集約表示が無い(明細から期間を合成する表示ロジックが必要)
  - 加工指定が一包化/粉砕/分包しない/別包/セット対象外 の5種説明付きチップ UI でない(現状はセレクト+タグ)
  - 「止まっている理由」カード(赤/橙の severity 別)と「薬剤師へ相談」ボタンが無い。流すデータ源は getPrescriptionSubmitBlockers の結果+粉砕禁忌判定(crush_prohibited タグ)
  - 主操作「保存して次へ」が単独強調されていない(登録ボタンは最下部)
- バックエンド:
  - PrescriptionLine の start_date/end_date/days/dispensing_method/packaging_method/packaging_instruction_tags でテーブル7列は概ね賄える(注意列は notes)
  - 「別包」は PackagingInstructionTag.separate_pack で表現可。「セット対象外(持参・別管理)」に対応するフラグが無い → タグ追加 or 新フィールドの設計判断
  - 「中止薬の回収予定」を保持するフィールドが無い(ResidualMedication にも無し)。新規の小状態が必要
  - 「薬剤師へ相談」ハンドオフは既存 /api/handoff-board の流用可否を実装時に確認
- データ源: `/Users/yusuke/workspace/careviax/src/app/(dashboard)/prescriptions/new/prescription-intake-submit.ts (getPrescriptionSubmitBlockers)` / `/Users/yusuke/workspace/careviax/src/lib/prescription/packaging.ts (PACKAGING_METHOD_LABELS / PACKAGING_INSTRUCTION_TAG_LABELS / parsePackagingMethod)` / `/Users/yusuke/workspace/careviax/src/app/api/prescription-intakes/route.ts (POST)` / `/Users/yusuke/workspace/careviax/prisma/schema/prescription.prisma (PrescriptionLine)、/Users/yusuke/workspace/careviax/prisma/schema/patient.prisma (PackagingMethod enum)`
- 撮影セットアップ: map は /prescriptions/new + note 登録済み。撮影前操作: デモ患者を選択し5明細(分包なし/一包化2/別包/粉砕)を投入した状態が必要。ステップ分割を実装するなら ?step=period のような URL パラメタを設けて setup を簡略化するのを推奨。seed のデモ患者(佐藤花子/鈴木一郎/田中美智子)を利用

### p0_11_prescription_diff_review

- 種別: 改修 / 工数: M / 対応ルート: `/patients/[id]/prescriptions`
- デザイン: メインカード「処方の変化を確認」(サブ「前回と今回を並べて、変わったところだけ先に確認します」)、ヘッダ「田中 一郎 様 前回 5/1処方 → 今回 5/20処方」。差分テーブルは 変化(追加/中止/変更/変化なし)/前回/今回/薬剤師メモ の4列。右パネル「次にやること」は説明文+青の主操作「確認して調剤へ」。下部に「セットにも影響する変化」(中止薬回収が必要/残薬を今回セットに使う/開始日指定あり)と「患者さんに確認したいこと」(ふらつき/便秘・下痢/痛み止め使用量)の2カード。
- 現状: prescription-history-content.tsx(1381行)に「処方変更ダッシュボード」(追加/中止/用量変更/用法変更バッジのカードリスト)、「調剤方法ワンビュー」、md幅限定の「処方差分2ペイン」、タイムライン、フィルタが実装済み。差分計算ロジックは存在するが、4列テーブル形式・薬剤師メモ列・右レール・下部2カードは無い。
- UI ギャップ:
  - 差分が 変化/前回/今回/薬剤師メモ の4列テーブルでなくカードリスト形式
  - 「薬剤師メモ」列が無い(対応するデータも無い)
  - 右パネル未組込: 「次にやること」+青主操作「確認して調剤へ」が無い(流すデータ源: 対象 cycle の dispense task への遷移)
  - 「セットにも影響する変化」カード(中止薬回収/残薬充当/開始日指定)が無い
  - 「患者さんに確認したいこと」カードが無い
  - ヘッダの「前回 X処方 → 今回 Y処方」形式の文言が無い
- バックエンド:
  - 差分計算は既存クライアントロジックで賄える(prescription-history-content と dispense-form に2実装あり→共通化推奨)
  - 「薬剤師メモ」(差分行への申し送り)を永続化するフィールド/エンドポイントが無い。PrescriptionLine.notes 流用か新規かの設計判断
  - 「患者さんに確認したいこと」の生成元データが無い。薬効(利尿薬→ふらつき等)からのルール生成 or 手入力のどちらかを設計判断。/api/visit-preparations や MedicationIssue との関係整理が必要
  - 「セットにも影響する変化」は差分+ /api/residual-medications + start_date から導出可能(不足なし、集約はクライアント)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/patients/[id]/prescriptions (intakes+lines 履歴)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx (diff 計算・CHANGE ラベル定義)` / `/Users/yusuke/workspace/careviax/src/app/api/residual-medications/route.ts (残薬)` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: map は route: null(動的 ID)。seed に同一患者の2 intakes(前回5/1・今回5/20、追加/中止/変更/変化なしの4パターンを含む明細)を追加し、/patients/<seed患者ID>/prescriptions を登録。seed が固定 ID を出力するよう拡張するのが前提

### p0_12_dispensing_workbench

- 種別: 改修 / 工数: L / 対応ルート: `/dispensing`
- デザイン: 3カラム。左「調剤待ち」(サブ「今日進める処方」)は患者カード列で各カードに「前回薬 5/21まで / 変更あり」。中央「調剤内容」(サブ「一包化・粉砕・分包しない薬が一目で分かるようにします」)は薬剤行ごとに加工バッジ(分包なし=橙/中止・回収=赤/一包化=青/別包=青/粉砕=紫)+注意メモ。右パネルは「次にやること」+「止まっている理由」(赤: 粉砕可否は薬剤師確認が必要、橙: 中止薬回収袋が未準備)+青「薬剤師へ相談」+緑「調剤を完了する」。
- 現状: /dispensing は DataTable のキュー一覧(優先度/施設/患者名/処方内容/期限/処方医、患者別・施設別トグル、キーボードショートカット)。調剤内容は別ページ /dispensing/[taskId] の dispense-form.tsx(1785行)にあり、調剤前確認・行別実績入力・一包化粉砕設定・安全確認・調剤完了を縦に持つ。キューと内容の同時表示(マスターディテール)と右レールは無い。
- UI ギャップ:
  - 左キュー+中央調剤内容の同時表示(マスターディテール)になっておらず一覧→詳細のページ遷移
  - キューカードに「前回薬 X/Xまで / 変更あり」サマリが無い(前回 intake の end_date と差分有無の合成が必要)
  - 中央の薬剤行に加工バッジ一覧ビュー(分包なし=橙/中止・回収=赤/一包化=青/別包=青/粉砕=紫)が無い。バッジ色もデザイン(粉砕=紫)と現実装(amber/red)で不一致
  - 「中止・回収」(前回処方比較で中止になった薬の回収表示)が中央リストに出ない(dispense-form 内の変更表示のみ)
  - 右パネル未組込: 「止まっている理由」(粉砕可否未確認=赤、中止薬回収袋未準備=橙。データ源: crush_prohibited タグ+疑義照会 InquiryRecord+回収袋状態)、「薬剤師へ相談」(青)、「調剤を完了する」(緑)が無い
- バックエンド:
  - /api/dispense-queue + /api/dispense-tasks/[id](prefill.packagingGroups/results/intake.lines/previousIntake)で表示データは概ね賄える
  - 「中止薬回収袋が未準備」の状態を保持するフィールドが無い(新規 or workflow-exceptions 流用の設計判断)
  - 「薬剤師へ相談」ハンドオフの永続化は /api/handoff-board の流用可否を確認
  - 完了操作は PATCH /api/dispense-tasks/[id] + /api/dispense-results で不足なし(既存利用)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/dispense-queue/route.ts` / `/Users/yusuke/workspace/careviax/src/app/api/dispense-tasks/[id]/route.ts + /Users/yusuke/workspace/careviax/src/lib/dispensing/prefill-generator.ts` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/dispensing/dispensing-queue.tsx, dispense-work-queue.shared.tsx, [taskId]/dispense-form.tsx (処方変更計算・粉砕禁止判定)` / `/Users/yusuke/workspace/careviax/src/lib/dispensing/workflow-order.ts, packaging.ts` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: map は /dispensing 登録済み。seed に調剤待ち dispense task 4件(患者4名)+先頭タスクに5明細(分包なし/中止・回収/一包化/別包/粉砕)と前回 intake を追加し、先頭キュー選択済みの初期状態で撮影

### p0_13_dispensing_audit

- 種別: 改修 / 工数: M / 対応ルート: `/auditing`
- デザイン: 3カラム。左「監査待ち」は患者カード列(各「処方変更あり / 安全タグあり」)。中央「監査チェック」はチェックボックス5項目(処方内容と薬袋が合っている/一包化の時点が合っている/中止薬が入っていない/ハイリスク薬を確認した/疑義照会が不要または済み)。右「判定」は「監査結果を選んでください。」+緑の主操作「問題なし・次へ」+赤アウトライン(差し戻す・見切れ)+「差し戻す時の理由」チップ4種(数量が違う/中止薬が残っている/写真が足りない/その他)+メモ欄(必要な時だけ)。
- 現状: /auditing はキュー DataTable、詳細は /auditing/[taskId] の audit-detail.tsx(790行)で、調剤グループカード・鑑査チェックリスト6項目(患者一致/薬剤名・規格/用量・日数/包装指示/高リスク薬確認/持参区分確認)・差戻し理由6種・緊急例外承認・CDS アラート・キーボード操作を持つ。一覧と詳細が分離しており3カラム同時表示でない。
- UI ギャップ:
  - 監査待ちリスト+チェック+判定の3カラム同時表示でない(一覧→詳細遷移)
  - 監査待ちカードに「処方変更あり / 安全タグあり」サマリが無い(データ源: 前回差分+CDS alerts)
  - チェック項目の文言がデザインの平易文(「処方内容と薬袋が合っている」等5項目)と不一致(現: 患者一致/薬剤名・規格 等6項目)
  - 差戻し理由チップの文言不一致(デザイン: 数量が違う/中止薬が残っている/写真が足りない/その他。現: 薬剤間違い/数量間違い/患者間違い/包装指示違反/高リスク薬未確認/その他)
  - 「問題なし・次へ」(緑、承認後に次の監査待ちへ自動遷移)が無い(現状は承認後 /auditing へ戻る)
  - 右パネル(判定)未組込: 主操作=問題なし・次へ(緑)1つ+差し戻すは控えめ表示。流すデータ源は checklist 状態と /api/dispense-audits POST
- バックエンド:
  - 判定は既存 /api/dispense-audits POST(approved/rejected/hold/emergency_approved + reject_reason_code)で賄える
  - DispenseAudit.reject_reason_code に「中止薬が残っている」「写真が足りない」相当のコードが無い(現: drug_name_mismatch/quantity_error/packaging_error/carry_type_error/labeling_error/other)→ コード追加 or マッピングの設計判断
  - チェックリストのチェック状態は現状送信されず監査証跡に残らない。3省2ガイドライン観点で保存するなら API/モデル拡張
  - 「次へ」連続監査はクライアント側のキュー順次遷移で実装可(不足なし)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/dispense-tasks/route.ts (監査待ちキュー), /Users/yusuke/workspace/careviax/src/app/api/dispense-audits/route.ts` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/auditing/auditing-queue.tsx, [taskId]/audit-detail.tsx (CHECKLIST_ITEMS / REJECT_REASON_OPTIONS)` / `/Users/yusuke/workspace/careviax/src/app/api/cds/check (安全タグ・ハイリスク判定)` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: map は /auditing 登録済み。3カラム化後は seed に調剤実績入りの監査待ち task 3件(患者3名、うち処方変更+CDS アラート有り)を追加し、先頭選択状態で撮影

### p0_14_set_preparation

- 種別: 改修 / 工数: L / 対応ルート: `/medication-sets`
- デザイン: 3カラム。左「セット待ち」は患者カード列(各カードにセット方法: お薬カレンダー/お薬BOX/薬袋)。中央「セット方法と期間」は「セット期間:2024/05/22〜2024/06/18」+方法カード5種(お薬カレンダー=選択青/お薬BOX/薬袋管理/施設カート/中止薬回収袋、各に説明文)+「日付別セット確認」の日付チップグリッド(5/22〜6/18 の28日、7列)。右パネルは「セット写真を撮って、監査へ進みます。」+箇条書き(残薬を先に使う/中止薬を回収袋へ/冷所品は別管理)+緑の主操作「セット完了にする」。
- 現状: /medication-sets は「セット対象患者」(pilot対象化トグル)/「計画候補」/「鑑査待ち一覧」の PageSection 3つ+プラン DataTable+作成/鑑査ダイアログ。スロットグリッドは別ページ /medication-sets/[planId]/edit と /medication-sets/full にある。3カラム・方法カード選択・日付チップグリッド・右レールは無い。
- UI ギャップ:
  - セット待ちキュー+方法と期間+右レールの3カラム構成が無い(現状は管理向けセクション羅列)
  - セット方法の5枚カード選択 UI が無く、語彙も不一致(現 SET_METHOD_OPTIONS: 施設カレンダー/1日4回/眠前のみ/カスタム ↔ デザイン: お薬カレンダー/お薬BOX/薬袋管理/施設カート/中止薬回収袋)
  - 「日付別セット確認」の日付チップグリッドが無い(スロットグリッドは別ページの表形式)
  - 右パネル未組込: 注意箇条書き(残薬を先に使う/中止薬を回収袋へ/冷所品は別管理。データ源: residual-medications+前回差分の中止薬+DispensingDecision.temperature_category)と緑主操作「セット完了にする」が無い
  - セット待ちカードの「セット方法: ○○」表記が無い(患者デフォルト packaging_method から導出)
- バックエンド:
  - 一覧・計画・バッチは /api/set-plans, /api/set-plans/[id], /api/set-batches で賄える
  - SetPlan.set_method にデザイン語彙(お薬BOX/薬袋管理/施設カート/中止薬回収袋)対応値が無い。PackagingMethod enum(medication_box/calendar_pack 等)と二重管理になっており、enum 統合 or ラベルマッピングの設計判断が必要
  - 「セット完了にする」に対応する明示的な完了 API(cycle を setting→セット完了へ進める遷移)の有無を確認。set-audits 承認時に set_audited へ遷移する実装はあるが、準備完了(監査待ちへ送る)単体操作が不足の可能性
  - 「中止薬回収袋」の準備記録は新規(p0_12 と共通の状態設計)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/set-plans/route.ts, /Users/yusuke/workspace/careviax/src/app/api/set-batches/route.ts` / `/Users/yusuke/workspace/careviax/src/lib/dispensing/set-methods.ts (SET_METHOD_OPTIONS/LABELS)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/medication-sets/medication-sets-content.tsx, [planId]/edit/set-plan-edit-content.tsx (スロットグリッド)` / `/Users/yusuke/workspace/careviax/src/app/api/residual-medications/route.ts` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: map は /medication-sets 登録済み。seed に set_pilot 有効ケース3件+セットプラン(5/22〜6/18, お薬カレンダー相当)+バッチを追加し、先頭プラン選択状態で撮影

### p0_15_set_audit

- 種別: 改修 / 工数: L / 対応ルート: `/medication-sets/audit/[planId]`
- デザイン: 3カラム。左「セット指示」は箇条書き(セット方法:お薬カレンダー/期間:5/22〜6/18/残薬充当あり/中止薬回収あり/冷所品は別管理)。中央「写真・実物確認」は画像プレースホルダ3枚(セット前/セット後/設置予定)。右「監査チェック」はチェックボックス6項目(日付が合っている/服用時点が合っている/数量が合っている/中止薬が入っていない/残薬の使い方が合っている/冷所品が分かれている)+緑の主操作「監査OK」+赤アウトライン「差し戻す」+差し戻しメモ欄(必要な時だけ)。
- 現状: set-audit-content.tsx(619行)はプラン情報バナー+未鑑査/承認/差戻しスロット集計+「全承認」(緑)/「判定を保存」+Day カード単位のスロット承認・差戻し(理由コード+メモのダイアログ)。/medication-sets/full に配薬指示+スロットグリッドの読取ビューもある。写真確認・チェックリスト形式・セット指示パネルは無い。
- UI ギャップ:
  - 写真・実物確認ペイン(セット前/セット後/設置予定の3枚)が無い。セット写真のアップロード/参照機能自体が未実装
  - 監査がスロット単位承認モデルで、デザインの6項目チェックリスト形式(日付/服用時点/数量/中止薬/残薬/冷所品)が無い
  - 「監査OK」(緑)+「差し戻す」(赤アウトライン)+メモ欄のシンプルな判定 UI が無い(現: 全承認/部分承認/判定を保存)
  - 左「セット指示」パネル(残薬充当あり/中止薬回収あり/冷所品は別管理)が無い
  - 右パネル(監査チェック)は WorkspaceActionRail 構成と異なる画面固有パネルだが、主操作1つ(監査OK=緑)+理由/メモの構成へ寄せる必要。流すデータ源は set-plans/[id]+set-batches+チェック状態
- バックエンド:
  - 判定保存は既存 /api/set-audits POST(approved/partial_approved/rejected + approved_scope + reject_reason)で賄える(cycle 遷移・例外解決も実装済み)
  - セット写真: SetPlan/SetAudit に写真フィールドが無く、/api/files/presigned-upload の purpose は prescription/visit-photo/report のみ → purpose 追加(set-photo 等)+ SetPlan への関連付けモデル/API が新規に必要
  - 監査チェック6項目の保存先が無い(SetAudit へ Json フィールド追加か approved_scope 拡張の設計判断。監査証跡要件に関わる)
  - 「残薬充当あり/冷所品は別管理」の集約 API は無いが packaging_summary_snapshot + /api/residual-medications + DispensingDecision.temperature_category から導出可能
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/set-audits/route.ts, /Users/yusuke/workspace/careviax/src/app/api/set-plans/[id]/route.ts, /Users/yusuke/workspace/careviax/src/app/api/set-batches/route.ts` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/medication-sets/audit/[planId]/set-audit-content.tsx (+ .helpers.ts の判定組み立て)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/medication-sets/full/medication-set-full-content.tsx (配薬指示/スロットグリッド表示)` / `/Users/yusuke/workspace/careviax/src/app/api/files/presigned-upload/route.ts (purpose 拡張前提)`
- 撮影セットアップ: map は現在 p0_15 → /medication-sets(p0_14 と同一)になっており不適切。seed のセットプラン ID を使い /medication-sets/audit/<seed planId> へ差し替える。撮影前提: seed にプラン+バッチ+モック写真3枚(セット前/後/設置予定)を投入

### p0_16_schedule_gantt_all_staff

- 種別: 改修 / 工数: L / 対応ルート: `/schedules`
- デザイン: 見出し「全スタッフの予定」の下にスタッフ絞り込みチップ(全スタッフ/山田花子/佐藤誠/鈴木次郎/事務員)。左カラムは「未確定・確認待ち」のカード縦リスト(患者確認待ち/候補あり/施設まとめ訪問/緊急処方=琥珀背景)。右カラムは「スタッフ別ガントチャート」(補足文「正式決定済みの予定はなるべく動かしません」)で、行=スタッフ(事務員行を含む)、横軸=9時〜17時。バー色は青=正式決定、緑=患者確認済、紫=施設まとめ訪問、橙=事務タスク(患者確認の電話)。
- 現状: /schedules の ScheduleDayView (day-view.tsx, 約5000行) が該当。「今日の運用サマリー」「今日の主要作業」(候補生成プランナー+日次スケジュールボードのタブ)構成で、ガントは「タブレット日次ガント」(day-view.tsx:2787)として実装済みだが行=時間/列=薬剤師の転置形。未確定候補は提案タブや /schedules/proposals 側に分離されており、左カラム化されていない。事務タスクは schedule-day-operational-tasks-panel.tsx に別掲。
- UI ギャップ:
  - ガント軸が転置している(現状: 行=時間帯・列=薬剤師。デザイン: 行=スタッフ・横軸=時間 9〜17時)
  - 左カラム「未確定・確認待ち」カードリストが無い(proposals が別タブ/別ページに分散)
  - スタッフ絞り込みチップ行(全スタッフ/個人/事務員)が無い
  - 事務員の行とタスクバー(「患者確認の電話」等)がガントに出ない(薬剤師のみ)
  - バーの状態色が未統一(現状はステータスラベルbadgeのみ。青=正式決定/緑=患者確認済/紫=施設まとめ/橙=事務の塗り分けが無い)
  - 緊急処方カードの琥珀背景強調が無い
  - 補足文言「正式決定済みの予定はなるべく動かしません」が無い
  - ページが多セクション複合で、デザインの「未確定リスト+ガント」2ペイン構成と乖離(静止画比較では運用サマリー等の先行セクションがガントを画面外に押し出す)
- バックエンド:
  - 確定予定・候補の取得は不足なし(既存 /api/visit-schedules, /api/visit-schedule-proposals を利用)
  - 事務タスクをガント行に置くには時間帯情報が不足(ScheduleTask は due_date/sla_due_at のみで開始/終了時刻が無い)
  - 事務員を含むスタッフ一覧 API が無い(/api/pharmacists は薬剤師のみ。clerk ロールを含む担当者リストが必要)
- データ源: `src/app/(dashboard)/schedules/day-view.shared.ts (VisitSchedule/Proposal/ScheduleTask 型と状態ラベル)` / `src/app/(dashboard)/schedules/schedule-day-view.helpers.ts (ScheduleDayGanttViewModel 構築ロジック)` / `src/app/api/visit-schedules/route.ts (GET: 日付指定一覧)` / `src/app/api/visit-schedule-proposals/route.ts (GET: 未確定候補)` / `src/app/api/tasks/route.ts (事務タスク: task_type/assigned_to フィルタ)` / `src/app/(dashboard)/schedules/schedule-day-operational-tasks-panel.tsx (事務タスク表示の既存実装)`
- 撮影セットアップ: design-screen-map.ts に /schedules で登録済み。撮影前提: seed に当日分の visit_schedules(confirmed_at あり=正式決定、patient_contact 確認済の各状態)+ 未確定 proposals + 施設まとめ訪問グループ + 緊急 proposal(priority=emergency)+ 事務向け ScheduleTask を追加する(現行 prisma/seed.ts は schedules/proposals を一切作らない)。ガントが初期表示で見えるよう ?tab=confirmed 指定を検討。

### p0_17_schedule_confirmation_flow

- 種別: 改修 / 工数: M / 対応ルート: `/schedules/proposals`
- デザイン: 3カラム構成。左「候補日時」は第1〜3候補カード(理由ラベル: 移動効率が良い/患者希望に近い/余裕あり。選択中=青背景)。中央「正式決定までの流れ」は5ステップ縦リスト(1 システムが候補を出す[完了]、2 事務員が患者さんへ確認[いまここ]、3 患者さん・家族が了承[待ち]、4 正式決定にする[未]、5 スタッフ予定に反映[未])。右「患者さんへの確認メモ」は電話確認内容の textarea と緑「了承済みにする」+「別候補…」ボタン。
- 現状: /schedules/proposals の ScheduleProposalsContent(一覧+フィルタ+右スライドの詳細 Sheet)。Sheet 内に ProposalHumanDecisionFlow(4ステップ: システム提案→人間承認→患者電話確認→日時確定、横並びグリッド)、候補ランキング(同一バッチ比較)、ルートプレビュー、患者連絡ワークフォーム(連絡方法/結果 Select/メモ/折返し日時)が実装済み。機能はほぼ揃っているがレイアウトと文言が異なる。
- UI ギャップ:
  - 3カラム同時表示でなく Sheet 内の縦積み(候補比較・ステップ・確認メモが1画面に並ばない)
  - ステップが4段で、デザインの5段(「スタッフ予定に反映」が独立)と不一致
  - ステップ文言が硬い(「人間承認」「患者電話確認」vs「事務員が患者さんへ確認」「患者さん・家族が了承」)
  - 状態バッジ文言の差(現状: 完了/次に対応/待機/終了。デザイン: 完了/いまここ/待ち/未)
  - 候補カードの比較理由ラベル(移動効率が良い等)が proposal_reason 文字列の split 表示頼みで、デザインの1行要約になっていない
  - 主操作が2段階(連絡結果Selectで confirmed を選択→保存→別ボタンで日時確定)。デザインは「了承済みにする」1ボタン強調(かつ緑)
  - 右パネル未組込: WorkspaceActionRail 不使用。確認メモ+了承操作を「次にやること」に寄せる場合のデータ源は detail.patient_contact_status / contact_logs / proposalActionMutation(action=contact_attempt, confirm)
- バックエンド:
  - 不足なし(既存 /api/visit-schedule-proposals/[id] PATCH の action=approve/contact_attempt/confirm/reject を利用。AuditLog 記録済み: visit_schedule_proposal_approved / visit_schedule_contact_logged / visit_schedule_confirmed)
  - 候補理由の構造化を改善する場合のみ proposal_reason の構造化フィールド(理由タグ配列)追加を検討(現状は ' / ' 区切り文字列)
- データ源: `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx (詳細 Sheet・連絡フォーム・候補ランキング)` / `src/app/(dashboard)/schedules/proposal-human-decision-flow.tsx (ステップ表示の既存部品。5段化・文言変更のベース)` / `src/app/(dashboard)/schedules/day-view.shared.ts (PROPOSAL_STATUS_LABELS / CONTACT_STATUS_LABELS / ProposalContactLog)` / `src/app/api/visit-schedule-proposals/[id]/route.ts (承認/連絡記録/確定アクション)` / `src/app/api/visit-schedule-proposals/billing-preview/route.ts (算定 cadence 表示)`
- 撮影セットアップ: route /schedules/proposals は登録済み。詳細 Sheet を開いた状態で撮るため、seed の proposal ID を使い ?workspace=dashboard&detail=<proposalId>(initialDetailId)を setup で付与。seed に同一ケースの候補3件(proposed_date 違い・proposal_reason に理由文)+ patient_contact_pending 状態1件を追加。

### p0_18_schedule_create_edit_drawer

- 種別: 部品 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 中央カード「予定を作成・編集」。ラベル左・入力右の7フィールド(患者/訪問種別/候補日時/担当薬剤師/訪問先/移動手段=社用車A/患者確認=未確認)。琥珀の注意ボックス「正式決定前の予定です。患者さんへ確認してから確定してください。」を挟み、ボタンは「下書き保存」(白)と「確認待ちにする」(青・主操作)の2つ。
- 現状: 専用の作成/編集ドロワーは未実装。day-view 内の「訪問候補を生成」プランナー(対象ケース/訪問種別/優先度/起点日/候補数/社用車)はシステム候補の一括生成 UI であり、患者確認ステータスや訪問先を指定する単票フォームではない。API は /api/visit-schedules POST(直接作成、notes 未対応)と /api/visit-schedule-proposals POST(候補生成)が存在。day-view に Sheet/Drawer 系の編集部品は無い。
- UI ギャップ:
  - ドロワー/モーダル部品そのものが未実装(新規部品)
  - 「候補日時」を直接指定して1件の確認待ち予定を作るフォームが無い(プランナーは起点日+候補数からの自動生成)
  - 「患者確認: 未確認」表示フィールドが無い
  - 「下書き保存」に相当する状態・操作が無い
  - 琥珀注意ボックスの文言(正式決定前の予定です…)が無い
  - 訪問先(自宅/施設)の選択 UI が無い(residence から自動)
- バックエンド:
  - 下書き状態が無い(VisitProposalStatus に draft が無い。proposed で代替するか enum 追加かは設計判断)
  - 指定日時1件の手動候補作成: /api/visit-schedule-proposals POST は生成パラメータ(start_date/preferred_time/preferred_pharmacist_id)で近似可能だが、指定スロット1件を patient_contact_pending 直行で作る薄い拡張(または action=approve の自動連結)が必要
  - /api/visit-schedules POST は notes 指定を validationError で拒否中(「訪問予定メモはまだ保存できません」)。メモ保存を使うなら対応要
  - 監査ログ: proposals 経由なら既存 AuditLog で記録される。直接 schedules POST 経由の場合の記録粒度を確認
- データ源: `src/app/api/visit-schedules/route.ts (POST createSchedule)` / `src/app/api/visit-schedule-proposals/route.ts (POST 候補生成: preferred_pharmacist_id / start_date / vehicle_resource_id)` / `src/app/api/visit-vehicle-resources/route.ts (社用車選択肢)` / `src/app/(dashboard)/schedules/schedule-day-planner.ts / schedule-day-planner-hooks.ts (プランナーフォーム状態の既存ロジック)` / `src/app/(dashboard)/schedules/day-view.shared.ts (VISIT_TYPE_LABELS / CONTACT_STATUS_LABELS / AUTO_VEHICLE_RESOURCE_VALUE)`
- 撮影セットアップ: design-screen-map.ts では route null(起動操作未定)。実装後は /schedules を route にし、setup でヘッダーの「新規訪問予定」ボタン(現状 /schedules#planner アンカー)をドロワー起動に差し替えてクリック→開いた状態で撮影。seed 患者(cmnhseedpt001…)と薬剤師、社用車(cmnhseedveh001…)を選択済み初期値にする。

### p0_19_schedule_conflict_resolution

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「重なっている予定」はテーブル(列: 対象/時間/内容)で、薬剤師の予定重複2行+社用車Aの同時使用1行を同列に表示。中央「おすすめの調整案」は案A(緊急処方を佐藤薬剤師へ変更=正式決定患者は動かさない、選択中青背景)/案B(11:00へ変更=患者再確認が必要)/案C(社用車Bへ変更=移動時間+5分)のカード。右「次にやること」に説明文+青「案Aを採用する」(主操作)+白「患者さんへ再確認」。
- 現状: 重複解消の専用ビューは未実装。既存はガントのセル内バッジ(「同時刻/重なり N件」、schedule-day-view.helpers.ts の overlapKind 判定)による検知表示のみ。調整案の生成・比較 UI は無い。関連部品として、リスケ候補生成ダイアログ(day-view.tsx:3659、reason_code=emergency_insert 等)と変更承認ダイアログ(schedule-day-reschedule-approval-dialog.tsx、impact_summary 表示)が存在する。車両の同時使用検知は無い。
- UI ギャップ:
  - 重なり一覧テーブル(薬剤師重複+車両同時使用の横断リスト)が無い
  - 調整案A/B/C の比較カード UI が無い(担当変更/時刻変更/車両変更の3軸代替案)
  - 案ごとの影響要約ラベル(正式決定患者は動かさない/患者再確認が必要/移動時間+5分)が無い
  - 右パネル未組込: WorkspaceActionRail の NextActionPanel に主操作「案Aを採用する」、BlockedReasonsPanel に「患者再確認が必要」(橙)等を流す。データ源は重なり検知結果+調整案+override_request.impact_summary
  - 「正式決定済みの患者さんはなるべく動かさない」の方針文言が無い
- バックエンド:
  - 重なり検知 API が無い(同一薬剤師の時間帯重複+同一 vehicle_resource_id の同時使用)。/api/visit-schedules の日次一覧からクライアント側導出も可能(time_window と vehicle_resource_id は取得済み)
  - 調整案生成 API が無い(代替薬剤師案/時刻変更案/車両変更案を返す)。src/server/services/visit-schedule-planner.ts の候補スコアリング(シフト・緊急受入可否・負荷)を流用した新エンドポイントが必要
  - 案の採用をワンクリックで適用する複合操作(reschedule + 車両変更 + route 再計算)用のトランザクション API。AuditLog 記録必須(既存 reschedule API は impact_summary 計算と監査記録あり)
  - 認可: 既存 withAuth(permission: canVisit)+ buildVisitScheduleAssignmentWhere のサイトスコープを踏襲
- データ源: `src/app/(dashboard)/schedules/schedule-day-view.helpers.ts (overlapKind 重なり判定ロジック)` / `src/app/api/visit-schedules/[id]/reschedule/route.ts (emergency_insert 等の理由コード、impactedScheduleCount/impact_summary 計算)` / `src/app/(dashboard)/schedules/schedule-day-reschedule-approval-dialog.tsx (影響表示の既存部品)` / `src/server/services/visit-schedule-planner.ts (代替薬剤師候補スコアリング)` / `src/app/api/visit-vehicle-resources/route.ts (車両変更案の選択肢)` / `src/components/features/workspace/action-rail.tsx (右パネル共通部品)`
- 撮影セットアップ: design-screen-map.ts は route null。新設ビュー(案: /schedules?view=conflicts または /schedules/conflicts)を登録。seed に同一薬剤師の 10:30 訪問+10:40 緊急割込+同一社用車の同時刻使用、の3行が出る重複データを追加して撮影。

### p0_20_emergency_route_recalculation

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「緊急で追加」は患者カード(小林智子様、赤タグ「抗菌薬」「本日中にお届け」)+説明文+青「ルートを再計算」。中央「再計算後のルート」は番号ノードの経路図と、案1(緑文「正式決定患者は変更なし」/移動+12分)・案2(橙文「1件だけ再確認が必要」/移動+5分)の比較カード。右「影響確認」はチェックリスト(正式決定:変更なし/患者確認待ち:1件あり/社用車A:使用可/薬剤師負荷:許容範囲)+青「案1で反映」(主操作)。
- 現状: 緊急差込→再計算の一連フロー画面は未実装で、部品が分散している。リスケ候補生成ダイアログ(reason_code=emergency_insert、影響予定数の計算あり)、/api/visit-routes(単一案のルート最適化、車両制約 constraint_status 付き)、VisitRoutePreviewPanel(地図+順序ドラフト+「最適順を route_order に反映」)が既存。複数案比較と影響確認チェックリストは無い。
- UI ギャップ:
  - 緊急患者を当日ルートへ差し込むウィザード画面が無い(部品はあるが導線が分断)
  - ルート案の複数比較(案1/案2)が無い(現状は最適化1案のみ)
  - 案ごとの差分表示(移動+12分、正式決定変更なし=緑/再確認必要=橙)が無い
  - 右パネル「影響確認」未組込: WorkspaceActionRail children に影響チェックリスト、NextActionPanel に「案1で反映」を載せる。データ源は reschedule の impact_summary + /api/visit-routes の vehicle_resource.constraint_status + 患者確認待ち件数
  - 危険・期限タグ(抗菌薬/本日中にお届け)の赤表示が無い(処方区分由来のタグ表示)
- バックエンド:
  - /api/visit-routes は1リクエスト=1案。差込位置や「正式決定済みは動かさない」固定条件を変えた複数シナリオ比較は、制約パラメータ(locked schedule_ids)の追加 or 複数回呼び出しの集約が必要
  - 差込対象の緊急候補と既存ルートの合成は schedule_ids+proposal_ids 混在指定で既存 API が対応済み(不足なし)
  - 案の反映は /api/visit-schedules/reorder(route_order 一括更新)+必要時 /api/visit-schedules/[id]/reschedule の複合。ワンクリック反映用の複合 API と AuditLog 記録を検討
  - 薬剤師負荷(許容範囲判定)は visit-schedule-planner の workload 計算をAPI応答に出す口が無い
- データ源: `src/app/api/visit-routes/route.ts (POST: schedule_ids+proposal_ids 混在ルート計算、vehicle_resource 制約検証)` / `src/server/services/visit-route-engine.ts (VisitRoutePlan: totalDistanceMeters/totalDurationSeconds)` / `src/app/api/visit-schedules/[id]/reschedule/route.ts (emergency_insert、impact_summary)` / `src/components/features/visits/visit-route-preview-panel.tsx / visit-route-map.tsx (経路図表示)` / `src/app/(dashboard)/schedules/visit-route-client.ts (route_order 反映クライアント)` / `src/app/(dashboard)/schedules/route-order-draft.ts (順序ドラフト管理)`
- 撮影セットアップ: design-screen-map.ts は route null。新設ルート(案: /schedules/emergency-insert)か day-view 内モードを登録。seed: 座標付き住所の当日確定予定5件+緊急 proposal 1件(priority=emergency、抗菌薬を含む処方)+社用車。setup で「ルートを再計算」押下後の状態まで進めて撮影。

### p0_21_route_optimization_detail

- 種別: 改修 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「訪問パケット」は順番付きカード(1.田中一郎 希望時間あり/20分 … 5.渡辺誠 /40分)。中央「地図と候補」は番号ノードの経路図+候補1サマリー(太字: 移動92分/訪問130分/余力2件)と候補2(灰: 移動105分/余力1件)。右「守る条件」はチェックリスト(患者希望時間/施設の受付時間/正式決定済みは動かさない/冷所品あり/車両Aを使用/緊急対応余力を残す)+青「このルートを使う」(主操作)。
- 現状: 専用ページは無いが中核部品は実装済み。VisitRoutePreviewPanel(visit-route-preview-panel.tsx)が day-view 確定タブの「日次ルートマップ」、提案詳細 Sheet、週間オプティマイザのセルインスペクタ(weekly-cell-inspector.tsx)に組込み済みで、地図表示・対象薬剤師選択・移動手段切替・順序の手動入替・「最適順を route_order に反映」まで動く。候補は常に1案で、守る条件パネルと余力表示は無い。
- UI ギャップ:
  - 候補1/候補2 の複数案比較が無い(1案のみ)
  - サマリー行(移動92分/訪問130分/余力2件)が無い(totalDurationSeconds は API にあるが訪問滞在合計と余力の概念が未実装)
  - 訪問パケット側の所要分(20分等)と「希望時間あり」ラベルが無い(time_window はあるが滞在時間フィールドが無い)
  - 右パネル「守る条件」未組込: WorkspaceActionRail children にチェックリスト(患者希望時間=time_constraint、施設受付=Facility.acceptance_time_from/to、冷所品=処方 special_notes、車両=vehicle_resource、正式決定維持、緊急余力)を流し、NextActionPanel を「このルートを使う」にする
  - 主操作文言が「最適順を route_order に反映」と内部用語のまま(デザインは「このルートを使う」)
- バックエンド:
  - ルート計算自体は不足なし(既存 /api/visit-routes を利用)。複数候補の返却(最適案+次点案)は API 拡張が必要
  - 1件あたり訪問滞在時間のフィールドが無い(VisitSchedule に estimated_duration 系が無く、FacilityVisitBatch.estimated_duration のみ)→ 訪問130分の合計表示に必要
  - 余力(緊急対応バッファ件数)の算出ロジックが API 応答に無い(visit-schedule-planner 内の当日件数計算を流用可)
  - 冷所品あり判定の集約(処方明細 special_notes='冷所' 等→当日ルート単位のフラグ)を返す口が無い
- データ源: `src/components/features/visits/visit-route-preview-panel.tsx / visit-route-map.tsx (地図+順序 UI)` / `src/app/(dashboard)/schedules/schedule-day-route-preview.tsx (day-view 組込みラッパー)` / `src/app/api/visit-routes/route.ts + src/server/services/visit-route-engine.ts (VisitRoutePlan)` / `src/app/(dashboard)/schedules/visit-route-client.ts (applyVisitScheduleRouteUpdates)` / `src/app/api/visit-vehicle-resources/route.ts (車両条件)` / `prisma/schema/organization.prisma の Facility.acceptance_time_from/to (施設受付時間)`
- 撮影セットアップ: design-screen-map.ts は route null。当面は /schedules?tab=confirmed で「日次ルートマップ」を表示して比較可能だが、専用化するなら /schedules/route(または ?view=route)を登録。seed: lat/lng 付き residence 5件(うち1件は施設5名グループ)+社用車A+当日確定予定。対象薬剤師を seed 薬剤師に setup で選択。

### p0_22_visit_mode_tablet

- 種別: 改修 / 工数: L / 対応ルート: `/visits/[id]/record`
- デザイン: 訪問モード(タブレット)。コンテンツ上部に患者ヘッダー(田中一郎様 5/22 10:30 訪問中+「オフライン」琥珀バッジ+「未同期 2件」赤バッジ)。左「訪問ステップ」10段リスト(1.到着確認〜4.残薬確認=済バッジ、5.服薬・副作用=現在(青)、以降グレー)。中央は現在ステップ「5. 服薬・副作用の確認」で3択チップ(きちんと飲めている=緑選択/ときどき忘れる/ほとんど飲めていない)+確認チェック4つ+メモ。右「写真・証跡」(お薬カレンダー[未同期]/残薬写真[未同期]/説明資料[済])。下部バーに 一時保存/前へ/次へ(青・主操作)/訪問完了(緑)。
- 現状: visit-record-form.tsx (1858行) が該当。縦積みのワークフローセクション構成(訪問前確認→入力状況→訪問結果→現地記録(SOAP 2カラム自由文+音声入力)→保存前チェック(受領記録/次回提案/残薬/添付))。モバイル幅のみ SoapStepWizard(S/O/A/P の4ステップ)に切替わる。オフライン/同期待ちは琥珀の注意ボックスとして既存、IndexedDB 下書き(暗号化)も実装済み。10段ステップ・選択式服薬確認・写真の個別同期状態・下部固定バーは無い。
- UI ギャップ:
  - 10段の訪問ステップ構造(到着確認/今日の確認/セット設置/残薬確認/服薬・副作用/説明/次回予定/写真・証跡/報告の種/完了チェック)が無い(タブレットは縦積みフォーム、ウィザードはモバイルの SOAP 4段のみ)
  - 服薬状況の3択チップ+副作用チェックボックス群(眠くないですか?等)の選択式 UI が無い(SOAP 自由文中心)
  - 右「写真・証跡」パネルが無い(写真・添付は保存前チェック内の一括フィールドで、項目別の未同期/済バッジが無い)
  - 患者名+「訪問中」+オフライン/未同期バッジの常設ヘッダーが無い(汎用 WorkflowPageIntro「訪問記録入力」)
  - 下部固定アクションバー(一時保存/前へ/次へ/訪問完了)が無い。「訪問完了」(緑)に相当する明示ボタンが無く、outcome_status 選択+保存で代替
  - 主操作の強調が「次へ」(青)1つに絞られていない
- バックエンド:
  - 記録保存は不足なし(既存 visit-records 系 API+オフライン下書き同期を利用)
  - 選択式の服薬状況・副作用チェックの保存先フィールドが無い(VisitRecord は SOAP 文字列中心。structured_soap 拡張または専用カラム追加が必要)
  - 写真の項目別カテゴリ(お薬カレンダー/残薬写真/説明資料)と同期状態管理が無い(現状は保存時一括アップロード。IndexedDB 写真キュー+ per-item sync status の新設が必要)
  - ステップ単位の一時保存(到着確認済み等の進捗)を schedule/visit に持つフィールドが無い(VisitPreparation.checklist JSON の流用は設計判断)
- データ源: `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx (フォーム全体・オフライン下書き・位置情報・CDS アラート)` / `src/components/features/visits/soap-step-wizard.tsx (ステップ UI の流用元)` / `src/components/features/visits/visit-attachments-field.tsx (写真撮影・添付)` / `src/components/features/visits/visit-medication-management-section.tsx / structured-soap-wizard.tsx (構造化入力の既存土台)` / `src/lib/stores/offline-store.ts (isOffline / pendingSyncCount)` / `day-view.shared.ts の VisitPreparationPack(訪問前ブリーフ・facility_parallel_context)`
- 撮影セットアップ: 現在 design-screen-map.ts では暫定 /visits。seed に当日 schedule(schedule_status=in_progress)+ 患者(田中一郎相当)を追加し、route を /visits/<scheduleId>/record に差し替え。viewport 1600x1000。撮影前 setup でステップ5相当のセクションへスクロール(ステップ実装後は step=5 クエリ等)。オフラインバッジ再現は context.setOffline(true) を setup で実行。

### p0_23_visit_mode_smartphone

- 種別: 改修 / 工数: M / 対応ルート: `/visits/[id]/record`
- デザイン: 訪問モード(スマホ 390x844)。ミニヘッダー(PH-OS ロゴ+「未同期2」赤バッジ)、患者名+「訪問中 5/22 10:30」、ステップドット1〜10(1〜5が青)。琥珀警告カード「未同期の写真があります/訪問完了前に同期してください。」。セクション「服薬・副作用確認」は3択の縦積みボタン(きちんと飲めている=緑選択)+メモ(任意)。下部に 保存(白)/次へ(青・主操作)。
- 現状: モバイル幅では visit-record-form が SoapStepWizard に切替わる(S/O/A/P 4ステップ+ドット+前へ/次へ)。ドット型プログレスと前後ナビは構造的に近いが、ステップ数(4 vs 10)と内容(SOAP自由文 vs 選択式服薬確認)が異なる。未同期写真の専用警告と訪問モード用ミニヘッダーは無い。
- UI ギャップ:
  - ステップ数・内容の不一致(SOAP 4段 vs 訪問10段。デザインのドットは1〜10)
  - 「未同期の写真があります」専用警告カードが無い(汎用の同期待ちN件表示のみ)
  - 3択服薬確認の縦積み大ボタン(44px以上)が無い
  - 訪問モード用ミニヘッダー(患者名+訪問中+未同期バッジ)が無い(通常のページヘッダー+サイドバーが出る)
  - 下部 保存/次へ の2ボタン固定フッターが無い(SoapStepWizard 内ナビは類似)
- バックエンド:
  - P0-22 と共通(写真同期キュー+項目別同期状態、選択式服薬確認の保存フィールド、ステップ進捗保存)。スマホ固有の追加 API は不要
- データ源: `src/components/features/visits/soap-step-wizard.tsx (ドット+前後ナビの流用元)` / `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx (isMobile 分岐)` / `src/lib/stores/offline-store.ts (未同期件数)` / `src/components/features/visits/visit-card-mobile.tsx (モバイル訪問カード・スワイプ導線)`
- 撮影セットアップ: design-screen-map.ts で p0_23 は MOBILE_VIEWPORT(390x844)指定済み・route は暫定 /visits。P0-22 と同じ seed schedule を使い /visits/<scheduleId>/record に差し替え。setup でステップ5まで進める+オフライン写真キューに2件積んで「未同期2」を再現(実装後)。

### p0_24_facility_visit_packet

- 種別: 改修 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「施設A 本日訪問」(サブ文言: フロア・部屋番号順でまとめて処理)は部屋カードのリスト(201号室 田中一郎様[セット済/カード2枚]、202号室[監査待ち]、203号室[報告待ち]、301号室[訪問準備])。中央「施設訪問パケット」は箇条書き(入館方法: 受付で名簿記入/駐車場: 建物裏2台分/ナースステーション: 2階/服薬カート: 処置室/申し送り: 夕食後薬の声かけ)。右「次にやること」に青「訪問モードを開始」(主操作)+白「施設用メモを印刷」。
- 現状: 専用ページは無い。day-view 確定タブ内「同時訪問グループトラッカー」(day-view.tsx:2520)が最も近く、施設グループごとに準備完了N/持参物未確認N/未完了N のバッジ、訪問順の並べ替え(ドラッグ/上下/番号)、持参一括確認、施設訪問日設定を実装済み。バックエンドは /api/facility-visit-batches(POST upsert/PATCH/DELETE/visit-days POST)と VisitPreparationPack.facility_parallel_context(unit_name・common_notes・患者別 status を返す)が存在。施設パケット(構造化メモ)の編集・表示 UI と印刷導線は無い。
- UI ギャップ:
  - 部屋番号(unit_name)を見出しにした患者カードリスト表示でない(グループ集計+順序リスト中心)
  - 患者ごとの工程状態ラベル(セット済/監査待ち/報告待ち/訪問準備)が無い(現状は準備完了/持参物確認の2軸のみで、セット・監査・報告の工程横断ステータス結合が必要)
  - 「カード2枚」相当(持参カード/お薬カレンダー枚数)の表示が無い
  - 「施設訪問パケット」の構造化箇条書き(入館方法/駐車場/ナースステーション/服薬カート/申し送り)UI が無い(FacilityVisitBatch.notes は自由文1フィールドで UI 未接続)
  - 右パネル未組込: WorkspaceActionRail の NextActionPanel に「訪問モードを開始」(先頭患者の /visits/<id>/record へ)、追加アクションに「施設用メモを印刷」。データ源は facility_parallel_context.patients + FacilityVisitBatch.notes
  - 印刷ビューが無い
- バックエンド:
  - FacilityVisitBatch.notes の構造化(入館方法/駐車場/ナースステーション/服薬カート/申し送りのキー付き JSON 化、または Facility 側に恒久項目を追加して batch には当日申し送りのみ持たせる設計判断)
  - facility batch の GET(詳細取得)エンドポイントが無い(POST/PATCH/DELETE のみ。一覧は visit-schedules の facility_batch_id/facility_hint 経由)→ パケット画面用の取得 API 追加
  - 患者別の工程状態(セット済/監査待ち/報告待ち)を返す集約(medication-sets・dispense-audits・visit_record 有無の結合)が必要(facility_parallel_context.patients に visit_record_id/schedule_status はあるがセット/監査状態が無い)
  - 印刷は新規(サーバー API 不要、print CSS で可)。閲覧監査が必要なら AuditLog 記録を検討
- データ源: `src/app/api/facility-visit-batches/route.ts (+[id]/route.ts, visit-days/route.ts)` / `src/app/(dashboard)/schedules/schedule-day-facility-batch.ts (batch 保存 payload 構築)` / `src/app/(dashboard)/schedules/schedule-day-view.helpers.ts (FacilityTrackerGroup)` / `day-view.shared.ts の VisitPreparationPack.facility_parallel_context (unit_name・common_notes・患者別状態)` / `src/components/features/visits/facility-visit-record-switcher.tsx (施設内患者の記録切替導線)` / `prisma/schema/visit.prisma FacilityVisitBatch / organization.prisma Facility・FacilityUnit (部屋・受付時間・notes)`
- 撮影セットアップ: design-screen-map.ts は暫定 /visits。正ルートを決めて登録(案: /schedules?tab=confirmed で施設トラッカーへスクロール、または新設 /visits/facility-batches/<batchId>)。seed: 施設A(Facility+FacilityUnit)+unit_name=201〜301号室の residence 4名+同日同薬剤師の schedule 4件+FacilityVisitBatch(notes に申し送り)を追加。

### p0_25_clerk_support_dashboard

- 種別: 改修 / 工数: L / 対応ルート: `/my-day`
- デザイン: 見出し「事務でできること」+説明「薬剤師の判断が必要なものは、迷わず相談へ回します。」の事務向けダッシュボード。上段に種別集計バッジ 6 つ(処方受付12件=赤/送付先未設定8件=橙/日程確認6件=青/文書記録11件=緑/返信待ち7件=紫/薬剤師確認5件=青)。中央に「内容/患者さん/次にやること/期限」の 4 列テーブル、右パネルに「薬剤師に相談が必要」の判断基準カード(処方内容の判断/薬の変更理由/服薬指導の内容/算定できるかの判断)。上部バーのモードバッジは「事務サポート」。
- 現状: /my-day は薬剤師個人向け Today ビュー(今日の概要 4 stats、優先対応、今日の訪問、パイプライン、未完了タスク)で max-w-lg の縦 1 カラム(src/app/(dashboard)/my-day/my-day-content.tsx)。/today はディレクトリのみでページ実装なし(ルート不存在)。事務向けの作業集計画面は存在せず、phos 側に SupportBriefPanel(「事務サポート」「事務でできること」文言あり)があるが外部 API(PHOS_API_BASE_URL)依存のワークスペース内パネル。結論: 事務向けは /my-day をロール分岐で改修するのが現実的(/today は実体なし)。
- UI ギャップ:
  - 種別集計バッジ行(処方受付/送付先未設定/日程確認/文書記録/返信待ち/薬剤師確認、色分き件数)が無い
  - 「内容/患者さん/次にやること/期限」のテーブルが無い(現状は個人タスクのカードリスト)
  - 見出し・説明文が「My Day/今日の概要」のままで「事務でできること」+相談誘導文言になっていない
  - 右パネル未組込: 「薬剤師に相談が必要」カード(WorkspaceActionRail の children カードとして静的リスト+handoff 件数を流す)が無い
  - レイアウトが max-w-lg 縦 1 カラムで、デザインの広幅テーブル+右パネル 2 カラム構成と乖離
  - モードバッジ「事務サポート」(事務ロール時)との連動が無い
- バックエンド:
  - 事務サポート集計 API が無い: 種別件数+作業行(内容/患者/次にやること/期限)を返す新規エンドポイント(例 /api/dashboard/clerk-support)か、既存 /api/tasks + /api/communication-requests + /api/care-reports + 処方取込系の集約が必要
  - 事務ロールの認可確認: 集計対象 API の一部(/api/residual-medications 等)は canVisit 前提のため、事務(clerk)権限でのアクセス可否を permission 設計で確認
  - 「薬剤師に相談が必要」を動的にする場合は handoff 系 API から未相談理由の件数取得(静的文言なら不足なし)
- データ源: `src/app/api/tasks(operational task 一覧)+ src/lib/tasks/operational-task-presentation.ts(describeOperationalTask で「次にやること」文言生成済み)` / `src/server/services/communication-queue.ts(返信待ち・コールバック集約)` / `src/app/api/care-reports/route.ts(latest_delivery_status 集計、報告送付滞留)` / `src/phos/contracts/phos_copy.ja.ts の PhosSupportBriefCopy(「事務サポート」「事務でできること」「返信待ち」「薬剤師確認が必要なこと」の確定文言)` / `src/components/features/workspace/action-rail.tsx(WorkspaceActionRail、右パネル)`
- 撮影セットアップ: design-screen-map.ts は p0_25 → /my-day 登録済み。撮影は事務員ロールのデモユーザーでログインし、seed に種別ごとの作業(処方受付・送付先未確認・日程確認・報告送付、患者: 田中一郎/佐藤花子/鈴木次郎/高橋美代子相当)を投入。事務ビューをロール分岐でなくクエリ(例 /my-day?view=clerk)にするなら setup でその URL を指定。

### p0_26_contact_delivery_target_edit

- 種別: 改修 / 工数: M / 対応ルート: `/admin/contact-profiles`
- デザイン: 2 カラム構成。左「送付先一覧」は種別ラベル付きカードリスト(主治医:やまだ内科=FAX登録済/ケアマネ:ひまわりケア=FAX未登録(赤)/訪問看護:あおばステーション=メールOK/家族:田中花子様=電話のみ)。右「連絡先の編集」は宛先/担当者/FAX/電話/送付方法(PH-OS共有 / FAX / PDF)のフォームで、主操作は青の「保存する」1 つ。
- 現状: /admin/contact-profiles(contact-profiles-content.tsx)は読み取り専用の DataTable(種別フィルタ+検索、列: 連携先/種別/既定連絡/学習状況/関連患者/未完了連携)。/api/contact-profiles は GET のみで listContactProfiles(src/lib/contact-profiles.ts)が facility_contact / external_professional / prescriber_institution を集約。編集 UI・保存導線は一切無い。
- UI ギャップ:
  - 左カラムのカードリスト形式でない(テーブル)。「FAX未登録」(赤)/「FAX登録済」/「メールOK」/「電話のみ」の登録状態バッジが無い
  - 右カラムの編集フォーム(宛先/担当者/FAX/電話/送付方法)が無い
  - 主操作「保存する」(青)が無い(画面全体が閲覧専用)
  - 家族(患者家族連絡先)が一覧の kind に含まれない(現状 3 種別のみ)
  - 送付方法の選択肢「PH-OS共有 / FAX / PDF」が現行ラベル(電話/FAX/メール/郵送/対面/SESメール)と不一致
  - 右パネル 3 点セットはデザイン上も無し(マスタ編集画面のため未組込で問題なし)
- バックエンド:
  - contact-profiles の更新 API が無い(GET のみ)。kind 別に既存 API へ書き分け可能: /api/admin/external-professionals/[id] PATCH(fax/preferred_contact_method/preferred_contact_time 更新対応済み)、/api/admin/facilities/[id]/contacts PUT。統合 PATCH を新設するか書き分けるかは設計判断
  - 家族連絡先を扱う場合: listContactProfiles の kind 拡張 + 患者連絡先の更新 API 接続
  - 「送付方法: PH-OS共有」に対応する preferred_contact_method の enum 追加(現状 phone/fax/email/postal/in_person/ses)
  - 連絡先変更の AuditLog 記録(マスタ変更監査)を更新経路に追加
- データ源: `src/lib/contact-profiles.ts(listContactProfiles 集約ロジック)+ src/app/api/contact-profiles/route.ts(GET)` / `src/app/api/admin/external-professionals/[id]/route.ts(PATCH: fax/preferred_contact_method/preferred_contact_time)` / `src/app/api/admin/facilities/[id]/contacts/route.ts(PUT: phone/email/fax)` / `src/app/(dashboard)/admin/contact-profiles/contact-profiles-content.tsx(KIND_LABELS / CONTACT_METHOD_LABELS)`
- 撮影セットアップ: design-screen-map.ts に p0_26 → /admin/contact-profiles 登録済み。撮影前 setup として一覧 1 件目(ケアマネ相当)をクリックして編集フォームを開く操作を追加。seed に prescriber_institution(やまだ内科、FAX あり)、external_professional 2 件(ケアマネ=FAX 無し、訪看=メールあり)、家族連絡先を用意。

### p0_27_handoff_bidirectional

- 種別: 改修 / 工数: L / 対応ルート: `/handoff`
- デザイン: 3 カラム。左「相談一覧」は状態別件数カード(未対応5件=橙/確認中4件=青/事務へ戻し3件=紫/完了14件=緑)。中央「相談内容」は「事務員から薬剤師へ」(橙ラベル)+依頼本文+「確認してほしいこと」箇条書き(用法が妥当か/医師へ確認が必要か/報告書に入れる内容か)。右「薬剤師の対応」は「内容を確認した」(緑)/紫の戻し系ボタン(見切れ)/「医師へ確認する」(青)+「事務へ戻す時のメモ」テキストエリア。
- 現状: /handoff(src/components/features/handoff/handoff-board.tsx)は日付別のシフト申し送りボードで、優先度バッジ+既読管理(read_by)+新規追加のみ。デザインの状態遷移(未対応→確認中→事務へ戻し/完了)概念が無い。一方 (phos)/handoffs(src/phos/ui/handoff/HandoffQueue.tsx + ClerkSupportWorkbench.tsx)には HandoffStatus(OPEN/IN_REVIEW/RESOLVED/RETURNED)、「事務へ戻す」(理由+メモ必須)、差し戻し一覧まで実装済みだが、/api/phos プロキシ経由で外部 PHOS_API_BASE_URL が必須でローカル DB では動かない。
- UI ギャップ:
  - 状態別件数カード(未対応/確認中/事務へ戻し/完了、橙/青/紫/緑)が無い(/handoff は既読/未読のみ)
  - 中央「相談内容」詳細ペイン(「事務員から薬剤師へ」方向ラベル+確認してほしいこと箇条書き)が無い
  - 右「薬剤師の対応」アクション群(内容を確認した=緑/医師へ確認する=青/事務へ戻すメモ)が無い。現状は outline の「確認済み」ボタンのみ
  - 文言: 「申し送りボード」のままで「薬剤師に相談 / 事務へ戻す」の双方向相談文言になっていない
  - 3 ペイン(一覧→詳細→対応)のマスター・ディテール構成でない(縦 1 カラムのカード列)
  - 右パネル未組込: 「薬剤師の対応」は WorkspaceActionRail の NextActionPanel(主操作)+children(メモ入力カード)で構成可能。流すデータは選択中相談の status と requested_action
- バックエンド:
  - handoff-board(ローカル DB)にステータス遷移が無い: HandoffBoardItem へ status(open/in_review/returned/resolved)+ return_reason/return_note + 確認項目(checklist)を追加し PATCH 遷移 API を新設するか、phos contracts の Handoff モデル(HandoffStatus 契約済み)をローカル実装へ移植するかの設計判断が必要
  - 状態別件数集計(summary)を GET レスポンスへ追加
  - 「医師へ確認する」は /api/communication-requests(physician_inquiry)生成への連携が自然(既存 API で賄える)
  - 遷移・差戻し操作の AuditLog 記録
- データ源: `src/app/api/handoff-board/route.ts(GET、board+items)+ items POST + items/[id]/read PATCH` / `src/phos/contracts/phos_contracts.ts 617-672 行(HandoffStatus / HandoffView / CreateHandoffRequest 型が契約済み)` / `src/phos/ui/handoff/HandoffQueue.tsx・ClerkSupportWorkbench.tsx・src/phos/ui/workspace/HandoffPanel.tsx(UI 参考実装)` / `src/phos/contracts/phos_copy.ja.ts の PhosHandoffPanelCopy(「事務へ戻す」「差し戻し理由」「差し戻しメモ」確定文言)` / `src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: design-screen-map.ts に p0_27 → /handoff 登録済み。撮影前 setup: seed で状態別相談(未対応5/確認中4/事務へ戻し3/完了14 相当の最低各 1 件)を投入し、確認中の 1 件を選択して詳細+対応ペインを開く。phos 版 /handoffs を採用する場合は外部 API スタブが必要になるためローカル版改修を推奨。

### p0_28_report_composer_share

- 種別: 改修 / 工数: L / 対応ルート: `/reports`
- デザイン: 3 カラムの報告書コンポーザー。左「共有先」は複数選択チェックリスト(✓医師/✓ケアマネ/✓訪問看護=青背景、□施設/□家族)。中央「報告内容」は 6 セクションカード(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと/次回確認すること)で各々「わかりやすい文章で自動下書き。必要なところだけ修正します。」。右「送付前チェック」は ✓薬剤師確認済み/✓宛先が設定済み/✓添付資料あり/✓患者情報の出しすぎなし の 4 項目+主操作「送付する」(青)+「下書き保存」(outline)。
- 現状: /reports(page.tsx)は一覧ページ(ReportsTable+TracingReportsTable+ReportDeliveryDashboard+外部 API 依存の PhosReportsPageClient)で、コンポーザーは無い。/reports/new は空ディレクトリ。phos の ReportComposer(src/phos/ui/report/ReportComposer.tsx)が最も近いが、宛先は単一タブ切替・本文は単一 textarea・薬剤師承認パネルは文言のみで、外部 API 依存かつ未配線。送付自体は /reports/[id] の送付ダイアログ(送付前確認+compliance checklist)で単一宛先ずつ行う構造。
- UI ギャップ:
  - 共有先の複数選択チェックリスト(医師/ケアマネ/訪問看護/施設/家族)が無い(ReportComposer は単一宛先タブ、reports/[id] は送付ダイアログで宛先 1 件入力)
  - 報告内容の 6 セクション分割カード(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと/次回確認すること)が無い(単一 textarea)
  - セクションごとの自動下書き+「必要なところだけ修正」の説明文が無い(generate-from-visit は report_type 単位の一括生成)
  - 右「送付前チェック」4 項目(薬剤師確認済み/宛先設定済み/添付資料あり/患者情報の出しすぎなし)が無い(/reports/[id] の checklist は算定要件チェックで別物)
  - 主操作「送付する」(青)+「下書き保存」の 2 段構成のコンポーザー画面自体が未配線(/reports 直下は一覧のみ)
  - 右パネル未組込: 送付前チェックは WorkspaceActionRail の children カード+NextActionPanel(送付する)で構成可。流すデータは CareReport.status と DeliveryRecord 宛先準備状態
- バックエンド:
  - CareReport.content は Json のためセクション構造保存はスキーマ変更なしで可能。セクション別自動下書きは src/server/services/report-generator(generate-from-visit)の出力をセクション分割形式へ拡張
  - 複数宛先一括送付: /api/care-reports/[id]/send が宛先 1 件ずつのため、選択した共有先ぶんの DeliveryRecord 一括作成への対応
  - 薬剤師承認状態(薬剤師確認済みチェック)の保存先が CareReport に無い(status enum で代替するか approved_by/approved_at 追加かの設計判断)
  - 「患者情報の出しすぎなし」チェックを自動判定にする場合は新規ロジック(手動チェックなら不足なし)
  - 送付・下書き保存とも既存 AuditLog 経路(送達履歴・連携ログ)に乗ることを確認(送付ダイアログは記録済みと明記あり)
- データ源: `src/app/api/care-reports/route.ts(GET/POST)+ [id]/send + generate-from-visit(src/server/services/report-generator)` / `prisma/schema/communication.prisma 118-160(CareReport.content Json / DeliveryRecord)` / `src/phos/ui/report/ReportComposer.tsx + PhosReportComposerCopy・PhosCommunicationTargetTypeLabel(医師/ケアマネ/訪問看護/施設/家族の確定文言)` / `src/app/(dashboard)/reports/[id]/page.tsx(送付ダイアログ・ケアチーム送付候補取得・compliance-checklist の参考実装)` / `src/components/features/reports/compliance-checklist.tsx`
- 撮影セットアップ: コンポーザーの正ルートを決めて実装後に design-screen-map を更新(現登録は /reports の一覧)。案: /reports/new を実装するか /reports/[id]?mode=compose。撮影は seed の下書き報告書(訪問記録から generate-from-visit 済み、共有先 3 件選択済み)を開く。動的 ID になるため seed のデモ報告書 ID を setup で解決する。

### p0_29_reply_followup_management

- 種別: 改修 / 工数: M / 対応ルート: `/communications/requests`
- デザイン: 2 カラム。左「返信待ち」は相手別カードリスト(ケアマネ:田中一郎様=2日経過/訪看:佐藤花子様=本日期限(赤)/主治医:鈴木次郎様=返信あり)。右「返信内容と次の対応」は受信した返信内容の表示ボックス+「次回カードへ残すこと」の緑ボックス(夕食後薬の飲み忘れを確認)+主操作「対応済みにする」(緑)。
- 現状: /communications/requests(requests-content.tsx、893 行)はステータスタブ+依頼テーブル+連携ログテーブル+CSV 出力のテーブル型一覧。返信は「返信記録」ダイアログ(responder_name/content)で PATCH /api/communication-requests/[id] に保存し、完了は status:closed 遷移(理由必須)。「次回カードへ残すこと」に相当する次回訪問への引き継ぎ概念は存在しない。
- UI ギャップ:
  - 左の返信待ちカードリスト(相手ロール:氏名+経過バッジ「2日経過」(灰)/「本日期限」(赤)/「返信あり」)が無い(テーブル+タブ)
  - 右の詳細ペイン(返信内容の表示→次の対応)が無い(ダイアログ完結型)
  - 「次回カードへ残すこと」の緑ボックス(次回訪問への申し送り入力)が無い
  - 主操作「対応済みにする」(緑、画面に 1 つ)が無い(行内 outline ボタン群に分散)
  - 選択型 2 ペインレイアウトでない
  - 右パネル未組込: 「返信内容と次の対応」を WorkspaceActionRail(NextActionPanel=対応済みにする、children=次回カードへ残すこと入力)で構成可。流すデータは選択中依頼の responses と due_date/requested_at 由来の経過日数
- バックエンド:
  - 「次回カードへ残すこと」の保存先が無い: 完了時に次回訪問カードへ流すフォローアップメモ(/api/tasks への followup タスク作成で代替するか、CommunicationRequest へ followup_note フィールド追加かの設計判断)
  - 経過日数・本日期限バッジは既存 requested_at/due_date から算出可(不足なし)
  - 「対応済みにする」は既存 PATCH(status: closed/responded、status_change_reason 必須)で賄える(不足なし、ただし理由必須仕様と 1 クリック操作の整合を確認)
  - 返信待ち集約は既存 communication-queue サービスで賄える(不足なし)
- データ源: `src/app/api/communication-requests/route.ts + [id](PATCH: status 遷移・response 記録)+ export` / `src/server/services/communication-queue.ts(返信待ち・送達失敗・コールバックの集約 reader)` / `src/app/api/care-reports/route.ts(latest_delivery_status=response_waiting の送達フォロー)` / `src/app/(dashboard)/communications/requests/requests-content.tsx(STATUS_CONFIG/STATUS_TRANSITIONS/REQUEST_TYPE_LABELS)` / `src/phos/ui/report/ReportsPageClient.tsx(返信待ち→返信登録→対応済みの phos 版フロー参考。外部 API 依存)`
- 撮影セットアップ: design-screen-map.ts に p0_29 → /communications/requests 登録済み。seed: sent 状態の依頼 3 件(ケアマネ宛 requested_at=2日前、訪看宛 due_date=本日、主治医宛 responded 済み+返信内容あり)。撮影前 setup で訪看の 1 件を選択し右ペイン(返信内容+次の対応)を表示。

### p0_30_claim_billing_review

- 種別: 改修 / 工数: M / 対応ルート: `/billing`
- デザイン: 3 カラムの算定レビューワークスペース。左「算定候補」は項目カード+状態バッジ(在宅訪問薬剤管理=確認待ち(青)/残薬調整=証跡不足(橙)/薬の安全確認=薬剤師確認(青)/医師同時訪問=対象外(灰青))。中央「なぜ候補なのか」は根拠の箇条書き(訪問記録あり/薬剤師の確認あり/医師への情報提供あり/必要な証跡:残薬写真が未添付)。右「次にやること」は「証跡を追加」(青・主操作)/「算定OKにする」(緑)/「今回は除外」(outline)。
- 現状: /billing(billing-dashboard-content.tsx)は KPI ダッシュボード(月次締めの入口、主要指標、分析、月次推移と主な止まっている理由)で候補単位のレビュー UI は無い。/billing/candidates(billing-candidates-content.tsx)が DataTable 型の候補一覧+確定/除外 PATCH を持ち、BillingCandidate 型に validation_layers(evidence/rule_engine/close_review の state/message)と workflow_state が既に載っているが、カード選択→根拠表示→3 アクションの構成にはなっていない。
- UI ギャップ:
  - 算定候補のカードリスト+状態バッジ(確認待ち/証跡不足/薬剤師確認/対象外)が無い(/billing は集計のみ、candidates は密度重視テーブル)
  - 「なぜ候補なのか」根拠箇条書きペインが無い(validation_layers のデータは API にあるが UI 未活用)
  - 右「次にやること」3 ボタン(証跡を追加=青/算定OKにする=緑/今回は除外=outline)が無い。確定/除外操作はテーブル行にあるが「証跡を追加」導線は不存在
  - バッジ文言が「候補/確定/除外/締め済み」で、デザイン語彙(確認待ち/証跡不足/薬剤師確認/対象外)に未対応
  - 右パネル未組込: WorkspaceActionRail で NextActionPanel(証跡を追加)+BlockedReasonsPanel(「残薬写真が未添付」を橙で表示)に validation_layers.evidence.message と blocker_reasons を流せる
- バックエンド:
  - 候補取得・確定・除外は既存で賄える(/api/billing-candidates GET summary 付き、[id] PATCH + AuditLog 記録済み)
  - 「証跡を追加」: 証跡写真アップロード(/api/files/presigned-upload)と billing evidence への紐付け API の有無を確認(無ければ追加)
  - 不足証跡の明細(「必要な証跡: 残薬写真が未添付」)は billing-requirement-validator / validation_layers の message 整形で賄える見込み(候補単位レスポンスの整形のみ)
  - 「算定OKにする」=確定 PATCH、「今回は除外」=除外 PATCH(exclusion_reason 必須)で既存 API を利用
- データ源: `src/app/api/billing-candidates/route.ts(GET+summary)+ [id]/route.ts(PATCH 確定/除外+AuditLog)+ close/export` / `src/server/services/billing-evidence/(core.ts ほか)、billing-requirement-validator.ts、billing-runtime-context.ts` / `src/app/(dashboard)/billing/candidates/billing-candidates-content.tsx(BillingCandidate 型: validation_layers/workflow_state/STATUS_CONFIG)` / `src/app/(dashboard)/billing/billing-dashboard-content.tsx(/api/billing-evidence/stats・analytics の blocker_reasons)` / `src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: design-screen-map.ts の p0_30 は /billing 登録だが、デザインはレビューワークスペースなので /billing/candidates(または実装後の選択状態付き URL)へ変更推奨。撮影前 setup: seed で状態の異なる候補 4 件(evidence passed=確認待ち、evidence blocked=証跡不足、manual_review=薬剤師確認、除外=対象外)を同月に投入し、1 件目を選択。

### p0_31_residual_adjustment_flow

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3 カラムの残薬調整フロー(サイドバー選択は「算定チェック」)。左「残薬の確認」は薬剤カード+「残 N日」橙バッジ(アムロジピン残28日/ロキソニン残10日/酸化Mg残14日)。中央「調整案」は薬剤/残薬/今回処方/提案の 4 列テーブル(今回は中止・回収/14日分へ調整)+「医師の指示記録」ボックス(医師へ確認済み。酸化Mgは14日分に調整。)。右「次にやること」は「残薬写真を追加」(青・主操作)/「調整案を確定」(緑)。
- 現状: 残薬調整の専用画面は存在しない(精査結果)。残薬入力は訪問記録フォーム内の ResidualMedicationForm(src/components/features/visits/residual-medication-form.tsx)と患者詳細 medications に分散。/api/residual-medications は GET(visit_record_id/patient_id 絞り込み)と POST(作成)のみで、ResidualMedication モデル(prisma/schema/medication.prisma 60-77 行)には調整案・医師指示・写真・確定状態のフィールドが無い。design-screen-map でも route: null(正ルート未定)。
- UI ギャップ:
  - 残薬調整フロー画面そのものが無い(新規ページ)
  - 「残 N日」橙バッジ付き薬剤カードリストが無い(excess_days/remaining_days から表示可能)
  - 調整案テーブル(残薬/今回処方/提案)が無い。今回処方日数との突合(処方データ結合)も未実装
  - 「医師の指示記録」の入力・表示が無い
  - 右パネル未組込: 「次にやること」(残薬写真を追加=主操作/調整案を確定)を WorkspaceActionRail の NextActionPanel+children で構成。流すデータは /api/residual-medications の残薬一覧と添付写真(EvidencePanel)、麻薬等 is_prohibited_reduction は BlockedReasonsPanel に赤で出す
- バックエンド:
  - ResidualMedication に調整フィールドが無い: 調整案(中止・回収/N日分へ調整)、医師指示記録、確定状態(adjustment_status/confirmed_at/confirmed_by)の追加、または残薬調整セッションの別モデル新設
  - 残薬写真添付: /api/files/presigned-upload はあるが ResidualMedication への写真紐付けが無い(photo_file_id 等の追加)
  - 「調整案を確定」遷移 API + AuditLog 記録(処方変更に関わるため監査必須)。is_prohibited_reduction(麻薬/抗がん剤)の減数禁止ガードをサーバ側でも適用
  - 今回処方日数の取得に prescriptions / medication 系 API との結合が必要
  - 確定結果を残薬調整の算定根拠として billing-evidence へ流す連携(P0-30 の「残薬調整=証跡不足」と接続)
  - 認可: 現状 canVisit 権限のみ。調整確定は薬剤師権限(requireRole)で絞る設計判断
- データ源: `src/app/api/residual-medications/route.ts(GET/POST、excess_days 自動計算・is_reduction_target 判定済み)` / `prisma/schema/medication.prisma 60-77(ResidualMedication: remaining_days/excess_days/is_reduction_target/is_prohibited_reduction)` / `src/components/features/visits/residual-medication-form.tsx(既存入力 UI)` / `src/app/api/files/presigned-upload + src/server/services/file-storage.ts(写真アップロード)` / `src/server/services/billing-evidence/(算定連携)、src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: 新規ルートを設けて design-screen-map の p0_31(現在 route: null)を更新。案: /billing/residual-adjustments または /residual-adjustments?patient_id=...(サイドバー「算定チェック」配下に合わせるなら billing 配下)。seed: デモ患者の訪問記録 1 件に残薬 3 剤(アムロジピン残28日/ロキソニン残10日/酸化Mg残14日)+調整案 2 行+医師指示記録を投入し、その visit_record_id/patient_id で撮影。

### p0_32_adverse_event_prevention_flow

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「気になる点」は種類別カード(飲み合わせ=赤字+NSAIDsと腎機能低下、用量確認=高齢・eGFR38、副作用疑い=ふらつき、重複=睡眠薬の重なり)。中央「確認の流れ」は 1.薬歴・検査値を確認 → 2.処方医へ相談(1・2が緑ハイライト) → 3.処方変更の結果を記録 → 4.報告書へ反映 のステップカード。右パネル「次にやること」に主操作「医師への確認を記録」(青)と副操作「問題なしにする」(白)。
- 現状: src/app/(dashboard)/issues/ は空ディレクトリで page.tsx が無く、design-screen-map の route '/issues' は現状 404。データ層は整備済みで、/api/medication-issues(GET/POST + [id] PATCH、担当者スコープ付き)と /api/cds/check(cycleId 必須、interaction/duplicate/allergy/renal_dose 等の CdsAlert)が存在。患者詳細の medications-content.tsx に課題登録ダイアログのみある。
- UI ギャップ:
  - /issues ページ自体が未実装(空ディレクトリで 404)。3カラムレイアウトの新設が必要
  - 「気になる点」のカテゴリ別カード表示が無い(MedicationIssue.category: interaction/side_effect/duplicate 等 → 飲み合わせ/副作用疑い/重複/用量確認 への文言マッピング未整備)
  - 重大(飲み合わせ)のみ赤字にする状態色ルールが無い
  - 「確認の流れ」4ステップ表示と進行状態(緑ハイライト)に相当する UI・状態モデルが無い
  - 右パネル未組込: WorkspaceActionRail に「医師への確認を記録」(主操作・青、inquiry-records POST へ)と「問題なしにする」(medication-issues PATCH resolved へ)を流す。データ源は選択中 MedicationIssue + CdsAlert
- バックエンド:
  - API はほぼ不足なし(既存 /api/medication-issues GET/[id] PATCH、/api/inquiry-records POST、/api/cds/check を利用)
  - /api/cds/check は cycleId 必須のため、患者横断の「気になる点」一覧は medication-issues を主データにする設計判断が必要
  - 「問題なしにする」(resolved 化)は医療判断のため AuditLog 記録の追加を検討
  - InquiryRecord は cycle_id 必須(prisma/schema/prescription.prisma)。課題から cycle が引けないケースの扱いを設計
- データ源: `/api/medication-issues — src/app/api/medication-issues/route.ts、[id]/route.ts(MedicationIssue: prisma/schema/medication.prisma)` / `/api/cds/check — src/app/api/cds/check/route.ts、src/server/cds/checker.ts(CdsAlert: severity critical/warning/info)` / `/api/inquiry-records — src/app/api/inquiry-records/route.ts(InquiryRecord: 医師への確認の保存先)` / `/api/interventions — src/app/api/interventions/route.ts(対応記録)` / `文言・ダイアログ参考: src/app/(dashboard)/patients/[id]/medications/medications-content.tsx` / `右パネル: src/components/features/workspace/action-rail.tsx(WorkspaceActionRail)`
- 撮影セットアップ: design-screen-map は route '/issues' 登録済みだがページ未実装のため実装後に有効化。seed のデモ患者に open 状態 MedicationIssue を category 別(interaction/side_effect/duplicate + 用量系)で4件投入し、先頭課題を選択した状態で撮影。viewport 1600x1000。

### p0_33_evidence_photo_management

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 2カラム構成。左「証跡の種類」リスト(残薬写真=選択中・青ハイライト、セット写真、設置写真、文書交付、報告書控え、同意書)。右「画像一覧」はサムネイルグリッド(4列×2行以上)で、各カードに「同期済み」(緑)/「未同期」(橙)バッジと「撮影 HH:MM」表示。サイドバーは「訪問」アクティブ。
- 現状: 専用の証跡写真管理画面は存在しない。写真は visit-record-form.tsx の「写真・添付」カードからアップロード(presigned-upload → S3 PUT → complete)し、visit-record-detail.tsx で添付一覧表示するのみ。ファイルメタは専用テーブルではなく Setting テーブルに StoredFileRecord JSON で保存され、purpose は prescription/visit-photo/report の3種のみで証跡6分類の概念が無い。
- UI ギャップ:
  - 専用画面が無い(新規ページ)
  - 証跡種類タブ(残薬写真/セット写真/設置写真/文書交付/報告書控え/同意書)が無い。purpose 3種と粒度不一致
  - サムネイルグリッド+撮影時刻表示が無い(StoredFileRecord に completedAt はあるが撮影時刻メタ無し)
  - 同期状態バッジ(同期済み=緑/未同期=橙)に対応するオフライン写真キューが存在しない(offline-db の syncQueue は visit_record/residual_medication のみで写真は対象外)
  - 右パネル: この PNG は右レール3点セット無しの2カラムのため WorkspaceActionRail 組込は不要(未同期件数を注意として出すなら任意)
- バックエンド:
  - 写真一覧 API が無い(/api/files は presigned-upload/complete/[id]/download のみ)。証跡種類・訪問・患者で絞れる一覧 GET の新設が必要。Setting ベース保存のため一覧クエリ設計に注意
  - 証跡カテゴリの追加(purpose 拡張 or StoredFileRecord に evidence_type メタ追加)+ presigned-upload のバリデーション拡張
  - 一覧 API にも visit-photo と同じ担当者スコープ認可(canAccessVisitScheduleAssignment)を適用
  - オフライン撮影写真のローカルキュー(IndexedDB に blob+暗号化保存)と同期状態管理の新設(P0-34 の「写真」行の前提)
  - サムネイル表示は既存 /api/files/[id]/presigned-download を利用可
- データ源: `src/server/services/file-storage.ts(StoredFileRecord、createPresignedUpload、toVisitRecordAttachment)` / `/api/files/presigned-upload・complete・[id]/presigned-download — src/app/api/files/` / `アップロード実装参考: src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx の uploadVisitAttachment` / `表示参考: src/app/(dashboard)/visits/[id]/visit-record-detail.tsx(attachments、kind photo/attachment)` / `オフライン基盤: src/lib/stores/offline-db.ts(写真テーブル追加先)`
- 撮影セットアップ: 新ルート(例: /evidence)を design-screen-map に登録。seed の訪問記録に visit-photo を8件 complete 済み投入し「残薬写真」選択状態で撮影。「未同期」バッジ再現には IndexedDB への写真キュー注入ヘルパーが必要(P0-34 と共通化)。

### p0_34_offline_sync_center

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: ページ見出し「未同期のデータ」+補足「通信が戻ったら自動で送ります。必要なものだけ再試行できます。」。メインはテーブル(列: 種類/患者さん/状態/次にやること)で、行例は 写真・田中一郎・未同期・再試行 / 訪問メモ・同期待ち・そのまま / 写真・失敗・再試行 / 一時保存・同期済み・完了。右パネル「注意」に赤字「必須の写真が未同期のままだと、訪問完了にできません」と主操作「すべて再試行」(青)。
- 現状: 専用ページは無い。同等機能は /schedules(day-view)内の ScheduleDayOfflinePanel に分散実装済み(オンライン/件数バッジ、「今すぐ同期」、409 競合カード、軽量ブリーフ一覧)で、表示は visible 条件付き。データ層は sync-engine.ts(processSyncQueue/listSyncQueueItems/getPendingSyncCount、AES-GCM 暗号化 payload)と offline-store.ts(pendingQueue/syncConflicts)が完備。
- UI ギャップ:
  - 専用ページが無い(day-view 内パネルのみ・条件付き表示)
  - テーブル形式(種類/患者さん/状態/次にやること)が無い(現状はバッジ+カード羅列)
  - 「患者さん」列の名前解決が無い(syncQueue payload は patient_id/schedule_id のみ。visitBriefCache か患者 API で解決が必要)
  - 状態語彙(未同期/同期待ち/失敗/同期済み)へのマッピングが無い(retryCount/lastError/conflict_state からの導出ロジック新設)
  - 行単位「再試行」が無い(processSyncQueue は全件一括のみ)。「写真」「一時保存」という種類も現キューに無い(visit_record/residual_medication のみ)
  - 右パネル未組込: WorkspaceActionRail の「次にやること」に「すべて再試行」(主操作)、「止まっている理由」(赤)に必須写真未同期の警告を流す。データ源は useOfflineStore.pendingQueue + 訪問完了要件
- バックエンド:
  - サーバ API は不足なし(IndexedDB 完結。同期先は既存 /api/visit-records、/api/residual-medications)
  - sync-engine に行単位再試行(processSyncQueue の itemId 指定版)の拡張が必要
  - 「必須写真が未同期だと訪問完了にできない」検証ルールは未実装(P0-33 の写真キュー実装に依存)
  - オフライン考慮: ページ自体を PWA precache 対象にし、オフラインでも開けるようにする
- データ源: `src/lib/stores/sync-engine.ts(listSyncQueueItems、processSyncQueue、SyncQueueItemSummary、MAX_RETRIES=3)` / `src/lib/stores/offline-store.ts(useOfflineStore: pendingQueue/pendingSyncCount/refreshSyncState)` / `src/lib/stores/offline-db.ts(syncQueue スキーマ: retryCount/lastError/conflict_state)` / `状態ラベル組立参考: src/app/(dashboard)/schedules/schedule-day-view.helpers.ts(ScheduleDayOfflineStatusViewModel)` / `UI 参考: src/app/(dashboard)/schedules/schedule-day-offline-panel.tsx`
- 撮影セットアップ: 新ルート(例: /offline-sync)を design-screen-map に登録。撮影前に page.evaluate で IndexedDB(PH-OSOffline.syncQueue)へ未同期/同期待ち/失敗/同期済み相当の4件を注入(payload が AES-GCM 暗号化のため専用 seed ヘルパーを tools/tests/helpers に用意)。

### p0_35_data_conflict_resolution

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 橙色の大見出し「他のスタッフが更新しました」。3カラムで「あなたの入力」(ローカル版訪問メモ+注記「更新前の内容です。」)、「最新の内容」(サーバ版+注記「佐藤薬剤師が5分前に更新。」)、右「選んでください」に3択ボタン(青の主操作1つ+「自分…」リンク他。静止画では右端が見切れ、最新を使う/自分の入力を使う/あとで決める相当)。
- 現状: 専用画面は無い。day-view 内 SyncConflictCard が同等機能を橙カードで実装済み: ローカル下書き/サーバー版の2カラム比較(outcome_status と soap_plan)、上書き/破棄/再編集の3操作+二重確認。データは sync-engine の conflict_payload(409 時に local/server スナップショットを暗号化保存)と overwriteVisitRecordConflict(expected_version 楽観ロック)/discardSyncQueueItem が完備。
- UI ギャップ:
  - 専用ページ/フルスクリーン表示が無い(day-view 内カードのみ)
  - 見出し文言「他のスタッフが更新しました」(橙)が無い(現状「訪問記録の競合」)
  - カラム見出し「あなたの入力」「最新の内容」と注記文言(「更新前の内容です。」「◯◯薬剤師が5分前に更新。」)が無い。サーバ版スナップショットに更新者名・更新時刻が含まれない
  - 操作文言の差: 上書き/破棄/再編集 → 「自分の入力を使う/最新を使う/あとで決める」への統一が必要(主操作は1つだけ青)
  - 右パネル未組込: 3択を WorkspaceActionRail 様式の「選んでください」カードとして構成。データ源は useOfflineStore.syncConflicts(VisitRecordConflictSnapshot)
- バックエンド:
  - /api/visit-records の 409 レスポンス details.existing_record に最終更新者名(updated_by の表示名)と updated_at を追加(「佐藤薬剤師が5分前に更新」の表示に必要)し、sync-engine の normalizeConflictServer も追従
  - 解消操作は既存で不足なし(overwriteVisitRecordConflict / discardSyncQueueItem を利用)
  - 競合解消は記録の上書き/破棄を伴うため、二重確認 UI(既存実装あり)と AuditLog 方針の踏襲
- データ源: `src/lib/stores/sync-engine.ts(VisitRecordConflictSnapshot、overwriteVisitRecordConflict、discardSyncQueueItem、registerVisitRecordConflict)` / `src/lib/stores/offline-store.ts(syncConflicts)` / `UI 参考: src/app/(dashboard)/schedules/schedule-day-offline-panel.tsx の SyncConflictCard(二重確認パターン)` / `競合発生元: src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx(409 ハンドリング)`
- 撮影セットアップ: 新ルート(例: /offline-sync/conflicts または /offline-sync 内の詳細ビュー)を登録。撮影前に IndexedDB へ conflict_state='server_conflict' のアイテム(local/server の訪問メモ本文が異なるスナップショット)を注入する seed ヘルパーを実行。

### p0_36_reject_reason_modal

- 種別: 部品 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 中央カード型モーダル。タイトル「差し戻し理由を入力」+補足「理由を選ぶと、あとで見返しやすくなります。」。理由チップ2列×3(数量が違う=選択中・青ハイライト/中止薬が残っている/写真が足りない/患者都合/入力間違い/その他)の単一選択。任意メモ欄(プレースホルダ「メモ(必要な時だけ)」)。下部に「戻る」(白)/「保存する」(青・主操作)。
- 現状: 共通部品は無く、差戻し UI は2箇所で別実装。auditing/[taskId]/audit-detail.tsx は Select ドロップダウン+詳細 textarea(理由: wrong_drug/wrong_quantity/wrong_patient/packaging_error/high_risk_unchecked/other)、medication-sets/audit/[planId]/set-audit-content.tsx は日単位 reject ダイアログ(drug_mismatch/quantity_error/patient_change/prescription_expired/other)。保存先は DispenseAudit.reject_reason_code/reject_detail と SetAudit.reject_reason(テキスト連結)。
- UI ギャップ:
  - 共通モーダル部品が存在しない(画面ごとに Select / Dialog の別実装)
  - チップ型単一選択 UI(選択中=青ハイライト、2列グリッド)が無い
  - 理由ラベルがデザイン語彙(数量が違う/中止薬が残っている/写真が足りない/患者都合/入力間違い/その他)と両実装とも不一致
  - 補足文言・メモプレースホルダ・ボタン文言(戻る/保存する)が不一致
  - 右パネルは対象外(モーダル部品のため WorkspaceActionRail 組込不要)
- バックエンド:
  - 保存先は既存利用可(DispenseAudit.reject_reason_code + reject_detail、SetAudit.reject_reason)。ただしデザインの理由セットと既存コード体系(schema コメントの drug_name_mismatch 系とも不一致)の統一 enum を決める設計判断が必要
  - SetAudit に理由コード列が無い(現状「ラベル: メモ」のテキスト連結保存)。コード列追加の要否を判断
  - 差戻し理由は監査ログで redact 対象(src/lib/audit-logs/redaction.ts が reject_reason をマスク)。新コードでも同方針を踏襲
- データ源: `src/app/(dashboard)/auditing/[taskId]/audit-detail.tsx(REJECT_REASON_OPTIONS、差戻し理由カード、/api/dispense-audits POST)` / `src/app/(dashboard)/medication-sets/audit/[planId]/set-audit-content.tsx(REJECT_REASON_OPTIONS、reject ダイアログ、/api/set-audits)` / `prisma/schema/prescription.prisma(DispenseAudit / SetAudit)` / `src/lib/audit-logs/redaction.ts(reject_reason マスク)`
- 撮影セットアップ: 共通部品化後、route '/auditing/[taskId]'(seed の監査待ち DispenseTask の ID を解決)で「差戻し」ボタンを押してモーダルを開く setup を design-screen-map に登録。中央カードのみ比較するなら固定デモルートでも可。

### p0_37_cancel_reopen_reason_modal

- 種別: 部品 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: P0-36 と同一構成のモーダルでタイトルのみ「取消・再開の理由を入力」。理由チップ6種(数量が違う/中止薬が残っている/写真が足りない/患者都合/入力間違い/その他)+任意メモ+「戻る」(白)/「保存する」(青)。
- 現状: 共通部品は無い。取消理由は点在: visit-record-form.tsx に「キャンセル理由」フリーテキスト textarea(VisitRecord.cancellation_reason)、visit-schedules API の schedule_status='cancelled' は理由なし、workflow-exceptions/[id] PATCH は resolve/却下のみで理由フィールド無し。「再開」操作への理由入力 UI は見当たらない。
- UI ギャップ:
  - 共通モーダル部品が無い(P0-36 と同一部品をタイトル差し替えで流用する前提)
  - チップ型理由選択が無い(訪問キャンセルはフリーテキストのみ)
  - 「再開」(取消の取り消し・差戻し後の再開)操作への理由入力導線そのものが無い
  - ボタン文言(戻る/保存する)・補足文言の統一が必要
- バックエンド:
  - 取消/再開の理由コード保存先が無い: VisitRecord.cancellation_reason はテキストのみ、VisitSchedule cancel は理由なし、WorkflowException に再開概念・理由が無い。対象エンティティへの reason_code+note 列追加か AuditLog への構造化記録かを設計判断
  - 取消は破壊的操作のため確認ダイアログ+AuditLog 記録を必須化(UI ガイドライン準拠)
  - 再開操作の API(例: visit-schedules の cancelled→scheduled 戻し)の有無を精査し、無ければ追加
- データ源: `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx(cancellation_reason)` / `src/app/api/visit-schedules/[id]/route.ts(schedule_status='cancelled'、version increment)` / `src/app/api/workflow-exceptions/[id]/route.ts(例外 resolve フロー)` / `prisma/schema/admin.prisma(AuditLog)`
- 撮影セットアップ: P0-36 と同部品を使用。route は訪問詳細 '/visits/[id]'(seed の確定済み訪問 ID を解決)に取消導線を実装後、モーダルを開く setup を登録。

### p0_01_login_mfa

- 種別: 改修 / 工数: S / 対応ルート: `/login`
- デザイン: シェル無しの中央カード1枚。カード内ヘッダに PH-OS ロゴ(青)+「在宅薬局オペレーション」、メールアドレス/パスワード入力、全幅の主操作「ログインする」(青)。カード下部に薄青の案内ボックス「確認コードが必要な場合 — スマホまたはメールに届いた6桁のコードを入力してください。初回だけでなく、端末が変わった時にも確認します。」
- 現状: 実装済み。login/page.tsx は NextAuth credentials + Cognito チャレンジ(MFA/初回パスワード/ロックアウト分岐)を完備し、/mfa に6桁分割入力+リカバリーコードも実装済み。ブランド表示は (auth)/layout.tsx がカード外上部にアイコン+「PH-OS/在宅訪問薬局プラットフォーム」を出し、カード見出しは「ログイン/アカウント情報を入力してください」。
- UI ギャップ:
  - ブランドがカード外(layout)にあり、デザインはカード内ヘッダ(PH-OS 青テキストロゴ+「在宅薬局オペレーション」)。サブタイトル文言も「在宅訪問薬局プラットフォーム」で不一致
  - 確認コード案内ボックス(薄青、6桁コード+端末変更時も確認の説明)がカード内に無い
  - 主操作ボタン文言「ログイン」→「ログインする」
  - (軽微)メールプレースホルダが example@pharmacy.jp(デザインは hanako@example.jp)
  - 右パネル対象外(認証画面)
- バックエンド:
  - 不足なし(既存 NextAuth credentials + Cognito チャレンジフロー、/api/auth/mfa/recovery を利用)
- データ源: `src/app/(auth)/login/page.tsx、src/app/(auth)/layout.tsx` / `src/app/(auth)/mfa/page.tsx、src/app/(auth)/mfa/setup/` / `src/lib/auth/cognito-challenge.ts、src/lib/auth/browser-auth-state.ts`
- 撮影セットアップ: design-screen-map に登録済み(route '/login'、auth: false、1600x1000)。変更不要。

### p0_02_tenant_pharmacy_select

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 見出し「使う薬局を選んでください」+補足「所属している薬局だけが表示されます。」。薬局カード3枚横並び(PH薬局 本店/東部店/北口店)。各カードに店名、「本日訪問 N件」、「在宅あり」緑バッジ、「この薬局を使う」ボタン。選択中カードのみ青枠+「選択中」バッジ+青ボタン(主操作は1つだけ強調)。
- 現状: 画面未実装(design-screen-map で route: null)。基盤として Membership(user×org×site_id、@@unique)で複数サイト所属を表現でき、User.default_site_id を (dashboard)/layout.tsx が auth-store の siteId へ初期注入する。siteId を切り替える UI は無く、/api/pharmacy-sites は org 内全サイトを返し(membership 絞り込み無し)、/api/me/profile は先頭 membership 1件しか返さない。
- UI ギャップ:
  - ログイン後の薬局選択ステップ(ページ)自体が無い
  - 「所属している薬局だけ」の一覧表示が無い(既存 API は org 全サイト)
  - 「本日訪問 N件」のサイト別集計表示が無い
  - 「在宅あり」バッジに対応するサイト属性表示が無い
  - 選択状態(選択中バッジ+青枠)とセッション反映(auth-store.setSite + サーバ永続化)が無い
  - 右パネル無しのセンター型レイアウト(WorkspaceActionRail 対象外)
- バックエンド:
  - 所属サイト一覧 API の新設(例: /api/me/sites — is_active な Membership から site+role を返す。me/profile は take:1 のため不足)
  - サイト別「本日訪問件数」の集計(visit-schedules を site_id+当日 count、一覧 API に同梱推奨)
  - 選択サイトの永続化(User.default_site_id の PATCH か専用エンドポイント)と、以後の API への site スコープ反映方針の設計判断
  - 「在宅あり」の判定根拠の確定(PharmacySite の既存届出フラグで代用するか在宅対応フラグを追加するか)
  - サイト切替は監査対象の操作として AuditLog 記録を検討
- データ源: `prisma/schema/organization.prisma(Membership: site_id/role/is_active、PharmacySite: 届出フラグ)` / `/api/pharmacy-sites — src/app/api/pharmacy-sites/route.ts(view=resource_map でシフト/休業日も取得可)` / `/api/me/profile — src/app/api/me/profile/route.ts(currentRole/currentSiteName)` / `src/lib/stores/auth-store.ts(siteId/setSite)、src/app/(dashboard)/layout.tsx(initialSiteId 注入)` / `/api/visit-schedules(date_from/date_to クエリ。site_id フィルタは現状無し)`
- 撮影セットアップ: 新ルート(例: /select-site)を design-screen-map に登録。seed に 3 サイト+ユーザーの複数 membership+各サイトの当日 visit_schedules(28/14/9件相当)を投入し、本店を選択中状態で撮影。

### p0_03_mode_role_select

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 見出し「今日はどの画面から始めますか?」。モードカード3枚: 薬剤師モード(青見出し、「薬の確認・監査・訪問・報告を進めます」、主操作「薬剤師として入る」=青)、事務サポートモード(紫見出し、「受付・送付先確認・日程確認を進めます」、白ボタン)、管理モード(緑見出し、「詰まり・件数・スタッフ負荷を見ます」、白ボタン)。各カードに「よく使う画面だけを先に表示します」の説明枠。
- 現状: 画面未実装(route: null)。app-header.tsx のモードバッジは「在宅モード」固定ハードコード(data-testid='app-header-mode-badge')で、ui-store/auth-store に表示モードの状態が無い。ロールは Membership.role(owner/admin/pharmacist/pharmacist_trainee/clerk/driver/external_viewer)と permissions で制御されるが、「今日の使い方(薬剤師/事務/管理)」という UI モード概念は存在しない。
- UI ギャップ:
  - ページ自体が無い
  - モード状態(薬剤師/事務サポート/管理)の保持層が無い(ui-store への mode 追加+persist が必要)
  - app-header のモードバッジが固定で、選択モードや在宅/外来と連動しない
  - モード別の開始画面リダイレクトとナビゲーション絞り込み(「よく使う画面だけを先に表示」)が無い
  - モード色規約(薬剤師=青/事務=紫/管理=緑)が未定義(既存の状態色規約に無い紫の扱いは設計判断)
  - 右パネル無しのセンター型(WorkspaceActionRail 対象外)
- バックエンド:
  - ほぼ不足なし(クライアント状態で完結可。/api/me/profile の currentRole で選択可能モードを制御)
  - ロール→提示モードの認可規則(clerk に管理モードを出さない、external_viewer は対象外等)の設計
  - モード選択をサーバに永続化する場合のみ Setting / User 設定への保存 API(任意)
- データ源: `src/lib/stores/ui-store.ts(persist 機構。mode 追加先)` / `src/lib/stores/auth-store.ts、/api/me/profile(currentRole)` / `src/components/layout/app-header.tsx(モードバッジ)、navigation-config.ts(TOP_WORKFLOW_LINKS)` / `src/lib/auth/permissions.ts(MemberRole と権限マップ)`
- 撮影セットアップ: 新ルート(例: /select-mode)を design-screen-map に登録。認証セッション付与のデフォルト撮影で可、前操作不要。pharmacist ロールの seed ユーザーで3カード全表示の状態を撮る。

### p0_38_patient_profile

- 種別: 改修 / 工数: M / 対応ルート: `/patients/[id]`
- デザイン: 患者詳細を 3 カラムカードで構成。「患者さん情報」(氏名・84歳/男性/自宅、服薬管理:家族/薬の置き場所/駐車場/NG時間)、「在宅で大事なこと」(飲み忘れ/嚥下/残薬傾向/家族連絡/訪看曜日の箇条書き)、「これまでの流れ」(日付+出来事のシンプルなタイムライン)。在宅モードバッジ・薬剤師ロール表示で、強調された主操作ボタンは無い閲覧中心の画面。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/patients/[id]/patient-detail-tabs.tsx は 8 タブ(基本情報/ケース/処方履歴/薬剤/訪問/連携/文書/タイムライン)+ 左の「患者ハブ」カード + 2xl 幅で PatientWorkspaceRail(WorkspaceActionRail 組込済み)という高密度構成。デザインの平易な 3 カラムサマリーとは情報設計が大きく異なる。訪問条件(駐車場・NG 時間に相当)は visit-constraints-card.tsx(PatientSchedulePreference)に分散して存在する。
- UI ギャップ:
  - 「患者さん情報」カード(年齢/性別/居住区分 + 服薬管理者・薬の置き場所・駐車場・NG時間の箇条書き)に相当する在宅環境サマリーカードが無い(訪問条件は編集フォーム形式で別タブ)
  - 「在宅で大事なこと」(飲み忘れパターン/嚥下/残薬傾向/家族連絡手段/訪看スケジュール)を構造化して見せるカードが無い
  - 「これまでの流れ」のシンプルな日付+一行タイムラインが基本情報タブに無い(タイムラインは別タブで高密度表示)
  - デザインは「田中 一郎 様」と敬称付き・平易な見出し。現実装はタブ名・カード名が業務用語寄り
  - 右パネル未組込ではない(PatientWorkspaceRail 実装済み)が、この画面のデザインでは右カラムが「これまでの流れ」でありレール構成の置き換え判断が必要
- バックエンド:
  - 在宅環境メモの構造化フィールド不足: 服薬管理者(家族等)、薬の置き場所、駐車場、嚥下状態、家族連絡手段、訪看曜日は Patient / PatientSchedulePreference(prisma/schema/patient.prisma)に専用カラムが無く notes 自由記述のみ。専用化するなら migration + /api/patients/[id]/visit-constraints の zod スキーマ拡張が必要
  - タイムライン表示は既存 /api/patients/[id]/timeline で不足なし
  - 閲覧のみなら認可・監査の追加不足なし(既存 overview API は org スコープ済み)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/patients/[id]/overview(PatientOverview 型: /Users/yusuke/workspace/careviax/src/app/(dashboard)/patients/[id]/patient-detail.types.ts)` / `/Users/yusuke/workspace/careviax/src/app/api/patients/[id]/timeline + /Users/yusuke/workspace/careviax/src/app/(dashboard)/patients/[id]/patient-activity-timeline.tsx(TimelineEvent 型)` / `/Users/yusuke/workspace/careviax/src/app/api/patients/[id]/visit-constraints(PatientSchedulePreference)` / `/Users/yusuke/workspace/careviax/src/app/api/patients/[id]/visit-brief(右レール用集約)`
- 撮影セットアップ: route は /patients/<患者ID>?tab=basic。動的 ID のため seed のデモ患者(prisma/seed の先頭 active 患者)を API か DB から解決する setup を design-screen-map.ts に追加する。現状の route: '/patients'(一覧)を詳細ページへ差し替える。

### p0_39_medication_master

- 種別: 改修 / 工数: L / 対応ルート: `/admin/drug-masters`
- デザイン: 3 カラムのマスター管理ハブ。左「カテゴリ」(薬剤/医療機関/施設/スタッフ/車両/タグ/帳票、選択中=薬剤が青ハイライト)、中央「薬剤マスター 一覧」(名称カード+緑の「有効」バッジ x8)、右「詳細を編集」(名称/コード/分類/注意ポイント/表示するタグ/メモ + 青「保存する」ボタン)。管理者ロール表示。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx は 4,125 行の大規模画面。AdminPageHeader + 取込ステータス/取込履歴 + 検索・フィルタ + DataTable 一覧 + 詳細 Sheet(採用品設定・添付文書・相互作用)で、SSK/PMDA 取込データの運用管理が主目的。デザインの 3 カラム編集 UI とは構成が根本的に異なる。
- UI ギャップ:
  - カテゴリ切替ナビ(薬剤/医療機関/施設/スタッフ/車両/タグ/帳票)を持つマスター管理ハブのシェルが存在しない
  - 中央一覧がカード+「有効」緑バッジ形式でなく DataTable(行クリックで Sheet)形式
  - 右カラム常設の「詳細を編集」フォーム(名称/コード/分類/注意ポイント/表示するタグ/メモ)が無い。薬剤の編集対象は採用品設定・在庫下限などで、デザインの「注意ポイント」「表示するタグ」「メモ」に相当する薬局ローカル注記フィールドが UI に無い
  - 取込ステータス・取込履歴・検索フィルタなどデザインに無い大量セクションが先頭に並び、情報優先順位が異なる
- バックエンド:
  - 薬剤マスタ本体(DrugMaster)は外部取込データのため名称等の直接編集は不適。デザインの編集対象を「薬局ローカル注記(注意ポイント/タグ/メモ)」と解釈する場合、PharmacyDrugStock(/api/pharmacy-drug-stocks)への注記フィールドマッピング確認、不足ならカラム追加が必要
  - カテゴリ「タグ」「帳票」のマスタはモデル・API とも未実装(新規設計判断が必要)
  - 既存 /api/drug-masters(GET)・/api/pharmacy-drug-stocks(CRUD)で一覧と採用設定は賄える
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/drug-masters(検索・詳細)` / `/Users/yusuke/workspace/careviax/src/app/api/pharmacy-drug-stocks(採用品・拠点別設定)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx(既存ロジック流用元)` / `/Users/yusuke/workspace/careviax/src/app/api/pharmacy-sites(対象拠点セレクタ)`
- 撮影セットアップ: route: /admin/drug-masters(登録済み)。ハブシェル導入後はカテゴリ=薬剤を初期選択にした新ルート(例: /admin/masters?category=drug)への差し替えを検討。seed の薬剤マスタ 8 件以上を前提。

### p0_40_medical_professional_master

- 種別: 改修 / 工数: M / 対応ルート: `/admin/external-professionals`
- デザイン: p0_39 と同一の 3 カラムマスター管理ハブで、カテゴリ=医療機関を選択した状態。中央「医療機関 一覧」(名称+「有効」緑バッジ x8)、右「詳細を編集」(名称/コード/分類/注意ポイント/表示するタグ/メモ + 保存する)。画面タイトルは「医療機関・他職種マスター」。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/external-professionals/external-professionals-content.tsx(783 行)は職種 13 種・連絡方法・担当患者・連絡履歴まで持つ DataTable + Sheet 編集の画面。医療機関そのものは /admin/institutions が別にあり、デザインの「医療機関・他職種」を 1 画面で扱う構成と分かれている。
- UI ギャップ:
  - カテゴリナビ付き 3 カラムハブでなく、単独ページの DataTable + Sheet
  - 一覧に「有効」緑バッジが無い(ExternalProfessional に有効/無効状態の概念が無い)
  - 右カラム常設の簡易編集フォーム(名称/コード/分類/注意ポイント/表示するタグ/メモ)が無い。既存フォームはフィールドが多く Sheet 内
  - 医療機関(institutions)と他職種(external-professionals)が別画面に分かれており、デザインのカテゴリ統合と不一致
- バックエンド:
  - ExternalProfessional に有効/無効(active)フラグが無い(「有効」バッジ表現に必要。ソフト無効化の設計判断込みで migration 要)
  - 「表示するタグ」に相当するタグ付け機構が無い
  - CRUD 自体は既存 /api/admin/external-professionals(一覧/詳細/患者/連絡履歴/更新)で不足なし
  - 認可は admin 配下 API で担保済み。更新操作の AuditLog 記録有無は実装時に要確認
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/admin/external-professionals(+ /[id]、/[id]/patients、/[id]/communications)` / `/Users/yusuke/workspace/careviax/src/app/api/facilities(所属施設セレクタ)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/external-professionals/external-professionals-content.tsx`
- 撮影セットアップ: route: /admin/external-professionals(登録済み)。ハブ導入後は /admin/masters?category=professional 等へ差し替え。seed の外部専門職 8 件前提。

### p0_41_facility_master

- 種別: 改修 / 工数: M / 対応ルート: `/admin/facilities`
- デザイン: p0_39 と同一の 3 カラムマスター管理ハブで、カテゴリ=施設を選択した状態。中央「施設 一覧」(名称+「有効」緑バッジ x8)、右「詳細を編集」(名称/コード/分類/注意ポイント/表示するタグ/メモ + 保存する)。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/facilities/facilities-content.tsx(863 行)は /api/admin/facilities を使う DataTable + Sheet 構成。Sheet 内に基本情報・施設担当者・所属患者一覧を表示し、ユニット(フロア)管理 API も持つ。
- UI ギャップ:
  - 3 カラムハブ構成でなく DataTable + Sheet
  - 一覧カードの「有効」緑バッジが無い(Facility の有効/無効フラグ表示なし)
  - 右カラム常設の簡易編集フォームが無い(編集は Sheet 内・多フィールド)
  - 「注意ポイント」「表示するタグ」に相当する表示が無い
- バックエンド:
  - Facility の有効/無効フラグの有無を確認し、無ければ migration(「有効」バッジと無効化操作に必要)
  - タグ付け機構が無い(タグマスタ未実装と合わせて設計判断)
  - CRUD は既存 /api/admin/facilities(+ /[id]/units)で不足なし
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/admin/facilities(+ /[id]/units)` / `/Users/yusuke/workspace/careviax/src/app/api/facilities(参照系)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/facilities/facilities-content.tsx`
- 撮影セットアップ: route: /admin/facilities(登録済み)。ハブ導入後は /admin/masters?category=facility 等へ差し替え。seed の施設 8 件前提。

### p0_42_staff_role_management

- 種別: 改修 / 工数: M / 対応ルート: `/admin/staff`
- デザイン: p0_39 と同一の 3 カラムマスター管理ハブで、カテゴリ=スタッフを選択した状態。中央「スタッフ 一覧」(名前+「有効」緑バッジ x8)、右「詳細を編集」フォーム + 保存する。画面タイトルは「スタッフ・権限管理」で、権限(ロール)編集を内包する想定。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/staff/page.tsx は AdminPageHeader + StaffKpiPanel(/api/admin/staff-metrics の薬剤師別 KPI)+ StaffBulkActions(一括取込)+ UsersContent(/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/users/users-content.tsx、/api/pharmacists ベースの DataTable + 招待 Sheet)を縦に積んだ運用管理画面。ロール・サイト割当や Cognito 招待は UsersContent 内で実装済み。
- UI ギャップ:
  - 3 カラムハブ構成でなく、KPI・一括取込・一覧が縦積みでデザインより情報過多
  - 一覧がカード+「有効」緑バッジ形式でない(DataTable。有効/無効は Cognito 状態列で表現)
  - 右カラム常設の「詳細を編集」フォームが無い(編集・招待は Sheet)
  - デザインの簡易フィールド(名称/コード/分類=ロール/注意ポイント/タグ/メモ)と既存フォーム(ロール/サイト/メール等)のマッピング整理が必要
- バックエンド:
  - 不足なし(既存 /api/pharmacists CRUD、/api/pharmacy-sites、招待・ロール変更 API を利用)
  - スタッフへの「タグ」「注意ポイント/メモ」を保存する場合は Pharmacist へのフィールド追加が必要
  - ロール変更は要 admin 認可 + AuditLog 記録の確認(権限管理を謳う画面のため)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/pharmacists(?include_collaborators=true)` / `/Users/yusuke/workspace/careviax/src/app/api/admin/staff-metrics(KPI)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/users/users-content.tsx(一覧・編集・招待ロジック流用元)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/staff/staff-kpi-panel.tsx`
- 撮影セットアップ: route: /admin/staff(登録済み)。ハブ導入後は /admin/masters?category=staff 等へ差し替え。seed のスタッフ(薬剤師+事務)8 名前提。

### p0_43_vehicle_master

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: p0_39 と同一の 3 カラムマスター管理ハブで、カテゴリ=車両を選択した状態。中央「車両 一覧」(車両名+「有効」緑バッジ x8)、右「詳細を編集」(名称/コード/分類/注意ポイント/表示するタグ/メモ + 保存する)。
- 現状: 車両マスタの管理画面は存在しない。API は /Users/yusuke/workspace/careviax/src/app/api/visit-vehicle-resources/route.ts に GET(canVisit)と POST(canAdmin)のみ実装され、VisitVehicleResource(site_id/label/vehicle_code/travel_mode/max_stops/max_route_duration_minutes/available/notes)はスケジュール画面(schedules/day-view 等)から参照されるだけ。
- UI ギャップ:
  - 管理画面そのものが未実装(一覧・編集 UI ゼロ)
  - ハブのカテゴリ「車両」枠も未実装
  - デザインのフィールドは既存モデルにほぼマップ可能(名称=label、コード=vehicle_code、分類=travel_mode、メモ=notes、有効=available)だが「注意ポイント」「表示するタグ」は対応先が無い
- バックエンド:
  - 個別更新・無効化 API が無い: PATCH/DELETE /api/visit-vehicle-resources/[id] の新設が必要(編集フォーム保存・有効/無効切替に必須。canAdmin 認可で)
  - 更新系操作の AuditLog 記録(既存 POST にも監査記録が見当たらないため合わせて追加検討)
  - 「表示するタグ」を保存する場合はカラム追加(タグマスタ設計と連動)
  - 一覧・作成は既存 GET/POST で不足なし
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/visit-vehicle-resources/route.ts(GET/POST)` / `/Users/yusuke/workspace/careviax/src/lib/validations/visit-vehicle-resource.ts(zod スキーマ)` / `prisma/schema(VisitVehicleResource、organization.prisma の PharmacySite リレーション)` / `/Users/yusuke/workspace/careviax/src/app/api/pharmacy-sites(拠点セレクタ)`
- 撮影セットアップ: 新規ルート(例: /admin/vehicles、ハブ導入後は /admin/masters?category=vehicle)を実装後に design-screen-map.ts の route: null を差し替える。seed に車両リソース 8 件の追加が必要(現 seed に車両データがあるか要確認)。

### p0_44_settings

- 種別: 改修 / 工数: M / 対応ルート: `/settings`
- デザイン: 2 カラムの設定画面。左「設定メニュー」(薬局情報/ユーザー管理/権限/通知/外部連携/オフライン/セキュリティ、薬局情報が青ハイライト)、右「薬局情報」フォーム(薬局名 PH薬局 本店/薬局コード PH001/住所/電話/営業時間 9:00〜18:00/1日の訪問上限 40件/既定担当 山田 花子)+ 右下に青「保存する」。管理者ロール表示。
- 現状: /Users/yusuke/workspace/careviax/src/app/(dashboard)/settings/settings-content.tsx(853 行)は個人設定(プロフィール/セッション/セキュリティ(MFA)/通知/訪問位置情報)の Tabs 構成で、薬局(店舗)情報は扱わない。別途 /Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/settings/settings-content.tsx が scope(system/法人/店舗/個人)別の汎用キー・バリュー設定エディタ(settings-catalog: 店舗名/営業時間/調剤基本料区分など)+ ヘルスチェックを提供している。
- UI ギャップ:
  - デザインの左ナビ 7 項目(薬局情報/ユーザー管理/権限/通知/外部連携/オフライン/セキュリティ)に相当する統合メニューが無い(個人設定タブと admin 設定が分離)
  - 「薬局情報」を 1 フォーム(薬局名/コード/住所/電話/営業時間/訪問上限/既定担当)で編集する UI が無い(住所・電話は PharmacySite、営業時間は settings-catalog の site スコープとデータ源が分散)
  - 「1日の訪問上限」「既定担当」の設定項目が存在しない
  - 左ナビが Tabs(上部)形式でなくサイドメニュー形式である点、保存ボタンが右下固定である点が異なる
  - 「外部連携」「オフライン」セクションは既存設定画面に独立項目として存在しない
- バックエンド:
  - PharmacySite 更新 API(/api/pharmacy-sites/[id])で名称/住所/電話は更新可能と見られるが PATCH 実装の有無を要確認
  - 「薬局コード」「1日の訪問上限」「既定担当」は PharmacySite にカラムが無い。settings-catalog(/Users/yusuke/workspace/careviax/src/lib/admin/settings-catalog.ts)の site スコープへキー追加(訪問上限・既定担当・薬局コード)が現実的
  - 設定変更は admin 認可 + AuditLog 記録の確認が必要(既存 admin/settings API の挙動を踏襲)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/pharmacy-sites(+ /[id]。PharmacySite: prisma/schema/organization.prisma L80)` / `/Users/yusuke/workspace/careviax/src/lib/admin/settings-catalog.ts(SettingScope と既存キー: 店舗名/営業時間/調剤基本料区分等)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/settings/settings-content.tsx(scope 設定エディタ)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/settings/settings-content.tsx(通知・セキュリティ・オフライン暗号鍵の既存ロジック)`
- 撮影セットアップ: route: /settings(登録済み)のまま左ナビ+薬局情報ビューへ再構成するのが第一候補。管理者セッションで撮影し、初期選択メニュー=薬局情報にする。seed の PharmacySite(本店)に住所/電話/営業時間相当の値を入れておく。

### p0_45_capacity_bottleneck_dashboard

- 種別: 改修 / 工数: M / 対応ルート: `/capacity`
- デザイン: 見出し「今日あとどれだけ対応できる?」の下に KPI 4 カード(訪問枠 28/40件=青バー、調剤・セット 76/100件=緑、スタッフ稼働 78%=青、緊急余力 3.2件=橙)。下段 3 カラムで「行程ごとの残り」棒グラフ(入力=赤/確認=橙/調剤=青/セット=紫/訪問=緑/報告=水色)、「スタッフ別の負荷」棒グラフ(山田92〜事務70)、「今すぐ見るべきこと」箇条書き(セット監査24件で多め、11〜12時の訪問枠不足、薬剤師確認待ち増加、緊急余力3件割れ予測)。サイドバーは「レポート」選択。
- 現状: 正ルートは design-screen-map.ts 登録の /admin/metrics(経営指標: 処方箋集中率・後発品割合等で別物)ではなく、/Users/yusuke/workspace/careviax/src/app/(phos)/capacity/page.tsx + /Users/yusuke/workspace/careviax/src/phos/ui/capacity/CapacityDashboard.tsx。後者は work_buckets(工程別予定分数)・staff_loads・bottlenecks・利用率バッジ・テーブルフォールバックを持ちデザインへの素地があるが、/api/phos プロキシ経由で外部 API Gateway(PHOS_API_BASE_URL)に依存し、ラベルが英語混じり(Capacity Dashboard / planned / available)。
- UI ギャップ:
  - 見出しが「Capacity Dashboard」のままで「今日あとどれだけ対応できる?」になっていない。planned/available 等の英語キー文言が残る
  - KPI 4 カード(訪問枠 n/m件・調剤セット n/m件・スタッフ稼働%・緊急余力 n件)が無い(現状は分数ベースの 3 カード)
  - 「行程ごとの残り」棒グラフの工程別カラー(赤/橙/青/紫/緑/水色)が無い(単色バー)
  - 「スタッフ別の負荷」が専用グラフでなくテーブル行
  - 「今すぐ見るべきこと」(ボトルネックの文章化カード)が無い。bottlenecks 配列を文章にして橙/赤で並べる枠が必要(WorkspaceActionRail の BlockedReasonsPanel の意味論を流用可)
  - design-screen-map.ts の route が /admin/metrics を指しており差し替えが必要
- バックエンド:
  - CapacityResponse(/Users/yusuke/workspace/careviax/src/phos/contracts/phos_contracts.ts L752)は分数ベース。「訪問枠 28/40件」「調剤・セット 76/100件」「緊急余力 3.2件」の件数指標は契約拡張または分数からの換算ロジックが必要
  - データ源が外部 API Gateway(PHOS_API_BASE_URL)依存。ローカル/CI 撮影にはスタブ(initialCapacity 注入 or プロキシのモック)が必要
  - 「今すぐ見るべきこと」の文言生成(bottlenecks → 日本語文)はフロントで賄えるが、時間帯別の訪問枠不足(11〜12時)を出すには時間帯粒度のデータが contracts に不足
- データ源: `/Users/yusuke/workspace/careviax/src/phos/ui/capacity/CapacityDashboard.tsx + CapacityDashboardClient.tsx` / `/Users/yusuke/workspace/careviax/src/phos/contracts/phos_contracts.ts(CapacityResponse/CapacityWorkBucket/CapacityBottleneck)` / `/Users/yusuke/workspace/careviax/src/app/api/phos/[...path]/route.ts(認証付きプロキシ)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/metrics/metrics-dashboard-content.tsx(経営指標。本画面とは別と整理)`
- 撮影セットアップ: design-screen-map.ts の route を /admin/metrics から /capacity へ変更。PHOS_API_BASE_URL 未設定環境ではエラーカードになるため、撮影用に initialCapacity を渡すデモモードかプロキシスタブを用意する(管理薬剤師/管理者ロールのセッション必須)。

### p0_47_print_preview

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3 カラムの帳票・印刷ハブ。左「印刷するもの」(セット指示書/服薬カレンダー/訪問報告書/文書交付控え/薬袋ラベル、セット指示書選択中)、中央「プレビュー」(A4 用紙モックにタイトル+罫線)、右「出力設定」(患者名を表示/施設名を表示/QRコードを付ける/控えを保存のチェックボックス)+ 青「印刷する」ボタン。サイドバーは「報告・文書」選択、薬剤師ロール。
- 現状: 統合印刷ハブは未実装。印刷は帳票ごとに分散: /reports/[id]/print(報告書、PrintPageToolbar + /Users/yusuke/workspace/careviax/src/components/features/reports/print-layout.tsx)、/patients/[id]/medications/print、/patients/[id]/visit-records/print、/patients/[id]/management-plan/print、/patients/[id]/medication-calendar(服薬カレンダー)、/medication-sets/full(window.print のセット総票)。共通部品は /Users/yusuke/workspace/careviax/src/components/features/workflow/print-action-button.tsx と print-page-toolbar.tsx のみ。
- UI ギャップ:
  - 帳票選択 → プレビュー → 出力設定 → 印刷の統合ハブ画面が存在しない(画面まるごと新規)
  - 出力設定トグル(患者名を表示/施設名を表示)に相当する匿名化・表示制御が既存印刷ページに無い
  - 「QRコードを付ける」機能が無い
  - 「控えを保存」(印刷物の控えを文書として保存)機能が無い
  - 「薬袋ラベル」帳票が未実装。「セット指示書」も患者単位の指示書テンプレートとしては未整備(medication-sets/full は一覧総票)
- バックエンド:
  - QR コード生成ライブラリが無い(@zxing/browser は読取り用)。qrcode 等の追加とバージョン固定方針(CLAUDE.md)の整合確認が必要
  - 「控えを保存」: 生成 PDF/スナップショットを S3 に保存する導線(既存 /api/files presigned-upload + 文書交付記録 document-delivery 系で賄える見込み。帳票種別メタの付与方法は要設計)
  - 薬袋ラベル・セット指示書のデータ組成 API(処方・用法・患者・施設名)。既存 medication-sets / prescriptions API の組合せで賄えるか実装時に確認
  - 印刷(=PHI 出力)の監査: 印刷実行イベントの AuditLog 記録が現状無い。3省2ガイドライン観点で追加を推奨
- データ源: `/Users/yusuke/workspace/careviax/src/components/features/reports/print-layout.tsx + /Users/yusuke/workspace/careviax/src/components/features/workflow/print-page-toolbar.tsx(プレビュー枠流用元)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/reports/[id]/print/page.tsx(別紙様式1 準拠の報告書レイアウト)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/patients/[id]/medication-calendar(服薬カレンダー)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/medication-sets/full/medication-set-full-content.tsx(セット印刷の既存例)` / `/Users/yusuke/workspace/careviax/src/app/api/files(presigned-upload / complete。控え保存用)`
- 撮影セットアップ: 新規ルート(例: /documents/print。サイドバー「報告・文書」配下)実装後に design-screen-map.ts の route: null を差し替え。撮影前操作: 帳票=セット指示書を初期選択、出力設定は全チェック ON。プレビュー用に seed のセット/処方データが必要。

### p0_48_mobile_evidence_capture

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: モバイル(390x844)の証跡撮影専用画面。ヘッダー「PH-OS 写真」(青)+ 患者名「田中 一郎 様」、大きなカメラプレビュー枠、写真種別チップ 3 つ(残薬写真/セット設置/説明資料)、フル幅の青「写真を撮る」主操作、最下部に橙のオフライン案内カード「通信がなくても保存します / 戻ったら自動で送信します。」。
- 現状: 専用撮影画面は無い。訪問記録フォーム(/Users/yusuke/workspace/careviax/src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx)内の /Users/yusuke/workspace/careviax/src/components/features/visits/visit-attachments-field.tsx が input[type=file] capture=environment の「写真を撮影」ボタンを提供し、kind は photo/attachment の 2 値のみ。アップロードは presigned-upload → S3 → complete のオンライン前提で、オフライン時は記録本文のみ IndexedDB 暗号化下書き(useOfflineStore + lib/offline/crypto)に保存され、写真のオフラインキューは無い。
- UI ギャップ:
  - カメラプレビュー常設のモバイル専用撮影画面が無い(現状は OS カメラ起動のファイル入力)
  - 写真種別チップ(残薬写真=紫/セット設置=緑/説明資料=紫)による分類 UI が無い(kind: photo/attachment のみ)
  - オフライン案内カード(橙、「通信がなくても保存します」)が無い
  - 主操作 1 つ(写真を撮る=青フル幅)の構成でなく、撮影と添付がフォーム内の小ボタン
  - p0_33(証跡写真管理)と連動する撮影 → 一覧の導線が無い
- バックエンド:
  - 写真種別(photo_type: residual/set_placement/explanation)の保存先が無い: 訪問添付のメタデータ(VisitRecord 添付 or File モデル)へのフィールド追加と presigned-upload の purpose/metadata 拡張が必要
  - オフライン撮影キュー: 写真 Blob を IndexedDB(dexie + ENCRYPTION_KEY の AES-GCM 暗号化)に保存し、オンライン復帰時に自動アップロードする同期処理が未実装(p0_34 オフライン同期センターと共通基盤)
  - 既存の /api/files/presigned-upload(purpose: visit-photo)→ S3 → /api/files/complete のフローは再利用可能
  - 撮影は PHI 取得操作のため AuditLog/取得元(訪問 ID・患者 ID)紐付けの確認が必要
- データ源: `/Users/yusuke/workspace/careviax/src/components/features/visits/visit-attachments-field.tsx(撮影入力の既存実装)` / `/Users/yusuke/workspace/careviax/src/app/api/files(presigned-upload / complete)` / `/Users/yusuke/workspace/careviax/src/lib/offline/crypto.ts + /Users/yusuke/workspace/careviax/src/lib/stores/offline-store(オフライン状態・暗号化基盤)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx(uploadVisitAttachment フロー流用元)`
- 撮影セットアップ: 新規ルート(例: /visits/[id]/capture)実装後に design-screen-map.ts へ viewport: MOBILE_VIEWPORT(390x844)で登録。動的 ID のため seed の訪問予定/記録 ID を解決する setup が必要。カメラはヘッドレスで黒枠になるためプレビュー枠はプレースホルダ表示で撮影。

### p1_01_saved_views_advanced_filter

- 種別: 新規 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: タイトル「よく使う絞り込み」の下にプリセットカード 4 枚(朝の確認/セット担当/事務で確認/管理者用)を 2x2 で並べ、各カードに用途説明と青い「使う」ボタンを配置。下段の「今の絞り込み条件」カードに現在条件のチップ 5 個(訪問日:今日〜今週、担当:自分、薬切れ:3日以内、処方変更:あり、予定:患者確認待ちを含む)と青い「この条件を保存」ボタン。右パネルは無い。
- 現状: 専用ページ・サーバー保存の仕組みとも未実装。近い土台として、条件チップ表示の共通部品 FilterSummaryBar(patients/visits/tasks 等 9 画面で使用)、schedule-proposals 内のハードコードされた FilterPreset(URL クエリ ?preset= 連携)、workflow-query-state.ts 等の URL クエリ初期化パターンがある。Prisma に SavedView 系モデルは存在しない。
- UI ギャップ:
  - ページ自体が無い(完全新規)
  - プリセットカード 4 種(朝の確認/セット担当/事務で確認/管理者用)+ 説明文 + カードごとの「使う」ボタンの UI が無い
  - 「今の絞り込み条件」チップ群 + 「この条件を保存」ボタンが無い(FilterSummaryBar は表示専用で保存機能なし)
  - 既存プリセットは schedule-proposals 内ローカル定義のみで、画面横断の保存ビュー概念が無い
  - 文言注意: デザイン内「管理者用」説明の「ブロッカーあり」は文言ルール上「止まっている理由あり」へ置換して実装すべき
  - 右パネル未組込だがデザイン上も右パネル無しの画面(WorkspaceActionRail 不要)
- バックエンド:
  - SavedView Prisma モデル新規(org_id / user_id / name / target_screen / criteria JSON / role_scope)+ マイグレーション
  - /api/saved-views CRUD API 新規(withAuth、本人スコープ。「管理者用」プリセットは requireRole で管理者限定)
  - 保存・削除時の AuditLog 記録(設定変更操作として)
  - プリセット→各一覧画面(ダッシュボード/セット/訪問など)への適用規約(URL クエリ変換)を定義する必要
- データ源: `src/components/ui/filter-summary-bar.tsx(条件チップ表示部品)` / `src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx(FILTER_PRESET_LABELS / activatePreset のプリセット実装例)` / `src/app/(dashboard)/workflow/workflow-query-state.ts、src/app/(dashboard)/reports/reports-query-state.ts(URL クエリ状態の読み出しパターン)`
- 撮影セットアップ: 新ルート /views(ダッシュボード配下)を design-screen-map.ts に登録。プリセット 4 種はシステム定義で seed 不要、「今の絞り込み条件」はクライアント側初期値で再現できるため撮影前操作なし。

### p1_02_multi_card_split_workspace

- 種別: 改修 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: タイトル「複数カードを並べて確認」の下にカード詳細 3 枚(定期処方カード/臨時処方カード/返信待ちカード)を等幅 3 カラムで並列表示。各カードは患者名・期間ラベル(前回薬 5/21まで / 今回 5/22〜6/18)に続き「今日の見どころ」「止まっている理由」「次にやること」(次にやることのみ青背景で強調)の 3 セクションと、下部の青い「このカードへ」ボタンで構成。
- 現状: p0_08 のベースは /board(src/app/(phos)/board/page.tsx)+ BoardClient + WorkspaceOverlay。WorkspaceOverlay は openedCards / onSelectOpenedCard で複数カードを開いてタブ切替できるが、表示は Dialog 1 枚のみで並列表示はできない。CardDetailResponse(phos_contracts.ts)に card / next_action / pharmacist_brief / support_brief / blockers / source_refs が揃っており、NextActionPanel / BlockerPanel / PharmacistBriefPanel の部品も既存。
- UI ギャップ:
  - 並列(split)表示の画面が無い。既存はモーダル 1 枚 + タブ切替(WorkspaceTabs)のみ
  - カード種別見出し(定期処方カード/臨時処方カード/返信待ちカード)のラベリングが無い
  - 「今日の見どころ」見出しが無い(既存は pharmacist_brief/support_brief パネルで文言が異なる)
  - 期間サマリー行(前回薬〜まで / 今回〜)の表示が無い
  - 「次にやること」セクションの青背景強調と、カード下部の「このカードへ」遷移ボタンが無い
  - 右パネル未組込だが、本画面は各カード内に 3 点セット相当(見どころ/止まっている理由/次にやること)をインライン表示する構成。WorkspaceActionRail の RailCard をインライン再利用し、データは CardDetailResponse の pharmacist_brief / blockers / next_action から流す
- バックエンド:
  - 不足なし(既存 /api/phos プロキシのカード詳細 API を複数 card_id で並列フェッチすれば賄える)
  - 任意: 3 件まとめて返す batch 取得エンドポイントがあると往復回数を削減できる
- データ源: `src/phos/ui/workspace/WorkspaceOverlay.tsx / WorkspaceTabs.tsx(既存カード詳細 UI)` / `src/phos/ui/workspace/NextActionPanel.tsx / BlockerPanel.tsx / PharmacistBriefPanel.tsx` / `src/phos/contracts/phos_contracts.ts(CardDetailResponse 型、890 行付近)` / `src/app/(phos)/board/page.tsx(?card= で初期カード選択する既存パターン)` / `src/components/features/workspace/action-rail.tsx(RailCard 構成の流用元)`
- 撮影セットアップ: 新ルート /board/compare?cards=<id1>,<id2>,<id3> を提案して design-screen-map.ts に登録。phos backend のデモ seed から定期/臨時/返信待ちの 3 カードの card_id を URL 指定すれば撮影前操作は不要。

### p1_03_ai_visit_summary_review

- 種別: 改修 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3 カラム構成。左「根拠になる情報」に処方せん/前回訪問メモ/訪看メモ/検査値/残薬写真の 5 リンクカード、中央「AIがまとめた訪問前メモ」に自然文サマリーと「薬剤師の確認」3 択(内容は正しい=緑ハイライト/一部修正する/このまとめは使わない)、右「次にやること」に主操作の青ボタン「訪問モードへ」とアウトラインの「原文を確認」。サイドバーは「訪問」がアクティブ。
- 現状: サービス層は充実: getPatientVisitBrief(src/server/services/visit-brief.ts)+ generateVisitBriefAiSummary(visit-brief-ai.ts)、API は GET /api/patients/[id]/visit-brief と POST /api/visit-brief-feedback。UI は VisitBriefCard(visit-brief-card.tsx)が患者詳細タブ・medications・prescriptions・schedules/day-view に埋め込まれ、AI/ルール要約の比較切替と helpful/needs_review の 2 値フィードバックを持つ。独立したレビュー画面ルートは無い。
- UI ギャップ:
  - 独立した 3 カラムのレビュー専用画面が無い(既存は各画面への埋め込みカード)
  - 「薬剤師の確認」3 択(内容は正しい/一部修正する/このまとめは使わない)が無い。既存は helpful/needs_review の 2 値で文言も異なる
  - 「一部修正する」のまとめ本文編集・保存フローが無い
  - 左カラム「根拠になる情報」のリンクカード群が無い。VisitBrief の source_refs は文字列ラベル配列で、処方せん/前回訪問メモ/訪看メモ/検査値/残薬写真への遷移可能な参照構造になっていない
  - 右パネル未組込: WorkspaceActionRail の「次にやること」(訪問モードへ=主操作青、原文を確認)構成に載せる。データ源は visit-brief の context(対象訪問予定)→ /visits/[id]/record への導線と rule_summary(原文)
  - 既存カードの比較/AI/ルール切替ボタンや provider・fallback・24h 失敗率などの運用メタ表示はデザインに無く、レビュー画面では非表示にする必要
- バックエンド:
  - 確認結果(承認/修正/不使用)を保存する API: 既存 /api/visit-brief-feedback の rating 拡張、または review 専用エンドポイント新設。修正後本文の保存先フィールドが必要
  - AI 出力の採否・修正は薬学判断のため AuditLog 記録を追加すべき
  - 根拠リンクの構造化: visit-brief レスポンスに prescription_id / visit_record_id / 訪看メモ / 検査値(jahis_supplemental_records)/ 残薬写真(evidence)への参照 ID を追加
  - オフライン: schedules には visit-brief キャッシュ(schedule-day-visit-brief-cache)が既にあり再利用可。レビュー操作のオフラインキュー要否は要判断
- データ源: `src/server/services/visit-brief.ts(getPatientVisitBrief / getScheduleVisitBrief)` / `src/server/services/visit-brief-ai.ts(generateVisitBriefAiSummary / extractHandoffFromSoap)` / `src/app/api/patients/[id]/visit-brief/route.ts、src/app/api/visit-brief-feedback/route.ts` / `src/types/visit-brief.ts(VisitBrief 型: ai_summary / rule_summary / must_check_today / jahis_supplemental_records)` / `src/components/visit-brief/visit-brief-card.tsx(既存表示部品)` / `src/lib/visits/visit-brief-cache(オフラインキャッシュ)`
- 撮影セットアップ: 新ルート /patients/[id]/visit-brief(または /visits/brief-review?patient=<id>)を提案。seed 患者「佐藤 花子」or「鈴木 一郎」(prisma/seed.ts 291/311 行)の visit-brief を表示して撮影。撮影前操作なし(動的 ID は seed 患者 ID を解決して登録)。

### p1_04_ai_report_draft

- 種別: 改修 / 工数: M / 対応ルート: `/reports`
- デザイン: 2 カラム構成。左「AI下書き(薬剤師が確認して確定)」にセクションカード 5 枚(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと)を縦に並べ、各カードに「わかりやすい文面に整えています。必要なところだけ修正してください。」の説明。右「宛先別プレビュー」に医師向け(選択中=青ハイライト)/ケアマネ向け/訪問看護向け/施設向けの切替リストと、緑の「薬剤師確認済みにする」ボタン。サイドバーは「報告・文書」がアクティブ。
- 現状: 下書き生成は POST /api/care-reports/generate-from-visit が存在し、report-generator.ts が buildPhysicianReport / buildCareManagerReport(ルールベーステンプレート)で physician_report / care_manager_report の 2 種を status:'draft' で CareReport に保存する。reports/[id] には ReportEditForm による編集モードがあり、phos の ReportComposer には宛先 5 区分のテンプレセクションラベル(PhosReportComposerTemplateLabel)が定義済み。ただし宛先別プレビュー UI と確定操作の専用画面は無い。
- UI ギャップ:
  - デザインの 5 セクション(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと)単位の確認・編集 UI が無い。既存生成内容は宛先別の構造化 JSON でセクション名体系が異なる
  - 宛先別プレビューの切替リストが無い。既存生成は医師向け・ケアマネ向けの 2 宛先のみで、訪問看護向け・施設向けが生成されない
  - 「薬剤師確認済みにする」確定ボタンが無い(status は draft/sent/confirmed 等が定義済みだが draft→confirmed の確定 UI が無い)
  - 生成はルールベースで、デザインが示唆する「AI が文面に整える」LLM 整形が無い(visit-brief-ai.ts に LLM 基盤はある)
  - 右パネル未組込: 宛先別プレビュー + 確定ボタンを WorkspaceActionRail 構成(次にやること=薬剤師確認済みにする)に載せられる。データ源は CareReport(report_type 別 content)と PhosReportComposerTemplateLabel
  - 確定ボタンがデザインでは緑で「主操作は青 1 つ」ルールと衝突(承認セマンティクスの緑として許容するか設計判断要)
- バックエンド:
  - 宛先拡張: 訪問看護向け・施設向けの下書き生成(report-generator の report_type 拡充、または 1 ドラフトから宛先別ビューへ変換するサービス)
  - 確定 API: CareReport.status を draft→confirmed にする PATCH(既存 /api/care-reports/[id] 更新で賄える可能性大。permission canReport + AuditLog 記録)
  - 任意(将来): LLM による文面整形サービス + ルール生成へのフォールバック(visit-brief-ai.ts と同パターン)
  - 下書き生成自体は不足なし(既存 POST /api/care-reports/generate-from-visit を利用)
- データ源: `src/server/services/report-generator.ts(generateReportsFromVisit、content 構築は 360-440 行)` / `src/server/services/report-templates.ts(buildPhysicianReport / buildCareManagerReport)` / `src/app/api/care-reports/generate-from-visit/route.ts` / `src/phos/contracts/phos_copy.ja.ts(PhosReportComposerTemplateLabel: DOCTOR/CARE_MANAGER/VISITING_NURSE/FACILITY/FAMILY、306 行)` / `src/phos/ui/report/ReportComposer.tsx(宛先別セクション挿入の既存実装)` / `src/components/features/reports/report-edit-form(reports/[id] の編集フォーム)`
- 撮影セットアップ: route を /reports(一覧)から draft 詳細へ更新: seed の訪問記録に対し generate-from-visit で draft レポートを作成し、/reports/[id] の AI 下書きレビュー表示(新設タブ or 専用ルート /reports/[id]/draft)で撮影。setup でレポート id を seed から解決する。

### p1_05_interprofessional_portal

- 種別: 改修 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 内部シェル付きの 3 カラム共有管理画面。左「共有する相手」に主治医/ケアマネ(選択中=青ハイライト)/訪問看護/施設/家族のリスト、中央「相手に見える内容」に服薬状況/残薬/薬剤師からのお願い/次回確認すること/添付資料のプレビューカード、右「返信・確認」に「ケアマネからの返信」本文カード(ヘルパーへ声かけ依頼済み…)と青の主操作「次回タスクにする」。ユーザーは管理者表示。
- 現状: 外部向けビューアは src/app/shared/[token]/shared-viewer-content.tsx(OTP 認証 + scope 別表示 + 自己申告フォーム)として実装済み。発行 UI は患者詳細配下の external-share-content.tsx(scope チェックボックス + 共有先名の単発フォーム)。API は /api/external-access(発行)と /api/external-access/[token](閲覧・self-report)。返信データの受け皿としては CommunicationResponse モデルと /communications/requests(返信フォロー一覧)が既存。デザインが示す宛先別の統合管理画面は無い。
- UI ギャップ:
  - 宛先別(主治医/ケアマネ/訪問看護/施設/家族)に共有を一覧・切替する 3 カラム管理画面が無い。既存発行 UI は患者詳細配下の単発フォーム
  - 「相手に見える内容」のプレビューが無い。既存 scope 体系(アレルギー情報/服薬一覧/訪問予定/訪問報告書/AIサマリー等)とデザインの項目(薬剤師からのお願い/次回確認すること/添付資料)が不一致
  - 相手からの返信を同一画面で確認するパネルが無い(自己申告は外部ビューア側、返信フォローは別画面 /communications/requests)
  - 「次回タスクにする」ボタンが無い(返信→フォロータスク起票の導線)
  - 右パネル未組込: 「返信・確認」を WorkspaceActionRail(次にやること=次回タスクにする、根拠・資料=返信原文/共有ページリンク)で構成可能。データ源は CommunicationResponse および external-access の self_report_history
- バックエンド:
  - ExternalAccess grant に宛先種別(physician/care_manager/visiting_nurse/facility/family)フィールドを追加(現状は recipient 名の自由入力のみ)
  - 共有内容の新 scope 追加(薬剤師からのお願い・次回確認すること・添付資料)と外部ビューア側の対応表示、scope 検証(external-access/shared.ts の validateExternalAccessScopeForRole)の更新
  - 「次回タスクにする」は既存 POST /api/communication-requests で起票可能(不足なしに近い)。返信→タスクの related_entity 紐付け規約のみ追加
  - 共有発行・scope 変更の AuditLog 記録(外部開示操作のため必須)、発行権限の requireRole 確認
- データ源: `src/app/shared/[token]/shared-viewer-content.tsx(ExternalPayload 型 / SCOPE_DISPLAY_NAMES)` / `src/app/(dashboard)/patients/[id]/share/external-share-content.tsx(発行フォーム)` / `src/app/api/external-access/route.ts と shared.ts(scope 検証)` / `prisma/schema/communication.prisma(CommunicationRequest / CommunicationResponse: responder_name / content / responded_at)` / `src/app/(dashboard)/communications/requests/requests-content.tsx(返信フォロー一覧)`
- 撮影セットアップ: 現在の design-screen-map の note は /shared/[token](外部ビューア)を想定しているが、PNG は内部画面のため新ルート(例: /patients/[id]/share の 3 カラム化、または /sharing)へ登録し直す。seed で対象患者の共有 grant + ケアマネからの CommunicationResponse を用意し、ケアマネ選択状態(デフォルト選択)で撮影。

### p1_06_management_analytics_detail

- 状態: 実装済(`/admin/operations-insights`、見出し「在宅業務の動きを見る」)。nav=分析・監視グループに登録。BFF=`/api/admin/operations-insights`、集計純関数=`src/lib/analytics/operations-insights.ts`。以下は実装前ギャップ調査の参照。
- 種別: 改修 / 工数: M / 対応ルート: `/admin/operations-insights`(旧記載 `/admin/analytics` から訂正)
- デザイン: タイトル「在宅業務の動きを見る」。上段にカード 2 枚: 「月ごとの訪問件数」(1〜5月の縦棒グラフ、120→188 件、バーごとに多色)と「時間がかかっている工程」(入力42/監査65/セット88/訪問120/報告70 の縦棒グラフ)。下段に「改善のヒント」カードとして箇条書き 4 件(セット監査が木曜午前に集中/報告書送付待ちが増えている/事務で解消できる未設定が12件/緊急対応余力は平均2.8件)。サイドバーは「レポート」がアクティブ。右パネル無し。
- 現状: /admin/analytics(analytics-content.tsx)は請求分析(/api/billing-evidence/analytics)+ 地域資源マップで、月次推移は table 描画でありデザインの内容とほぼ別物。/admin/metrics は処方集中率等の KPI カード(月次推移なし)。一方 /capacity(src/phos/ui/capacity/CapacityDashboard.tsx)には「工程別作業分数」見出し + recharts の Bar チャート + ボトルネック表示が既にあり、「時間がかかっている工程」に最も近い。recharts@3.8.1 は導入済み。
- UI ギャップ:
  - 「月ごとの訪問件数」棒グラフが無い(admin/metrics は年累計の単一値、analytics は請求件数 table のみ)
  - 「時間がかかっている工程」グラフが /admin/analytics に無い(capacity に近い実装があるが別ページ・別データで、入力/監査/セット/訪問/報告の 5 工程区分との対応付けも必要)
  - 「改善のヒント」(自然文インサイト箇条書き)セクションが無い
  - ページ見出しが「在宅業務の動きを見る」ではなく請求分析中心の構成
  - デザインのバー多色はガイドライン(落ち着いたブルー基調)と衝突するため実装時に配色判断が必要
- バックエンド:
  - 月次訪問件数 API: visitRecord の月別 groupBy 集計(新規 or /api/admin/metrics 拡張)。管理者 requireRole 必須
  - 工程別所要時間の集計: phos capacity 集計(/api/phos 経由)の流用、または工程ステータス遷移タイムスタンプからの月次集計サービス新規
  - 改善のヒント生成: capacity bottlenecks + 報告書送達滞留(report-delivery)+ 送付先未設定数(contact-profiles)+ 緊急余力を合成するルールベース insight API 新規
  - 閲覧のみのため AuditLog は不要(管理画面アクセス監査は既存方針に従う)
- データ源: `src/app/(dashboard)/admin/analytics/analytics-content.tsx(現行ページ)` / `src/app/(dashboard)/admin/metrics/metrics-dashboard-content.tsx + src/app/api/admin/metrics/route.ts(KPI 集計の実装例)` / `src/phos/ui/capacity/CapacityDashboard.tsx(recharts Bar 実装例・工程別作業分数・bottlenecks)` / `src/server/services/report-delivery.ts(送付待ち滞留)` / `recharts(package.json 導入済み)`
- 撮影セットアップ: 既存登録どおり route=/admin/analytics(上部に本デザインのセクションを追加 or タブ化)。管理者ロールのセッションで撮影。seed に直近 5 ヶ月分の訪問実績が無ければ月次件数が空になるため seed 拡充が前提。

### p1_07_inventory_linkage_prediction

- 状態: 実装済(`/admin/inventory-forecast`、見出し「在庫と定期処方の予測」)。nav=分析・監視グループに登録。BFF=`/api/admin/inventory-forecast`、集計純関数=`src/lib/analytics/inventory-forecast.ts`。以下は実装前ギャップ調査の参照。
- 種別: 新規 / 工数: L / 対応ルート: `/admin/inventory-forecast`(旧記載 `(未確定/新規)` から確定)
- デザイン: 2 カラム構成。左カード「来週必要になりそうな薬」はテーブル(列: 薬剤/必要見込み/在庫/対応)で、アムロジピン 560錠・在庫320錠=発注候補、酸化Mg 900錠・1200錠=余裕あり、トラセミド 280錠・40錠=要発注の 3 行。右カード「影響する患者さん」は患者カード 4 件(田中一郎/佐藤花子/鈴木次郎/施設A 5名、いずれも「次回処方予定あり」)。サイドバーは「レポート」がアクティブ。右パネル無し。
- 現状: 在庫予測画面は存在しない。在庫データは PharmacyDrugStock(stock_qty / reorder_point / last_dispensed_at)として保持され、/api/pharmacy-drug-stocks(site_id 必須)+ bulk / usage-mismatch / review / safety-follow-up のサブ API があり、UI は /admin/drug-masters の採用薬管理に組み込まれている。需要側の材料は workflow API の refill_upcoming(next_dispense_date / remaining_count)に次回調剤予定として存在するが、薬剤別必要数量の集計・在庫突合は未実装。
- UI ギャップ:
  - 画面自体が無い(完全新規)
  - 「必要見込み」(来週の定期処方サイクルから薬剤別必要数量を合算)の算出・表示が無い
  - 「対応」3 状態ラベル(要発注=赤系/発注候補=橙系/余裕あり)の判定・表示が無い
  - 「影響する患者さん」(不足候補薬剤に紐づく次回処方予定の患者・施設まとめカード)が無い
  - 既存の在庫 UI(/admin/drug-masters)はマスタ採用管理視点で、予測・発注判断視点のレイアウトではない
  - 右パネル未組込だがデザイン上も右パネル無し(将来「次にやること=発注候補に追加」を WorkspaceActionRail で足す余地はあり、データ源は本予測 API)
- バックエンド:
  - 需要予測 API 新規: 次週の処方予定(refill_upcoming 相当のサイクルロジック + prescriptionLine の数量・日数)から薬剤別必要数量を集計し、PharmacyDrugStock.stock_qty と突合して対応状態(要発注/発注候補/余裕あり)を返す。site_id スコープ検証は既存 stocks API と同様に必須
  - 同 API に薬剤→影響患者(施設入居者はまとめ)の関連リストを含める
  - seed/運用整備: stock_qty 未入力だと突合できないため、seed への在庫数量投入が前提
  - 閲覧のみなら AuditLog 不要。発注候補化などの書き込みアクションを付ける場合は記録を追加
- データ源: `src/app/api/pharmacy-drug-stocks/route.ts(在庫 CRUD・site スコープ検証の実装例)` / `prisma/schema/drug.prisma(PharmacyDrugStock: stock_qty / reorder_point / last_dispensed_at、156-186 行)` / `src/app/(dashboard)/workflow/workflow-dashboard.types.ts(refill_upcoming 型、275-294 行)と /api/dashboard/workflow(次回調剤日ロジック)` / `src/app/(dashboard)/admin/drug-masters/drug-master-content.tsx(在庫 UI 部品・FilterSummaryBar 使用例)`
- 撮影セットアップ: 新ルート /admin/inventory-forecast(またはレポート配下 /reports/inventory)を design-screen-map.ts に登録。seed にアムロジピン等の PharmacyDrugStock(stock_qty 入り)と、来週次回調剤予定を持つ患者(田中/佐藤/鈴木 + 施設患者)を整備して撮影。撮影前操作なし。

### p1_08_facility_criteria_dashboard

- 種別: 改修 / 工数: M / 対応ルート: `/admin/facility-standards`
- デザイン: 2カラム構成。左「施設基準チェック」カードに要件項目の行リスト(在宅実績=OK緑、緊急対応体制=OK緑、研修記録=不足橙、文書交付体制=OK緑、電子的連携=確認中橙)で、各行が状態色背景+右端バッジ。右「足りないもの」カードに不足理由の説明文(研修記録の添付不足、受講日・受講者・資料の確認)と主操作ボタン「資料を追加」(青)が1つだけ。
- 現状: /admin/facility-standards は届出一覧の DataTable(届出種別/届出日/要件充足/有効期限/算定可否)+期限・未達のアラートバナー構成。GET /api/admin/facility-standards(canAdmin)が FacilityStandardRegistration の requirements_status(Json)から claim_status を導出して返す。要件項目を個別行で見せる UI は無い。
- UI ギャップ:
  - 要件項目ごとの行リスト(項目名+OK/不足/確認中バッジ、緑/橙の状態色背景)が無い。現状は requirements_status を「充足/一部不足/不足」の1バッジに集約したテーブル表示
  - 「足りないもの」パネル(不足項目の説明文+次アクション)が無い。右パネル未組込 — WorkspaceActionRail の「次にやること」(資料を追加)と「止まっている理由」(研修記録 不足=橙)へ requirements_status の false 項目を流せる
  - 主操作「資料を追加」(青)が無く、資料添付の導線自体が存在しない
  - 「確認中」の第3状態が表現できない(requirements_status が boolean のみ)
  - デザインはカード型チェックリスト+説明パネル、現実装は Excel 的テーブル+バナーで情報構造が異なる
- バックエンド:
  - requirements_status の三値化(ok/lacking/checking)が必要。現状 Record<string, boolean> で「確認中」を表せない
  - 要件項目への資料添付 API が無い。/api/files/presigned-upload の purpose は prescription/visit-photo/report のみで施設基準資料は不可。purpose 追加 or 専用添付モデルが必要
  - 要件状態・資料の更新 API(PATCH)が無い(現状 GET のみ)。更新時の AuditLog 記録も必要
  - 閲覧自体は既存 GET /api/admin/facility-standards(canAdmin)で不足なし
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/admin/facility-standards/route.ts(GET、canAdmin、claim_status 導出)` / `/Users/yusuke/workspace/careviax/prisma/schema/organization.prisma の FacilityStandardRegistration(requirements_status Json)` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx(WorkspaceActionRail)` / `/Users/yusuke/workspace/careviax/src/server/services/file-storage.ts(資料添付を載せる場合の S3 基盤)`
- 撮影セットアップ: design-screen-map.ts に登録済み(route: /admin/facility-standards)のままで可。ただし prisma/seed.ts に FacilityStandardRegistration が無いため、requirements_status に在宅実績/緊急対応体制/研修記録/文書交付体制/電子的連携の5キーを持つ届出1件を seed し、研修記録=不足・電子的連携=確認中の状態を作ってから撮影する。

### p1_09_incident_hiyarihatto

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 2カラム構成。左「記録一覧」にヒヤリハットのカードリスト(セット日付間違い/報告書送付遅れ/訪問時間変更の伝達漏れ/残薬写真不足、各カードにサブテキスト「再発防止を記録」)。右「再発防止メモ」フォームに5入力(起きたこと/原因/すぐ行った対応/次から変えること/関係する工程)と主操作「保存する」(青)が1つ。
- 現状: 対応画面なし。src/app/(dashboard)/issues は空ディレクトリで /issues は 404。既存 MedicationIssue(/api/medication-issues、canVisit)は patient_id 必須の服薬課題(adherence/side_effect/interaction 等)であり、患者非依存の業務インシデント(報告書送付遅れ等)や再発防止メモの構造化フィールドを持たないため代替不可と判断。
- UI ギャップ:
  - 画面全体が未実装(記録一覧+再発防止メモフォーム)
  - MedicationIssue で代替すると「原因」「すぐ行った対応」「次から変えること」「関係する工程」の構造化フィールドが無く title/description への詰め込みになり、Structured Data First 原則に反する。patient_id 必須も障害
  - 右パネル未組込 — 選択中記録の「次にやること」(再発防止を記録→保存する)と「根拠・資料」(関連する訪問記録・報告書・写真へのリンク)を WorkspaceActionRail に流せる
- バックエンド:
  - 専用モデルが必要(例: IncidentReport — org_id, title, occurred_at, what_happened, cause, immediate_action, prevention_change, related_process, patient_id?(任意), reporter_id, status)。MedicationIssue は patient 必須+目的が異なるため流用不可
  - CRUD API(GET 一覧/POST/PATCH)。起票は canVisit 以上、閲覧は org 内全ロール想定で requireRole 設計が必要
  - 医療安全記録のため作成・更新時の AuditLog 記録必須(Audit by Default)
  - 訪問中の起票を想定する場合のオフライン(Dexie)キューは将来課題として仕様に明記
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/medication-issues/route.ts(withAuth/withOrgContext/pagination の実装パターン参考)` / `/Users/yusuke/workspace/careviax/prisma/schema/medication.prisma の MedicationIssue(モデル設計の参考)` / `/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx`
- 撮影セットアップ: 新ルート(候補: /incidents)を実装後に design-screen-map.ts へ登録。撮影前にデザインと同一の4件(セット日付間違い/報告書送付遅れ/訪問時間変更の伝達漏れ/残薬写真不足)を seed し、未選択状態(右フォーム空欄)で撮影する。空ディレクトリ (dashboard)/issues の扱い(p0_32 のマッピング /issues が 404)もこのとき整理する。

### p1_10_report_template_editor

- 種別: 改修 / 工数: M / 対応ルート: `/admin/document-templates`
- デザイン: 3カラム構成。左「テンプレート」の宛先別リスト(医師向け=選択中・青背景/ケアマネ向け/訪問看護向け/施設向け/家族向け)。中央「文面を編集」に {服薬状況}{薬剤師評価}{他職種へのお願い} 等の差し込み変数入りプレーンテキスト。右「差し込み項目」チップ群(服薬状況/残薬/副作用/薬剤師評価/お願いしたいこと/次回確認)+主操作「保存する」(青)が1つ。
- 現状: /admin/document-templates は登録フォーム(名前/種別 Select/対象ロール自由入力/形式/版/有効期間/既定 Switch/本文 JSON textarea)+一覧 DataTable+送達ルール管理の構成。/api/templates の CRUD と Template モデル(target_role, content Json)は実装済みだが、本文は生 JSON を直接編集する方式。
- UI ギャップ:
  - 宛先別テンプレートの縦リスト選択 UI が無い(現状は種別フィルタボタン+テーブル。デザインは医師向け/ケアマネ向け/訪問看護向け/施設向け/家族向けのカードリスト+選択ハイライト)
  - 本文編集が JSON textarea のまま。デザインは {変数} 入りプレーンテキストの文面エディタ
  - 「差し込み項目」チップパレット(クリックでカーソル位置に {服薬状況} 等を挿入)が無い
  - 主操作の文言が「登録する/更新する」でデザインの「保存する」と不一致。また登録/編集/削除/フィルタが同列に並び主操作1つ強調になっていない
  - 版/形式/有効期間/既定スイッチなどの管理メタがデザインの主画面に無い(詳細設定への退避が必要という設計判断)
  - 右パネル未組込(右カラム=差し込み項目+保存ボタン。「次にやること」=保存する、として WorkspaceActionRail に整理可能)
- バックエンド:
  - 不足なし(既存 /api/templates の CRUD + target_role で賄える)。content Json に { body: string } 形式で差し込み文面を保存可能
  - 差し込み変数定義(服薬状況/残薬/副作用/薬剤師評価/お願いしたいこと/次回確認)はフロント定数で開始可。ただし報告書生成側(care-reports)との変数→実データ対応表の整備が必要
  - target_role が自由文字列のため physician/care_manager/visiting_nurse/facility/family の enum 整理を推奨
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/templates/route.ts と /api/templates/[id]/route.ts(CRUD)` / `/Users/yusuke/workspace/careviax/prisma/schema/admin.prisma の Template(target_role / content Json / is_default)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/document-templates/template-content.tsx(現実装)`
- 撮影セットアップ: design-screen-map.ts に登録済み(route: /admin/document-templates)のままで可。seed に Template が1件も無いため、target_role 別の5テンプレート(医師向け〜家族向け)を seed し、setup で「医師向け」を選択状態にして撮影する。

### p1_11_voice_memo_transcription

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 2カラム構成。左「録音メモ」カード(見出し「訪問中メモ 01:23」+音声波形+「再生する」(青・主操作)と「文字にする」(白アウトライン))。右「文字起こし」カードに転写テキスト(夕食後の薬は家族が声をかけると飲めている…)と緑の「訪問記録へ入れる」ボタン。薬剤師ロール、サイドバー「訪問」アクティブ。
- 現状: 録音ファイルの保存・再生・転写画面は未実装。既存は Web Speech API によるリアルタイム SOAP 音声入力のみ(voice-recognition.ts + use-speech-recognition.ts、visit-record-form.tsx 組込)で録音データは保存されない。S3 アップロード基盤(/api/files/presigned-upload + file-storage.ts)は purpose 3種・画像/PDF MIME のみで音声不可。
- UI ギャップ:
  - 画面全体が未実装(録音メモカード/波形表示/再生/「文字にする」/転写結果/「訪問記録へ入れる」)
  - 既存のリアルタイム音声認識は「録音→後から転写」フローと別物で、録音ファイルの保存・一覧・再生が存在しない
  - 転写テキストを訪問記録(SOAP)へ反映する「訪問記録へ入れる」導線が無い
  - 右パネル未組込 — 「次にやること」(訪問記録へ入れる)と「根拠・資料」(元音声ファイルを見る/聴く)を WorkspaceActionRail に流せる
- バックエンド:
  - FilePurpose に 'voice-memo' 追加+audio/webm・audio/mp4 等の MIME 許可(file-storage.ts の assertAllowedUpload は現状画像+PDF のみ)。S3 保存・KMS 暗号化は既存 presigned フローを流用可
  - VoiceMemo モデル新設(org_id, visit_record_id, file_id, duration_seconds, transcript_text, transcript_status: pending/processing/done/failed)+CRUD API(canVisit+担当者スコープ、AuditLog 記録)
  - 転写ジョブ: サーバ側転写には Amazon Transcribe(ISMAP 対象・ap-northeast-1)等の外部依存が必要。外部依存を避ける場合は再生中に既存 Web Speech API でクライアント転写する代替案があるが精度・自動化に制約 — 採否の設計判断が必要
  - 転写結果の訪問記録反映(visit-records 更新 API への追記+監査ログ)、訪問中録音のオフライン考慮(IndexedDB 暗号化保持→オンライン時アップロード)
- データ源: `/Users/yusuke/workspace/careviax/src/server/services/file-storage.ts(presigned upload / KMS / Object Lock)` / `/Users/yusuke/workspace/careviax/src/app/api/files/presigned-upload/route.ts(purpose 別認可の実装パターン)` / `/Users/yusuke/workspace/careviax/src/lib/voice-recognition.ts と src/lib/hooks/use-speech-recognition.ts(クライアント転写の流用候補)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx(転写の反映先)`
- 撮影セットアップ: 新ルート(候補: 訪問記録配下 /visits/[id]/voice-memos か記録画面内タブ)を実装後に登録。動的 ID のため seed のデモ患者(田中 美智子)に VisitSchedule+VisitRecord を追加し、transcript_text にデザイン文言を持つ転写済み VoiceMemo 1件(duration 83 秒)を seed して撮影する。

### p1_12_advanced_route_scenario_compare

- 種別: 新規 / 工数: L / 対応ルート: `(未確定/新規)`
- デザイン: 3カラムの案比較。案A 移動少なめ(青の折れ線経路チャート+番号付き訪問点1-4、サマリ「移動92分 / 余力2件」、青 filled の「この案を使う」)、案B 希望時間優先(緑、「移動105分 / 患者希望一致」、outline)、案C 緊急余力優先(橙、「移動118分 / 午後余力大」、outline)。推奨案のみ主操作を強調する設計。
- 現状: POST /api/visit-routes は単一案の最適化のみ(schedule_ids/proposal_ids+travel_mode → 1 プラン)。day-view.tsx は travel_mode 切替による単一ルートプレビュー+並び替えドラフト、schedule-weekly-optimizer.tsx も単一計算。複数シナリオを同時生成して比較する API・UI はどちらも無い。
- UI ギャップ:
  - 案A/B/C の3カード同時比較レイアウトが無い(現状は単一ルートのプレビューのみ)
  - 各案のミニ経路チャート(番号付き訪問点の折れ線、案ごとの青/緑/橙の色分け)が無い
  - サマリ指標「余力2件」「患者希望一致」「午後余力大」が未算出(現状は移動時間・距離のみ)
  - 「この案を使う」採用操作(推奨案のみ青 filled、他は白 outline の強弱)が無い
  - 右パネル未組込(本画面は3カラム比較が主役。採用確定を「次にやること」に整理する余地あり)
- バックエンド:
  - /api/visit-routes の複数案対応: 最適化目的(移動最小/希望時間優先/緊急余力優先)のパラメータ化と、1リクエストで複数プランを返す拡張(現状は travel_mode のみで目的関数を切替不可)
  - 「患者希望時間との一致度」「緊急余力(午後の空き枠数)」を算出する指標ロジックを visit-route-engine に追加(VisitSchedule の希望時間帯データとの突合)
  - 案の採用=並び順確定は既存 /api/visit-routes/reorder を流用可能。採用操作の AuditLog 記録を追加
  - 認可は既存 canVisit+assignment where で不足なし
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/visit-routes/route.ts と /api/visit-routes/reorder/route.ts` / `/Users/yusuke/workspace/careviax/src/server/services/visit-route-engine.ts(VisitRoutePlan 型、computeOptimizedVisitRoute、Google Routes 不通時のフォールバックあり)` / `/Users/yusuke/workspace/careviax/src/app/(dashboard)/schedules/day-view.tsx(単一案プレビューの既存実装、892行付近)`
- 撮影セットアップ: /schedules 配下に比較ビュー(例: /schedules/route-compare か day-view 内のモード)を実装後に登録。撮影には座標(lat/lng)付き患者4件分の VisitSchedule seed が必要(既存 seed 患者5名に residences 座標を補完)。CI では外部経路 API 不通でもエンジンの距離フォールバックで撮影可。

### p1_13_realtime_collaboration_presence

- 種別: 部品 / 工数: M / 対応ルート: `(未確定/新規)`
- デザイン: 3カラム構成。左「同じカードを見ている人」に名前+見ている場所のカードリスト(佐藤薬剤師=処方タブ/鈴木事務=送付先確認/高橋薬剤師=報告書)。中央「コメント・確認」に「名前:本文」形式のコメントリスト。右「重複を防ぐ」に説明文(他のスタッフが編集中の場所は、上書き前に…)+青の主操作「最新を読み込む」。
- 現状: 基盤は実装済み: /api/presence(GET/POST、in-memory TTL60秒、SSE broadcast、active_field 対応)、PresenceAvatars(イニシャルアバター列、dispensing/[taskId] のみ組込)、CommentThread(/api/comments 対応コンポーネントだが未配置)、useCollaborativeForm(stale 検知、dispense-form のみ)。presence 対象 entity は dispense_task/visit_record の2種に限定。
- UI ギャップ:
  - 「同じカードを見ている人」が名前+場所テキストのカードリストではなく、イニシャルアバター列のみ(active_field は API にあるが表示していない)
  - active_field を「処方タブ」「送付先確認」「報告書」等の日本語ラベルへ変換する辞書/規約が無い
  - CommentThread コンポーネントが存在するのにどの画面にも組み込まれていない
  - 「重複を防ぐ」パネル(説明文+「最新を読み込む」ボタン)が無い。useCollaborativeForm に stale 検知はあるが、この文言・常設パネル UI は別物
  - presence 対象がカード詳細ワークスペース(p0_08 /workflow)に未対応。3点セット(見ている人/コメント/重複防止)を WorkspaceActionRail の children 追加カードとして組み込む形が右パネル整合的
- バックエンド:
  - collaborationEntityTypeSchema(現状 dispense_task/visit_record のみ、src/server/services/collaboration-access.ts)へカード/ケース等の entity_type 追加
  - 「見ている場所」はクライアントが POST /api/presence の active_field に送る運用で API 不足なし
  - /api/comments は entity_type/entity_id 対応済みで不足なし
  - presence/comments とも permission が canDispense 固定。デザインに事務ロール(鈴木事務)が登場するため、事務を含む権限への緩和判断が必要
  - 「最新を読み込む」はクライアント refetch で完結(API 不足なし)
- データ源: `/Users/yusuke/workspace/careviax/src/app/api/presence/route.ts と src/server/services/presence-store.ts(TTL 60秒 in-memory)` / `/Users/yusuke/workspace/careviax/src/components/features/collaboration/presence-avatars.tsx(改修ベース)` / `/Users/yusuke/workspace/careviax/src/components/features/comments/comment-thread.tsx と /api/comments` / `/Users/yusuke/workspace/careviax/src/lib/hooks/use-collaborative-form.ts(重複防止・stale 検知)` / `/Users/yusuke/workspace/careviax/src/lib/hooks/use-realtime-events.ts(SSE)`
- 撮影セットアップ: presence は in-memory TTL 60秒のため静的 seed 不可。組込先(第一候補: /dispensing/[taskId]、将来は /workflow カード詳細)を route 登録し、setup 内で API 直叩き(別ユーザー3名分の POST /api/presence に active_field を付与+POST /api/comments 3件)してから撮影する。複数ユーザー seed(薬剤師2+事務1)が前提。

### p1_14_ai_signal_tuning

- 種別: 改修 / 工数: M / 対応ルート: `/admin/alert-rules`
- デザイン: 2カラム構成。左「表示を強める項目」にシグナル項目の行リスト(腎機能に注意=強く表示(青チップ)/転倒リスク=標準(灰)/低血糖リスク=強く表示/残薬多め=標準/飲み合わせ=強く表示)。右「カードでの見え方」に患者カードプレビュー(田中 一郎 様+タグ: 腎機能注意=赤/転倒注意=橙/残薬=青)と主操作「保存する」(青)が1つ。
- 現状: /admin/alert-rules はルール CRUD フォーム(アラート種別8種 select/重要度 critical~info/有効化 Switch/メッセージ/条件 JSON textarea)+サイクル ID 指定のテスト実行+登録済みルールのカード一覧。/api/drug-alert-rules(canAdmin)と DrugAlertRule モデル(org_id 無しのグローバル定義)を使用。表示強度の2値トグルや患者カードプレビューは無い。
- UI ギャップ:
  - 項目ごとの「強く表示/標準」トグルチップ行が無い(現状は critical/warning/info select と ON/OFF Switch、JSON 条件編集)
  - 「カードでの見え方」プレビュー(設定変更が患者カードの赤/橙/青タグにどう反映されるか)が無い
  - デザインのシグナル項目のうち転倒リスク/低血糖リスク/残薬多めが既存 alert_type(interaction/duplicate/allergy_cross/renal_dose/pim_elderly/high_risk/narcotic/max_days)に存在しない
  - 文言が技術用語のまま(severity=critical 等の英語キー表示)。デザインは「強く表示/標準」の平易語
  - 主操作が複数並列(登録する/テスト実行/編集/削除)。デザインは「保存する」1つに集約
  - 右パネル未組込(右カラム=プレビュー+保存。「次にやること」=保存する として WorkspaceActionRail に整理可能)
- バックエンド:
  - 「表示強度(強く表示/標準)」の保存先が無い。DrugAlertRule.severity 流用か新フィールドかの判断要。さらに DrugAlertRule に org_id が無くグローバル定義のため、テナント別チューニングにするなら org_id 追加 or org 別表示設定モデルの新設が必要(設計判断)
  - 転倒リスク/低血糖リスク/残薬多めのシグナル種別追加(AlertType enum 拡張、または残薬は residual-medications 由来・転倒/低血糖は患者リスク由来として別ソース統合の整理)
  - 設定変更時の AuditLog 記録(安全表示設定の変更履歴)
  - プレビューはフロント完結で API 不足なし。既存 /api/drug-alert-rules(canAdmin)と /api/notification-rules は通知チャネル用として併用可
- データ源: `/Users/yusuke/workspace/careviax/src/app/(dashboard)/admin/alert-rules/page.tsx(現実装、ALERT_TYPE_LABELS)` / `/Users/yusuke/workspace/careviax/src/app/api/drug-alert-rules/route.ts(canAdmin)と prisma/schema/drug.prisma の DrugAlertRule` / `/Users/yusuke/workspace/careviax/src/app/api/notification-rules(prisma/schema/admin.prisma の NotificationRule — event_type/channel/enabled)` / `/api/cds/check(テスト実行に既使用、プレビュー実データ化の将来候補)`
- 撮影セットアップ: design-screen-map.ts に登録済み(route: /admin/alert-rules)のままで可。撮影前に DrugAlertRule 5種(腎機能/転倒/低血糖/残薬/飲み合わせ相当)を seed し、強く表示=3件・標準=2件の状態を作る。プレビューの患者名「田中 一郎」はフロント固定サンプル文言を推奨(seed 患者は田中 美智子のため)。

## 横断ノート(共通部品化・設計判断)

- p0_08 実装先の推奨: (b) /patients/[id](patient-detail-tabs)の改修を推奨。3 カラム骨格+右レール(WorkspaceActionRail=PatientWorkspaceRail)+visit_brief 配線が既に完成しており、ダッシュボードの患者カード(patient-card.tsx)も /patients/[id] へリンク済みのため最短で忠実度を上げられる。(a) /workflow は主業務フロー/コントロールセンター/疑義照会ワークベンチ/例外コマンドセンター等 20 セクションの org 横断管制塔で、単一患者×当日工程の責務ではない。(c) 新規 /patients/[id]/today は p0_38(患者プロフィール)との責務分離としては最も綺麗で、患者マスタ詳細とワークスペースの将来分割を見据えるなら次段階の選択肢。段階案: まず (b) に「薬剤師メモ」相当の既定タブ(今日の見どころ/処方の変化/セットの注意)と左ミニカード・工程駆動レールを実装し、p0_38 着手時に (c) への分割を再判断する。
- 共通部品候補 1: 「左カテゴリバッジ+太字タイトル+サブ文+右端『開く』アウトラインボタン」のリスト行カードが p0_04(通知)と p0_05(検索結果)で完全に同型 → ListOpenCard 等として共通化し、両画面で再利用する。
- 共通部品候補 2: 選択中=青塗り/非選択=白アウトラインのフィルタチップ行が p0_04・p0_05(および p0_06 の語彙)で同型 → FilterChipBar として共通化。既存の Button variant 切替実装(notifications-content.tsx)を置き換える。
- 設計判断(通知分類): デザインの 5 分類(急ぎ/薬剤師確認/事務で対応/返信待ち/未同期)を NotificationType enum 拡張(Prisma migration 要・既存データ移行要)にするか、既存 4 値+event_type/metadata からの表示時マッピングにするかを決める必要がある。「未同期」だけはサーバ通知でなくクライアント offline-store 由来であり、サーバ行と合成して並べる UI 規約が必要。
- 設計判断(検索の形態): 全体検索をモーダル維持(大型化)とするか /search ページ化するか。p0_05 の PNG はページ風全幅で、p0_06(詳しく絞り込む)の起動導線・戻り先にも影響するため先に確定すべき。
- 処方カードの人間可読番号(RX-202405-0001 形式)の採番ルールが未定。PrescriptionIntake は cuid のみで表示用番号が無く、p0_05 検索結果と p0_08 ワークスペース双方で必要になるため早期に決める(DB フィールド追加 or 決定的フォーマッタ)。
- 横断検索 API を新設する場合(/api/search?q= の文脈サマリ付き横断検索と /api/search/cards の条件 AND 検索)、p0_05/p0_06 で共用設計とし、必ず担当スコープ(resolveDashboardAssignmentScope / buildCareCaseAssignmentWhere)と limit 上限を通すこと。
- WorkspaceActionRail の表示ブレークポイントが患者詳細では 2xl(1536px)限定。p0_08 を右パネル 3 点セットの基準画面とするなら、lg 以上で表示するよう全ワークスペース画面で統一する判断が必要(撮影 viewport 1600px では現状でも表示される)。
- visit_brief(src/server/services/visit-brief.ts)が p0_08 中央 3 セクションのデータ源としてほぼ揃っている(must_check_today/ai_summary→今日の見どころ、medication_changes→処方の変化、dispensing_items→セットの注意)。不足は medication_changes の用法・日数、現在工程、予定確定状態、実資料 URL の 4 点に集約される。
- 撮影用 seed の不足: prisma/seed.ts には Notification も MedicationCycle も無い。p0_04(通知 4 分類)と p0_08(工程・処方差分・セット注意)の忠実撮影にはデモデータ追加が前提になるため、seed 拡張を 1 タスクとして先行させると 4 画面の検証ループが回しやすい。
- 7画面中5画面(p0_09/p0_12/p0_13/p0_14/p0_15)が「左キュー(患者カード列)+中央ワーク+右レール」のマスターディテール3カラム。左リスト選択→中央詳細→右 WorkspaceActionRail を束ねる共通 WorkbenchLayout 部品を先に作ると全画面の工数が大きく下がる(現状は一覧 DataTable→詳細ページ遷移の2画面構成)
- WorkspaceActionRail(/Users/yusuke/workspace/careviax/src/components/features/workspace/action-rail.tsx)の利用実績は patient-workspace-rail のみ。「止まっている理由」へ流すデータ源(InquiryRecord/submitBlockers/CDS alerts/workflow-exceptions/crush_prohibited タグ)を BlockedReason[] へ正規化する共通アダプタが必要
- 加工・セット方法の語彙 SSOT が分裂している: PackagingMethod enum(patient.prisma)、PrescriptionLine.dispensing_method(文字列)、SET_METHOD_OPTIONS(set-methods.ts)、PackagingInstructionTag。デザイン語彙(一包化/粉砕/分包しない/別包/セット対象外、お薬カレンダー/お薬BOX/薬袋管理/施設カート/中止薬回収袋)への正規化マッピングを最初に設計判断しないと p0_10/12/14 で表記揺れが再生産される
- 「中止薬の回収」状態(回収予定入力・回収袋準備・回収済み)がどのモデルにも無いのに p0_10/p0_11/p0_12/p0_14/p0_15 の5画面で繰り返し参照される。cycle 単位の小さな状態モデル(または ResidualMedication 拡張)を共通バックエンド課題として先行着手すべき
- 加工バッジの状態色がデザインで固定(一包化=青、別包=青、粉砕=紫、分包なし=橙、中止・回収=赤)だが、現実装は画面ごとに emerald/amber/red 等バラバラ(prescription-intake-form / prescription-history-content / audit-detail で各自定義)。バッジ色トークン+ラベルの共通コンポーネント化が必要
- prisma/seed.ts は org/site/user/患者/ケース/医療機関/車両/PCA ポンプまでしか作らず、調剤フロー(MedicationCycle/PrescriptionIntake/DispenseTask/DispenseResult/SetPlan/SetBatch)のデモデータが無い。p0_11〜p0_15 の撮影とマスターディテール初期選択に必須のため、調剤フロー一式のデモ seed 拡張が全画面共通の前提作業
- 「問題なし・次へ」(p0_13)型の連続処理 UX はキュー順次遷移ロジックとして p0_13/p0_15 で共通化できる(現実装は承認後に一覧へ戻る)
- 監査チェックリストのチェック状態が現状どこにも保存されない(p0_13 の6項目、p0_15 の6項目)。3省2ガイドラインの監査証跡(Audit by Default)観点で、チェック内容を DispenseAudit/SetAudit に保存するかは早期の設計判断が必要
- セット写真(p0_15)と「写真が足りない」差戻し理由(p0_13)が示すとおり、調剤フローの証跡写真は files の purpose 拡張(set-photo 等)+対象モデルへの関連付けが必要。p0_33(証跡写真管理)とモデル設計を揃えるべき
- WorkspaceActionRail(右パネル3点セット)が schedules/visits 系9画面のどこにも組み込まれていない。P0-19(次にやること)、P0-20(影響確認)、P0-21(守る条件)、P0-24(次にやること)は同じ右カラム構造なので、NextActionPanel+BlockedReasonsPanel+children(チェックリスト)で先に共通組込みパターンを確立してから各画面に展開するのが効率的。
- 状態色の統一が必要: デザインは 青=正式決定/待ち、緑=患者確認済・完了、紫=施設まとめ訪問、橙=事務タスク・要再確認・未同期、赤=緊急・重大。既存 statusBadgeClass(day-view.shared.ts)は emerald/amber/rose/slate 系 badge のみで、ガントバー塗り(bg)用のトークンが無い。共通の状態色ヘルパー(バー/バッジ/チップ兼用)を新設すべき。
- 複数ルート案比較(P0-20 案1/案2、P0-21 候補1/候補2、P1-12 ルート案比較)は /api/visit-routes の複数シナリオ対応(locked schedule_ids 等の制約パラメータ+候補配列返却)という共通バックエンド課題に集約される。先に API を拡張すると3画面分が解ける。
- prisma/seed.ts は visit_schedules・proposals・facility・facility_visit_batch を一切作成しないため、9画面すべての撮影に共通のデモ seed 整備が前提になる(座標付き住所、施設+部屋番号 unit_name、当日確定予定(各状態)、未確定候補3件、緊急候補、事務 ScheduleTask、車両2台)。design-fidelity 撮影専用の seed 拡張を1本にまとめるのが良い。
- P0-22/23 の訪問ステップ10段は、既存 SoapStepWizard(SOAP 4段)の置換ではなく上位の「訪問ステップシェル」を新設し、既存の構造化セクション(訪問前確認/残薬/写真/受領/次回提案)を各ステップに割り付ける構成が現実的。SOAP 自由文は『5.服薬・副作用』『9.報告の種』に内包させる設計判断が要る。
- 写真の項目別同期状態(未同期/済)は IndexedDB 写真キューの新設が必要で、P0-22/23/24 のほか p0_33(証跡写真管理)・p0_34(オフライン同期センター)にも波及する共通基盤。先行して lib 層(dexie)に visit-photo-queue を切るべき。
- 文言ルールの揺れ: 既存実装は「今やること」(proposal-human-decision-flow)、「次の操作」(proposals)、「最適順を route_order に反映」(内部用語露出)など。「次にやること」への統一と、route_order 等の内部語を「このルートを使う」系のやさしい文言へ置換する一括見直しが必要。
- P0-19/P0-20 は docs/design-fidelity-mapping.md 上「改修」分類だが、該当ビュー自体が存在しないため実態は新規ビュー(+調整案生成 API 新設)。工数見積り時は新規扱いを推奨。
- P0-16 のガント転置(行=スタッフ・横軸=時間)は既存 ScheduleDayGanttViewModel(行=時間)と互換が無く作り直しに近い。一方データ整形(window/columns)は流用可能なので helpers の拡張として実装し、既存「タブレット日次ガント」との置換可否(両立 or 削除)の設計判断が要る。
- 事務員をスケジュール画面の第一級アクターにする(P0-16 の事務行・P0-17 の「事務員が患者さんへ確認」)には、clerk を含むスタッフ一覧 API と ScheduleTask への時間帯付与という小さなスキーマ/API 拡張が共通で必要。
- phos 二重実装の設計判断が最優先: P0-25/27/28/29 のデザイン概念(事務サポート、薬剤師に相談/事務へ戻す、報告書作成、返信待ち対応)は src/phos/ui と src/phos/contracts(HandoffStatus、PhosSupportBriefCopy、PhosHandoffPanelCopy、PhosReportComposerCopy)に文言・型契約込みで既に存在するが、すべて /api/phos プロキシ経由で外部 PHOS_API_BASE_URL 依存(src/app/api/phos/[...path]/route.ts)。ローカル DB 実装(handoff-board/care-reports/communication-requests)へ寄せるか phos バックエンドを立てるかを先に決めないと 4 画面の実装方針が定まらない。文言は phos_copy.ja.ts を SSOT として再利用すると文言ルール(事務へ戻す等)に自然に揃う。
- マスター・ディテール 2〜3 ペイン(左: カードリスト+状態バッジ、中央: 詳細、右: アクション)が P0-26/27/29/30/31 の 5 画面で共通。共通レイアウト部品(選択状態管理+左カードリスト+右 WorkspaceActionRail のスロット構成)を最初に作ると後続が S〜M に縮む。
- WorkspaceActionRail の拡張が共通課題: デザインの右パネルは「主操作(青)1 つ+副操作(緑/outline)+メモ入力」の縦並び(P0-27/30/31)だが、現行 NextActionPanel は単一ボタンのみ。secondaryActions(variant 指定可)と children へのフォーム埋め込みパターンを 1 回拡張すれば 3 画面で再利用できる。
- 状態別件数サマリの API 形式統一: P0-25 の集計バッジ行、P0-27 の状態カード、P0-30 の候補状態は全て「状態×件数」。billing-candidates が既に GET レスポンスへ summary を同梱する形を取っているので、handoff・事務サポート集計も同じ形(data+summary)に揃えると UI 実装が均一になる。
- 撮影用 seed の不足が 7 画面共通の前提課題: prisma/seed.ts(784 行)には handoff 相談の状態バリエーション、sent/期限切れ間際の communication-requests、状態別 billing-candidates、残薬 3 剤、下書き報告書が無い。デザイン PNG の人名(田中一郎/佐藤花子/鈴木次郎/高橋美代子)と件数に合わせたデモ seed を一括整備するタスクを先行させるべき。
- 事務ロール・モードバッジ連動の横断確認: P0-25/26 はヘッダーのモードバッジが「事務サポート」、ユーザー肩書が「事務員」。シェルは実装済みだが、事務ロールでのモードバッジ切替と、集計対象 API の権限(canVisit 前提の residual-medications 等に事務がアクセスできるか)の確認が必要。
- P0-30 と P0-31 は接続している(P0-30 左リストの「残薬調整=証跡不足」と中央の「必要な証跡: 残薬写真が未添付」は P0-31 の「残薬写真を追加」で解消される)。残薬調整の確定・写真添付を billing-evidence に流す連携を両画面セットで設計すると齟齬が出ない。
- design-screen-map.ts の更新が必要なのは p0_30(/billing → /billing/candidates 系へ変更推奨)と p0_31(route: null → 新規ルート登録)。p0_25〜29 は登録済みルートのままで撮影可能だが、p0_26/27/29 は「1 件選択して詳細ペインを開く」setup 関数の追加が要る。
- P0-36/P0-37 は同一モーダル部品(チップ型理由選択+任意メモ+戻る/保存する)で実装すべき。ただし既存の理由コードが3系統バラバラ(DispenseAudit.reject_reason_code、SetAudit.reject_reason テキスト連結、VisitScheduleProposal.reject_reason)で、デザイン語彙(数量が違う/中止薬が残っている/写真が足りない/患者都合/入力間違い/その他)とも全て不一致。共通 enum と画面別差し替えオプションの設計判断を実装前に確定する必要がある。理由テキストは監査ログ redact 対象(src/lib/audit-logs/redaction.ts)という既存方針も新部品で踏襲すること。
- オフライン系(P0-34/P0-35)は src/lib/stores/sync-engine.ts と offline-store.ts が完成度高く(暗号化キュー、409 競合スナップショット、上書き/破棄、楽観ロック)、UI の新設だけで到達可能。専用ルート /offline-sync を1つ作り競合解消をその配下に置く構成が自然。既存 day-view 内の ScheduleDayOfflinePanel/SyncConflictCard と二重実装にならないよう、新ページへ移設または共通化する方針を決める。
- P0-34/P0-35 の撮影と E2E には「IndexedDB(PH-OSOffline)へ暗号化 payload 入りの syncQueue アイテムを注入する Playwright ヘルパー」が共通で必要。ENCRYPTION_KEY 依存のため tools/tests/helpers に専用 seed を用意するのが良い。
- P0-02/P0-03 はログイン後フロー(login → 薬局選択 → モード選択 → 開始画面)の新設で、セッションの siteId 反映と app-header モードバッジ連動がシェル全体へ波及する。auth-store/ui-store の状態設計と middleware リダイレクト方針を最初に固めること。デザインの「種類」列・モード色(事務=紫)は既存の状態色規約(緑/橙/青/赤/灰)に無い色のため docs/ui-ux-design-guidelines.md との整合判断が要る。
- design-screen-map.ts は p0_32 を route '/issues' として登録済みだが、src/app/(dashboard)/issues/ は空ディレクトリで実際は 404。撮影パイプラインの信頼性のため、ページ実装まで route: null に戻すか先にページの骨組みを置くべき。
- チップ型単一選択(選択中=青ハイライト)は P0-36/37 の理由選択と P0-33 の証跡種類リスト、P0-32 の課題カード選択で共通パターン。小さな共通部品(例: SelectableChipGroup)に切り出すと忠実度と工数の両方で得。
- P0-33(証跡写真)はバックエンド拡張(証跡カテゴリ、一覧 API、オフライン写真キュー)が最も重く、P0-34 のテーブルに「写真」「一時保存」行が載る前提でもあるため、P0-33 のデータ設計 → P0-34/35 の UI という依存順で進めるのが安全。
- p0_39〜p0_43 の 5 画面は完全に同一の 3 カラム「マスター管理ハブ」テンプレート(左: カテゴリナビ(薬剤/医療機関/施設/スタッフ/車両/タグ/帳票)、中央: 名称+「有効」緑バッジの一覧カード、右: 詳細を編集(名称/コード/分類/注意ポイント/表示するタグ/メモ)+ 青「保存する」)。共通部品(例: src/components/features/admin/master-hub-shell.tsx)を 1 つ実装して 5 カテゴリで再利用するのが最効率。カテゴリごとのデータアダプタ(fetch/save/フィールドマッピング)だけ差し替える設計を推奨
- デザインのカテゴリ「タグ」「帳票」はモデル・API とも未実装。タグはマスタ横断の表示タグ(危険タグとは別)として新規設計が必要で、帳票カテゴリは p0_47 印刷ハブのテンプレート管理(既存 /admin/document-templates が近い)と統合するか設計判断が要る
- 「有効」緑バッジに対応する有効/無効フラグがモデル間で不揃い: VisitVehicleResource.available は有り、ExternalProfessional は無し、Facility/Pharmacist は要確認。マスター共通のソフト無効化(active フラグ + 無効化時の確認ダイアログ + AuditLog)を横断で揃える設計判断が必要
- デザインの「詳細を編集」6 フィールドは抽象化されており、既存マスタの実フィールド(施設の住所・担当者、スタッフのロール・サイト等)より大幅に少ない。共通フォームは概要編集に留めて詳細編集は既存 Sheet へ誘導する 2 段構えが現実的(完全置換すると既存機能を失う)
- 右パネル 3 点セット(WorkspaceActionRail)はマスタ・設定系 7 画面(p0_39〜44, p0_47)では不要(3 カラム目が編集フォーム/出力設定のため)。組込対象はワークフロー系のみ: p0_38 は組込済み(patient-workspace-rail.tsx)だがデザイン上は右カラム=「これまでの流れ」タイムラインであり置き換え判断が必要。p0_45 の「今すぐ見るべきこと」は BlockedReasonsPanel(赤/橙)の意味論と一致するため文言を合わせて流用できる(データ源は CapacityResponse.bottlenecks)
- p0_45 の正ルートは /admin/metrics(経営指標で別物)ではなく (phos) ルートグループの /capacity。CapacityDashboard は外部 API Gateway(PHOS_API_BASE_URL、/api/phos プロキシ経由)依存のため、Playwright 撮影・ローカル開発にはスタブ注入(CapacityDashboardClient の initialCapacity prop が既にある)を使う運用決定が必要。design-screen-map.ts の route 差し替えも忘れずに
- p0_48 のオフライン写真キュー(IndexedDB 暗号化保存 → 復帰時自動送信)は p0_34 オフライン同期センター・p0_33 証跡写真管理と同一基盤。dexie + lib/offline/crypto を使う共通の「オフライン送信キュー」モジュールを先に設計しないと 3 画面で実装が分裂するリスクがある
- 新規ルートが必要な画面の design-screen-map.ts 更新: p0_43(車両管理画面)、p0_47(印刷ハブ)、p0_48(モバイル撮影、MOBILE_VIEWPORT)は実装後に route 登録。p0_38 は患者詳細の動的 ID 解決 setup(seed 患者の ID を API で引く)を追加。p0_44 は /settings を薬局設定構成へ再編するか /admin/settings と統合するかで撮影ルートが変わる
- QR コード生成(p0_47)は既存 @zxing(読取り専用)では不可。生成ライブラリ追加は CLAUDE.md のバージョン固定方針(2026-03-25 pinned)に関わるため、依存追加の承認プロセスを通すこと
- 印刷・写真撮影はいずれも PHI の出力/取得操作。3省2ガイドライン(Audit by Default)の観点で、印刷実行・写真アップロードの AuditLog 記録が現状確認できないため、p0_47/p0_48 実装時に監査記録を仕様に含めるべき
- 宛先タイプ(医師/ケアマネ/訪問看護/施設/家族)が p1_04(宛先別プレビュー)と p1_05(共有する相手)で共通概念。src/phos/contracts/phos_copy.ja.ts の PhosReportComposerTemplateLabel に既に 5 区分があるため、宛先 enum + 日本語ラベルを共通部品化してから両画面に着手すべき
- p1_02 / p1_03 の「次にやること」「止まっている理由」はモーダル/右レールではなくカード内・カラム内のインライン表示。action-rail.tsx の RailCard(現在非公開)をエクスポートしてインライン再利用できるようにする設計判断が要る
- AI レビュー系 2 画面(p1_03 訪問前まとめ、p1_04 報告書下書き)は「AI/ルール生成 → 薬剤師確認(承認/修正/不使用) → 確定」の同型フロー。確認状態のデータモデルと AuditLog 記録(医療判断の証跡)を共通設計にすると二重実装を避けられる
- 配色のガイドライン衝突が 2 件: p1_06 のグラフ多色バー(ブルー基調原則と衝突)と p1_04 の緑「薬剤師確認済みにする」(主操作青 1 つ原則と衝突。承認=緑のセマンティクスとも読める)。実装前にデザイン PNG 踏襲かガイドライン優先かの判断が必要
- p1_01 デザイン内の文言「ブロッカーあり」(管理者用カード)は文言ルールにより実装時は「止まっている理由あり」へ置換する
- チャートは recharts@3.8.1 導入済みで、src/phos/ui/capacity/CapacityDashboard.tsx に Bar チャートの実装例(工程別作業分数)が既にある。p1_06 はこのパターンを踏襲すれば新規依存なし
- サイドバーの情報設計: p1_06(`/admin/operations-insights`)・p1_07(`/admin/inventory-forecast`)は管理シェルの「分析・監視」グループ(`navigation-config.ts` の `SIDEBAR_ADMIN_NAV_GROUPS`)に登録済み。デザインPNGの「レポート」アクティブ表示はメインの14項目サイドバー(`SIDEBAR_MAIN_NAV_GROUPS`)が `navigation-config.test.ts` で凍結されており独立レポート項目を持たないため、`/admin` 配下=「マスター」項目のアクティブ範囲で到達する設計。p1_01(保存ビュー)のメニュー位置のみ未確定
- 保存ビュー(p1_01)はサーバー保存モデルが全く無い一方、URL クエリでフィルタ状態を持ち回るパターン(workflow-query-state.ts / reports-query-state.ts / schedule-proposals の ?preset=)が複数画面で確立済み。保存ビューの criteria は既存 URL クエリ規約をそのまま JSON 化する設計にすると各一覧画面への適用が容易
- src/app/(dashboard)/issues が空ディレクトリで /issues は 404。design-screen-map.ts では p0_32 が route '/issues' にマップされており撮影が失敗するはず。p1_09(ヒヤリハット)実装時に正ルート(/incidents 等)を決め、p0_32 のマッピングと併せて更新すべき
- p1_08(OK/不足/確認中)と p1_14(強く表示/標準)で「項目名+状態チップの行リスト」UI が共通。設定/チェックリスト向けの共通部品(StatusToggleRow 的なもの)に切り出す候補
- 管理画面系(templates / alert-rules)が JSON textarea 直編集に依存。デザインは全て構造化 UI(チップ挿入/トグル/プレーン文面)であり、既存 JSON 編集の退避先(詳細設定タブ・上級者モード等)の設計判断が必要
- p1_11 の転写はサーバ側なら Amazon Transcribe(ISMAP 対象・ap-northeast-1)等の外部依存が必須になる。回避するなら既存 Web Speech API のクライアント転写流用だが精度・自動化に制約 — P1 で最大の外部依存判断ポイント
- presence / comments の permission が canDispense 固定。デザイン(P1-13)には事務ロールが登場するため、事務を含むロールへの権限緩和を collaboration 系 API 全体で整理する必要がある
- prisma/seed.ts には FacilityStandardRegistration / Template / DrugAlertRule / MedicationIssue / VisitSchedule(座標付き)が無く、P1 後半画面の撮影には demo seed の拡充がほぼ全画面で前提になる
- 主操作1つ強調ルールへの統一: 既存管理画面は登録/テスト/編集/削除ボタンが同列。デザイン準拠には「保存する」だけ default variant(青)、他は outline/ghost へ落とす横断リファクタが必要
- DrugAlertRule に org_id が無い(グローバル定義)。p1_14 をテナント別チューニング画面にするならスキーマ変更(org_id 追加 or org 別設定モデル)が必要で、RLS 方針にも関わる設計判断

## バックエンド横断調査(7 領域)

### 1. オフライン同期 API(p0_34 未同期の確認 / p0_35 競合解消)

- 現状: クライアント側は完成度が高い。Dexie DB『PH-OSOffline』v6 に visitDrafts / residualDrafts / syncQueue / visitBriefCache / prescriptionDrafts の 5 テーブル。syncQueue は { entityType: 'visit_record'|'residual_medication', payload(AES-GCM 暗号化 JSON), scope_id, retryCount, lastError, conflict_state('server_conflict'), conflict_payload(暗号化) }。sync-engine.ts は processSyncQueue(POST /api/visit-records 等へ x-org-id 付きで再送、MAX_RETRIES=3)、listSyncQueueItems(復号サマリ)、registerVisitRecordConflict、overwriteVisitRecordConflict(conflict_resolution='overwrite' + existing_record_id + expected_version を付けて再 POST)、discardSyncQueueItem、setupAutoSync(online イベント)を提供。サーバー側の楽観ロックは If-Match ヘッダではなくボディフィールド方式: POST /api/visit-records は既存記録があると 409 で details.existing_record(id/version/SOAP/残薬)を返し、上書き時は expected_version === existing.version を検証して version: {increment:1}。PATCH /api/visit-records/[id] も body の version で楽観ロック実装済み(L228-345)。VisitRecord / VisitSchedule に version Int @default(1) あり。If-Match/ETag は全コードで未使用。既存 UI は schedules/day-view.tsx + schedule-day-offline-panel.tsx(同期・競合の上書き/破棄)と visit-record-form.tsx に分散実装済み。
- ギャップ:
  - p0_34 の専用ページ(未同期一覧 / 全件再試行)が無い。既存はスケジュール日次ビュー内のパネルのみで、種類/患者/状態/次にやることのテーブル表示が無い
  - 『すべて再試行』に必要な retryCount リセット(再キュー)関数が sync-engine に無い。retryCount>=3 の項目は processSyncQueue で恒久スキップされ、上書き/破棄しか出口が無い
  - p0_34 に登場する『写真』行が表現不能。syncQueue の entityType は visit_record / residual_medication のみで、S3 presigned アップロード(visit-photo)はオフラインキューイング非対応。『必須の写真が未同期だと訪問完了にできません』のガードも無い
  - p0_35 の競合 diff はフィールド全量でなく outcome_status / soap_plan 程度に限定。残薬・SOAP 全項目の左右比較ビューが薄い
  - 患者名表示: syncQueue は patient_id しか持たず患者名解決(オフライン時は visitBriefCache から)が未整備
  - サーバー側にデバイス横断の未同期可視化は無い(必要性自体が低い、後述)
- 提案: 方針: 同期キューは PHI 最小化の観点でクライアント(Dexie)管理を維持し、サーバー側に『同期キュー一覧/再送 API』は新設しない(キュー実体が端末内のため不可能であり不要)。実装は (a) 新ページ /sync(p0_34)を listSyncQueueItems + visitBriefCache で構築、(b) sync-engine に requeueSyncQueueItems(ids?: number[])(retryCount=0, conflict_state クリア)を追加して『すべて再試行』を実現、(c) syncQueue v7 マイグレーションで entityType に 'visit_photo' を追加し、撮影画像を Dexie(Blob/ArrayBuffer 暗号化)に保持→オンライン復帰時に POST /api/files/presigned-upload → S3 PUT → POST /api/files/complete を順次実行。訪問完了 API(POST /api/visit-records)側に required photo 未同期ガードを置く場合は client 側バリデーションで足りる(サーバーは attachments Json で検証可)。(d) 楽観ロックは既存の body version / expected_version 方式に統一(If-Match 新規導入はせず、409 レスポンス形 { error, details: { existing_record } } を visit-records 以外(residual 等)にも標準化)。(e) p0_35 は /sync/conflicts/[queueId] で conflict_payload の local/server を全フィールド比較、『最新を使う(破棄)』=discardSyncQueueItem、『自分の内容で上書き』=overwriteVisitRecordConflict を流用。認可: 既存 API のみ使用のため新規認可不要。監査: 上書き解決は既存 POST /api/visit-records 内のトランザクションに tx.auditLog.create({action:'visit_record_conflict_overwritten', target_type:'VisitRecord'}) を追加することを推奨(現状は上書きの監査明示なし)。RLS: 既存 withOrgContext のまま。

### 2. サイト(薬局)切替(p0_02 薬局を選ぶ)

- 現状: org 概念はセッションに統合済み: NextAuth JWT に userId/orgId/sessionVersion を格納(config.ts jwt/session callback)、requireAuthContext は x-org-id ヘッダで org 切替を許容し Membership(user_id, org_id, is_active)を検証、org 切替時は logSecurityEvent('org_switch') で AuditLog に記録済み。一方 site は薄い: Membership.site_id は nullable(@@unique([user_id, org_id, site_id]))、User.default_site_id があり、(dashboard)/layout.tsx が default_site_id を AppProvider 経由で zustand useAuthStore({orgId, siteId, setSite}) に注入。GET /api/me/profile は defaultSiteId / currentSiteName(先頭 membership の site 名)を返すが PATCH は name/phone のみ。GET /api/pharmacy-sites(canVisit)は org の全サイト一覧(+view=resource_map 集計)。AuthContext に siteId は無く、各 API は個別に site_id クエリ/ボディで受ける設計(20+ ルート)。
- ギャップ:
  - 現在サイトを切り替える API が存在しない(User.default_site_id を更新する手段が UI/API とも無い)
  - p0_02 のカード表示に必要な『所属しているサイトのみ + 本日訪問件数 + 在宅あり』のスイッチャー用 projection が無い(GET /api/pharmacy-sites は org 全サイトを返し membership で絞らない)
  - サイト切替の監査ログが無い(org_switch 相当の site_switch イベント未定義)
  - セッション/AuthContext に siteId が無く、サーバー側でリクエストの『現在サイト』を一貫して解決できない
- 提案: 新規 API: (1) GET /api/me/sites — withAuthContext(permission 不要、ログイン必須)。Membership(user_id=ctx.userId, org_id=ctx.orgId, is_active)から site を解決(site_id=null の membership は全サイトアクセスとして org の全サイト返却)。各 site に { id, name, todays_visit_count(visitSchedule where site_id, scheduled_date=today, status not cancelled), has_home_visit(boolean), is_current } を付与し p0_02 のカードを充足。(2) PUT /api/me/site — body { site_id: string } を zod 検証 → pharmacySite.findFirst({id, org_id: ctx.orgId}) と membership(site_id一致 or null)を検証 → prisma.user.update({ default_site_id }) → tx.auditLog.create({ action: 'user_site_switched', target_type: 'PharmacySite', target_id: site_id, changes: { from_site, to_site } , ip_address, user_agent}) を withOrgContext 内で実施。加えて logSecurityEvent に 'site_switch' イベント種別を追加(org_switch と対称)。クライアントは成功後 useAuthStore.setSite + router.refresh()(layout.tsx が default_site_id を再読込)。将来的にサーバー側サイトスコープが必要になれば requireAuthContext に x-site-id ヘッダ解決(membership 検証付き)を追加し AuthContext.siteId を拡張するが、第一段は default_site_id 永続化方式で十分。RLS: site はテナント境界でないため RLS 変更不要(org_id 境界のまま)。認可: 自分自身の切替のみ(他ユーザー変更は admin/users 系に委ねる)。

### 3. 表示モード/ロール選択(p0_03 使い方を選ぶ)

- 現状: app-header.tsx のモードバッジは『在宅モード』のハードコード(data-testid='app-header-mode-badge')。ui-store.ts(zustand persist 'ph-os-ui' → localStorage)は sidebar/theme/検索等のみでモード概念なし。サーバー側 Setting モデルは scope='user' をサポートするが、/api/settings は GET/PATCH とも permission:'canAdmin' でゲートされ、かつ SETTING_CATALOG に定義済みキーしか受け付けないため、一般ユーザーの個人設定保存には使えない。p0_03 の 薬剤師/事務サポート/管理 の 3 モードは UI の入口選択であり、サーバーロール(MemberRole: owner/admin/pharmacist/pharmacist_trainee/clerk/driver/external_viewer + permissions.ts のマトリクス)とは別物。
- ギャップ:
  - workMode(薬剤師/事務サポート/管理)と careMode(在宅/外来)の保持先が無い
  - app-header のモードバッジがストア非連動(常に在宅モード)
  - 一般ユーザーが自分の UI 設定を保存できるサーバーサイドの口が無い(端末跨ぎで復元不可)
  - 管理モードカードは canViewDashboard/canAdmin 等の権限と表示整合を取る必要がある(モード選択は権限を付与してはならない)
- 提案: 二層方式を提案。第一層(必須・小工数): ui-store.ts に workMode: 'pharmacist'|'clerk_support'|'management' と careMode: 'home_visit'|'outpatient' を追加し partialize で localStorage 永続化。app-header.tsx はバッジを careMode 連動(在宅モード=emerald / 外来モード=blue 等)にし、p0_03 ページ(/mode-select 等)はカード選択で setWorkMode→該当ダッシュボードへ遷移。管理モードカードは hasPermission(role,'canAdmin') が無ければ非表示/無効化(モードはナビゲーションのフィルタのみで、API 認可は従来どおり role ベース)。第二層(端末跨ぎ永続化): GET/PATCH /api/me/preferences を新設 — withAuthContext(permission 指定なし=ログインのみ)、Setting { scope:'user', scope_id: ctx.userId, key:'ui_preferences', value: { work_mode, care_mode, start_page } } を upsert。scope_id は常に ctx.userId 固定(他人の設定は触れない)ため canAdmin 不要で安全。zod で enum 検証。監査: 非 PHI の UI 設定のため AuditLog は必須でないが、書く場合は action:'user_preferences_updated' で値は changes に含めて良い(機微情報なし)。RLS: Setting は org 列を持たない共有テーブルのため現行どおり(scope/scope_id で分離)。

### 4. 保存ビュー API(p1_01 よく使う絞り込み)

- 現状: ユーザー別フィルタ保存の機構は存在しない。類似機構: (a) patient-list-store.ts が favorite/recent 患者 ID を localStorage 保存、(b) Setting(scope='user')はあるが /api/settings は canAdmin ゲート + カタログ外キー拒否、(c) prisma の 'Preference' は PatientSchedulePreference(患者の訪問希望)のみで無関係。一覧 API(/api/patients 等)は zod スキーマ(patientListQuerySchema)でクエリパラメータ受領しており、保存対象のフィルタ条件はシリアライズ可能。
- ギャップ:
  - SavedView に相当する Prisma モデルが無い
  - 保存・呼び出し・並び替え・共有(事務で確認/管理者用 などロール横断プリセット)の API が無い
  - p1_01 の『今の絞り込み条件を保存』に必要な、ページ別フィルタのシリアライズ規約が未定義
- 提案: 新規 Prisma モデル(admin.prisma に追加): model SavedView { id String @id @default(cuid()); org_id String; user_id String; page_key String; name String; description String?; filters Json; sort Json?; is_shared Boolean @default(false); display_order Int @default(0); created_at DateTime @default(now()); updated_at DateTime @updatedAt; @@unique([org_id, user_id, page_key, name]); @@index([org_id, user_id]); @@index([org_id, page_key]) }。page_key は 'patients'|'schedules'|'workflow'|'medication-sets' 等の enum 的文字列を zod で制限。API: GET /api/saved-views?page_key=… (自分の view + is_shared=true の org 共有 view を返却)、POST /api/saved-views(name/filters/sort/page_key、上限 30 件/ユーザー/ページ、filters は JSON サイズ上限 4KB を zod + superRefine で検証)、PATCH・DELETE /api/saved-views/[id](所有者のみ。is_shared の作成/変更は permission:'canAdmin' を要求し、共有プリセットを管理者管理にする)。認可: withAuthContext(追加 permission なし=全ログインユーザー、各クエリで user_id=ctx.userId or is_shared)。RLS: org_id 列を持たせ既存 RLS ポリシー命名規約に合わせてポリシー追加、書き込みは withOrgContext(ctx.orgId, tx => …) 内で実行。監査: tx.auditLog.create({ action: 'saved_view_created'|'saved_view_updated'|'saved_view_deleted', target_type: 'SavedView', target_id, changes: { name, page_key } })(filters は検索条件であり PHI 本体でないが、念のため患者名等の自由文字列を changes に展開しない)。レート制限: src/lib/api/rate-limit.ts のパス一覧に '/api/saved-views' '/api/saved-views/:id' を登録。

### 5. 認可・監査の横断状態(新規 API の標準形)

- 現状: requireRole という関数は存在しない。認可は permission キー方式: permissions.ts の ROLE_PERMISSIONS(canDispense/canAuditDispense/canSet/canAuditSet/canVisit/canReport/canSendCareReport/canManageBilling/canViewDashboard/canAdmin)を hasPermission(role, key) で判定。src/app/api の route.ts は withAuthContext(handler,{permission})(context.ts、(req, ctx, routeContext) シグネチャ)または明示的な requireAuthContext / requireApiKeyOrAuthContext に移行済みで、`rg "withAuth\\(" src/app/api -g route.ts` は 0 件。いずれも requireAuthContext に集約: session 解決 → session_version 検証 → x-org-id による org 上書き(org_switch を AuditLog へ)→ Membership 検証 → permission 検証。失敗は logSecurityEvent が AuditLog(action 'security:auth_failure' 等、org_id='system'/actor='anonymous' フォールバック、60 秒デデュープ)へ fire-and-forget 書き込み。業務監査は createAuditLogEntry へ移行済みの API route では org_id/actor_id/ip_address/user_agent を一貫して受け渡し、`rg "auditLog\\.create" src/app/api -g route.ts` は 0 件。src/server 以下にはサービス境界の raw audit writes が残る。RLS は withOrgContext(rls.ts)が SET LOCAL app.current_org_id/actor_id/member_role/ip/user_agent を設定し、アプリ層 where org_id との二重防御。読み取りは /api/audit-logs(redactAuditLogsForResponse で changes をマスキング、page/limit 上限)。API キー併用は requireApiKeyOrAuthContext。レスポンスは success/validationError/notFound/forbiddenResponse ヘルパー、ボディは readJsonObjectRequestBody + zod。
- ギャップ:
  - 旧 withAuth の API route 復帰を CI で検出する静的検査が必要
  - raw auditLog.create の API route 復帰を CI で検出する静的検査が必要
  - site 単位の認可スコープは AuthContext に無い(area 2 参照)。permission キーにも site 概念なし
- 提案: 本調査で提案する新規 API はすべて次の標準形に従う: (1) export const GET/POST/PATCH = withAuthContext(handler, { permission: <PermissionKey>, message: '…権限がありません' })。自分自身のリソース(me 系/saved-views)は permission 省略しハンドラ内で user*id=ctx.userId 制約。(2) 入力は readJsonObjectRequestBody + zod safeParse → validationError(parsed.error.flatten().fieldErrors)。(3) 書き込みは withOrgContext(ctx.orgId, async (tx) => { …mutation…; await createAuditLogEntry(tx, ctx, { action: '<entity>*<verb>', targetType: '<PrismaModel>', targetId, changes }); }) で監査と同一トランザクション化。(4) 読み取りも where { org_id: ctx.orgId } を必ず付与(RLS と二重防御)。(5) 新パスは src/lib/api/rate-limit.ts に登録。(6) 新モデルは org_id 列 + @@index([org_id]) + RLS ポリシー(prisma/migrations の既存ポリシー命名に追従)。

### 6. workflow-exceptions projection(右パネル『止まっている理由』)

- 現状: /api/workflow-exceptions は [id] の GET/PATCH のみ(canDispense)。PATCH は解決時に open 例外残数 0 で medicationCycle.exception_status をクリアし cycleTransitionLog を記録。一覧 GET(コレクション)は存在しない。WorkflowException モデルは nullable patient_id が追加済みで、作成箇所の一部は患者へ直接紐付く。画面向け projection は /api/dashboard/workflow 一本に集約: workflow-dashboard-queries.ts が open 例外 count + 先頭 6 件(cycle→case→patient 連結、assignmentScope で担当絞り込み)を取得し、workflow-dashboard-sections.ts が workflow_exceptions {open, items} / exception_command_center / billing_prevention.previsit_blockers に整形(serverCache TTL あり)。billing-evidence サービスの blocker projection は別系統: describeBillingEvidenceBlockers / blockerDefinition(core.ts L823-947)が missing_visit_consent / missing_management_plan / report_delivery_incomplete 等のキー付き理由(severity, action_href/label 付き)を『計算で』導出するもので、永続化された WorkflowException(調剤監査差戻し等のサイクル事象)とはデータ源が異なる。listBillingEvidenceBlockers は visit-records POST の算定 readiness 検査や /api/billing-evidence/stats・analytics で利用。
- ギャップ:
  - GET /api/workflow-exceptions(一覧)が無く、患者別・工程別のフィルタ/グルーピング projection が存在しない
  - 右パネル『止まっている理由』に必要な、WorkflowException(永続事象)+ billing blockers(計算値)を患者単位で合成した統合ビューが無い
  - WorkflowException.patient_id は nullable 追加済みだが、既存行 backfill と一覧 projection での直接利用が未完
  - dashboard/workflow は先頭 6 件のみでページングなし。例外の全量確認画面を支えられない
- 提案: 新規 API: (1) GET /api/workflow-exceptions — withAuthContext(permission:'canViewDashboard'。解決操作 PATCH は既存どおり canDispense)。クエリ: status(default 'open')/severity/exception*type/patient_id/cycle_id/limit+cursor(keyset)。include で patient と cycle { overall_status, case* { patient { id, name } } } を返し、resolveDashboardAssignmentScope + buildCycleRelationScope を流用して非管理者の担当スコープ絞り込みをダッシュボードと一致させる。(2) 同ルートに group_by=exception_type|process|patient のサマリモードを追加(\_count 集計を返すのみ)。process 軸は exception_type→工程(調剤/監査/セット/訪問/報告)の静的マップを src/lib/constants に定義。(3) 患者右パネル用統合 projection: GET /api/patients/[id]/blockers — withAuthContext(canViewDashboard) で、(a) open WorkflowException(patient_id 優先、必要に応じ cycle 経由 fallback)、(b) listBillingEvidenceBlockers / describeBillingEvidenceBlockers の出力(key/reason/severity/action_href/action_label)、(c) report_delivery 滞留を 1 レスポンスに合成し、画面はこの 1 API で『止まっている理由』を描画。読み取り専用のため AuditLog 不要(患者単位アクセスは既存の閲覧監査方針に従う)。レスポンス整形は BillingEvidenceBlocker 型(key/reason/severity/action_href/action_label)へ WorkflowException も正規化し、フロントの型を一本化する。RLS: 既存 org_id where + RLS のまま。レート制限登録を忘れない。

### 7. ヒヤリハット(p1_09)/ 音声メモ・文字起こし(p1_11)

- 現状: ヒヤリハット: 専用モデルなし(prisma/schema 全体に incident/hiyari は 0 件)。最近接は MedicationIssue(患者の薬学的問題: adherence/side_effect/interaction 等。interventions/inquiries/tracing_reports 連携)だが、これは患者ケア上の問題管理であり内部インシデント報告(p1_09 の 起きたこと/原因/すぐ行った対応/次から変えること/関係する工程)とは別ドメイン。(dashboard)/issues ディレクトリは空。音声: voice/transcription モデルも 0 件。use-speech-recognition.ts + voice-soap-assist.tsx は Web Speech API によるリアルタイム口述入力(SOAP 各フィールドへ直接転記)のみで、音声ファイルの録音・保存・再生・サーバー文字起こしは無い。S3 基盤: src/server/services/file-storage.ts が presigned upload/download を提供するが purpose は 'prescription'|'visit-photo'|'report'|'bulk-export' の 4 種、MIME 許可は画像(jpeg/png/webp)+ PDF のみで audio/\* 不可。ファイルメタデータは専用モデルでなく Setting(scope='organization', key='file_asset:<id>') に JSON 保存。処方箋のみ Object Lock COMPLIANCE 5 年、SSE は AES256/aws:kms 切替・purpose 別 KMS キー対応。アクセス制御は purpose 別 assert(訪問記録の担当者スコープ等)実装済み。
- ギャップ:
  - IncidentReport(ヒヤリハット)モデル・CRUD API・一覧画面が皆無
  - 音声ファイルの purpose/MIME/サイズ規約が無く S3 にアップロードできない
  - VoiceMemo メタデータ(録音時間・対象訪問・文字起こし状態)の保持先が無い
  - サーバーサイド文字起こし(非同期ジョブ)の仕組みが無い(IntegrationJob はあるが STT ジョブ種別なし)
  - 『訪問記録へ入れる』(transcript を SOAP へ取込)の API 連携が無い
- 提案: p1_09: 新規モデル(admin.prisma または専用 incident.prisma): model IncidentReport { id String @id @default(cuid()); org_id String; site_id String?; reported_by String; patient_id String?; title String; what_happened String; cause String?; immediate_action String?; prevention_plan String?; related_process String? // intake/dispensing/audit/set/visit/report/billing; severity String @default("near_miss") // near_miss/level1/level2; status String @default("open") // open/reviewed/closed; occurred_at DateTime?; created_at/updated_at; @@index([org_id, status]); @@index([org_id, created_at]) }。API: GET+POST /api/incident-reports、GET+PATCH /api/incident-reports/[id]。認可: 作成は permission:'canViewDashboard'(clerk 含む全業務ロールが報告可能であるべき。driver/external_viewer は不可)、status 変更(reviewed/closed)は canAdmin。監査: tx.auditLog.create({action:'incident_report_created'|'incident_report_updated', target_type:'IncidentReport'})、changes には自由記述本文を入れず title/status/severity のみ。RLS: org_id + ポリシー追加、書込は withOrgContext。p1_11: (a) file-storage.ts に FilePurpose 'voice-memo' を追加 — MIME allowlist {audio/webm, audio/mp4, audio/mpeg}、上限 25MB、storage key voice-memos/{orgId}/{visitRecordId|scheduleId}/{fileId}-{name}、SSE は既存 PHI KMS キー、参照必須 ID は scheduleId or visitRecordId、アクセス assert は visit-photo と同じ assertVisitRecordFileAccess 系を流用。(b) 新規モデル model VoiceMemo { id, org_id, schedule_id?, visit_record_id?, patient_id?, file_id String, duration_seconds Int?, transcript_text String?, transcript_status String @default("none") // none/processing/done/failed, transcribed_at DateTime?, recorded_by String, created_at/updated_at, @@index([org_id, schedule_id]) }(file-storage の Setting 方式 JSON でなくモデル化を推奨: 一覧・検索・訪問記録連結が要件のため)。(c) API: POST /api/voice-memos(presigned-upload→complete 後にメタ登録)、GET /api/voice-memos?schedule_id=…、POST /api/voice-memos/[id]/transcribe — IntegrationJob(job_type:'voice_transcription')を enqueue し Amazon Transcribe(ja-JP, ap-northeast-1, ISMAP 整合)で非同期 STT、完了で transcript_text 更新。(d) POST /api/voice-memos/[id]/apply-to-record — transcript を visit record の structured_soap へ追記(既存 PATCH /api/visit-records/[id] の version 楽観ロックを通す)。認可: いずれも permission:'canVisit' + 訪問担当者スコープ(canAccessVisitScheduleAssignment)。監査: 'voice_memo_created' / 'voice_memo_transcribed' / 'voice_memo_applied_to_record'(transcript 本文は changes に含めない)。オフライン録音対応は Area 1 の syncQueue 拡張(entityType:'voice_memo')とセットで段階導入。

- design/manifest.json で対象画面を確認: p0_02_tenant_pharmacy_select / p0_03_mode_role_select / p0_34_offline_sync_center / p0_35_data_conflict_resolution / p1_01_saved_views_advanced_filter / p1_09_incident_hiyarihatto / p1_11_voice_memo_transcription。各画像を実際に読み取り、UI 要件(本日訪問件数、すべて再試行、再発防止メモ項目等)を提案に反映した。
- 横断的な実装順の推奨: (1) Area 5 の標準形を前提に Area 2 (PUT /api/me/site) と Area 3 (/api/me/preferences) — 小規模・モデル変更最小、(2) Area 4 SavedView と Area 6 GET /api/workflow-exceptions — 新モデル 1 + 読取系、(3) Area 7 IncidentReport/VoiceMemo — 新モデル 2 + S3/STT 連携で最大工数、(4) Area 1 はクライアント中心でサーバー変更ほぼ不要(写真キュー拡張のみ設計注意)。
- If-Match/ETag 楽観ロックは現コードベースに一切存在せず、body の version / expected_version 方式が既に visit-records POST/PATCH 両方で確立済み。新規 API も同方式へ統一するのが整合的。
- 認可は requireRole ではなく permission キー方式(hasPermission)。新規 API の認可指定はすべて PermissionKey で表現した(サイトスコープ認可は現状非対応のため、必要箇所のみ membership.site_id 検証をハンドラ内で行う)。
- ファイルメタデータが Setting(key='file_asset:\*') の JSON に保存されている点は技術的負債。VoiceMemo では同方式を踏襲せず Prisma モデル化を提案(一覧/検索/訪問記録 join が要件のため)。
- コードは一切変更していない(読み取り専用調査)。
