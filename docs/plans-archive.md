# PH-OS Pharmacy — 完了トラック アーカイブ

> `Plans.md` から完全完了（`cc:完了`）トラックを移設した履歴。
> 移設日: 2026-06-20。元ファイル: `Plans.md`。進行中/blocked/TODO トラックは Plans.md に残置。

---

## 直近トラック: 訪問支援・処方/調剤・共有要約 `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

> 最終更新: 2026-03-27 19:27 JST
> 目的: 薬局薬剤師の訪問薬剤管理指導に必要な「訪問前の要点」「処方履歴差分」「調剤方法」「多職種共有」を、患者詳細・訪問準備・外部共有で一貫して確認できる状態まで引き上げる。

### 直近で完了済みの範囲

- [x] 訪問支援ボード / 患者サマリー / 日次 task 同期 `cc:完了` (2026-03-27)
  - `src/server/services/home-care-ops.ts`
  - `src/server/jobs/daily.ts`
  - `src/app/(dashboard)/workflow/workflow-dashboard-content.tsx`
  - `src/app/(dashboard)/patients/[id]/patient-detail-tabs.tsx`
  - `src/app/(dashboard)/schedules/day-view.tsx`
- [x] visit-brief 集約サービス + AI短文化フォールバック `cc:完了` (2026-03-27)
  - `src/server/services/visit-brief.ts`
  - `src/server/services/visit-brief-ai.ts`
  - `src/types/visit-brief.ts`
  - `src/components/visit-brief/visit-brief-card.tsx`
- [x] 患者 API / 訪問準備 API / 専用 brief endpoint 整備 `cc:完了` (2026-03-27)
  - `src/app/api/patients/[id]/route.ts`
  - `src/app/api/patients/[id]/visit-brief/route.ts`
  - `src/app/api/visit-preparations/[scheduleId]/route.ts`
  - `src/app/api/visit-preparations/[scheduleId]/brief/route.ts`
- [x] 服薬管理画面の見やすい薬剤一覧 + サマリー `cc:完了` (2026-03-27)
  - `src/app/(dashboard)/patients/[id]/medications/medications-content.tsx`
  - `src/app/(dashboard)/patients/[id]/medications/page.tsx`
- [x] 処方履歴の差分ダッシュボード + 調剤方法ワンビュー `cc:完了` (2026-03-27)
  - `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx`
  - `src/app/(dashboard)/patients/[id]/prescriptions/page.tsx`
- [x] 外部共有ポータルの共有サマリー `cc:完了` (2026-03-27)
  - `src/server/services/external-access.ts`
  - `src/app/shared/[token]/shared-viewer-content.tsx`

### 残タスク一覧（優先度順）

- [x] VB-01: 多職種共有サマリーの送達管理 `cc:完了`
  - 目的: 「共有内容を作る」だけでなく、「誰に送ったか・確認されたか・返信待ちか」を追えるようにする。
  - 2026-03-27 進捗:
    - `communication-queue` を親サービスとして `visit-brief` / 患者詳細 / workflow / 訪問準備へ送達 timeline を接続
    - 未確認 / 返信待ち / 失敗 の内訳、緊急連絡ドラフト候補、共有タイムライン表示を追加
    - workflow に未確認 / 返信待ちの aggregate workbench を追加し、通信依頼画面から draft / sent / received / closed の運用更新を可能化
  - 実装方針:
    - `communication-queue` を通信オペレーションの親サービスに固定する
    - `visit-brief` には送達状況の短い projection のみ返し、通信状態の再集約はしない
  - 実装内容:
    - `CommunicationRequest` / `DeliveryRecord` / `CommunicationEvent` を束ねた送達ステータス集約を追加
    - 患者詳細と workflow に「未確認」「返信待ち」「失敗」の 3 区分を表示
    - 共有済み報告書と tracing report を同じ timeline で見られるようにする
  - 関連ファイル:
    - `src/server/services/communication-queue.ts`
    - `src/server/services/visit-brief.ts`
    - `src/app/api/dashboard/workflow/route.ts`
    - `src/app/(dashboard)/workflow/workflow-dashboard-content.tsx`
  - DoD:
    - 共有依頼ごとに delivery status が確認できる
    - 未確認/返信待ちが task として workflow に上がる
    - `visit-brief` 側に通信状態の重複ロジックを追加しない

- [x] VB-02: 疑義照会ワークベンチの実務化 `cc:完了`
  - 目的: 抽出した疑義照会候補を、その場で照会文面・回答・処方反映まで繋げる。
  - 実装方針:
    - 通信の優先度・期限・アクションは `communication-queue` を親にする
    - `visit-brief` は患者/訪問画面での抜粋表示に限定し、疑義照会の進行管理は workflow 側で行う
  - 実装内容:
    - `MedicationIssue` と `InquiryRecord` の対応付け
    - 照会ドラフト生成、回答待ち、回答済み、反映済みの状態遷移
    - `communication-queue` / 訪問支援ボード / visit-brief からワンクリックで開ける導線
  - 関連ファイル:
    - `src/server/services/communication-queue.ts`
    - `src/server/services/home-care-ops.ts`
    - `src/server/services/visit-brief.ts`
    - `src/app/api/dashboard/workflow/route.ts`
  - DoD:
    - 疑義照会候補から `InquiryRecord` が起票できる
    - 回答待ち/未反映が明確に残る
    - workflow と visit-brief の照会状態が同じ基準で表示される

- [x] VB-03: リフィル自動再訪のスケジュール提案化 `cc:完了`
  - 目的: 候補表示で終わらせず、再訪日案と担当薬剤師案まで出す。
  - 実装内容:
    - `refill_upcoming` / 服用終了日 / visit_deadline_date を使った再訪候補生成
    - 既存 `visit-schedule-planner` が返す proposal draft をそのまま使い、`visit_schedule_proposals` に流し込む
    - workflow から既存 proposal pipeline を起動できるようにする
  - 関連ファイル:
    - `src/server/services/visit-schedule-planner.ts`
    - `src/app/api/visit-schedule-proposals/route.ts`
    - `src/server/services/home-care-ops.ts`
    - `src/app/api/dashboard/workflow/route.ts`
  - DoD:
    - リフィル対象患者に対して再訪候補日が提示される
    - そのまま既存 proposal として保存・承認フローへ進める

- [x] VB-04: 算定ブロッカーの解消導線 `cc:完了`
  - 目的: 「請求不可の警告」を見るだけでなく、どの根拠が不足しているかを埋められるようにする。
  - 実装方針:
    - `BillingEvidence` を算定ブロッカー判定の唯一の SSOT に固定する
    - `visit-brief` / `visit-preparations` / workflow は `BillingEvidence` の projection だけを表示し、画面側で再判定しない
  - 実装内容:
    - `BillingEvidence` の不足項目を構造化し、患者/訪問/請求向け projection を返す
    - 同意未取得・計画書未更新・送達未完了・記録未入力を action link 付きで表示
    - 既存の task upsert / resolve と接続して block 解消後に task が自動クローズする同期を追加
  - 関連ファイル:
    - `src/server/services/billing-evidence.ts`
    - `src/server/services/visit-brief.ts`
    - `src/app/api/visit-preparations/[scheduleId]/route.ts`
    - `src/server/jobs/daily.ts`
  - DoD:
    - ブロッカーごとに解消先が明示される
    - 解消後に workflow の警告数が減る
    - 患者詳細 / 訪問準備 / 請求画面で同じ blocker 理由が表示される

- [x] VB-05: 家族・施設セルフ報告の履歴化 `cc:完了`
  - 目的: 送信した自己申告を単発入力で終わらせず、時系列比較と対応状況確認まで繋げる。
  - 実装内容:
    - 既存 `patient-self-reports` API を使い、外部共有 token 単位ではなく患者単位で self report 履歴を一覧化
    - category / callback / triage 結果でフィルタ
    - 対応済み・未対応・task 化済みのステータスを付与
  - 関連ファイル:
    - `src/app/api/patient-self-reports/route.ts`
    - `src/app/api/external-access/[token]/self-report/route.ts`
    - `src/app/shared/[token]/shared-viewer-content.tsx`
    - `src/server/services/visit-brief.ts`
  - DoD:
    - 患者詳細または外部共有から過去報告が確認できる
    - 対応漏れが再架電 SLA に連動する

- [x] VB-06: 剤形・服用形態支援の提案化 `cc:完了`
  - 目的: 「飲みにくさあり」を見つけるだけでなく、一包化候補・粉砕候補・剤形変更候補を提示する。
  - 実装内容:
    - `dosage_form_support` の evidence を詳細化
    - visit-brief に「剤形変更候補」セクションを追加
    - set plan / medication set 画面から提案理由を確認できるようにする
  - 関連ファイル:
    - `src/server/services/home-care-ops.ts`
    - `src/server/services/visit-brief.ts`
    - `src/app/(dashboard)/medication-sets/full/medication-set-full-content.tsx`
  - DoD:
    - 剤形・一包化・粉砕の候補理由が表示される
    - 不適応警告と候補提案が同時に見える

- [x] VB-07: 緊急連絡テンプレの送信導線 `cc:完了`
  - 目的: 緊急連絡先不足や急変対応を検知したら、そのまま連絡文面と送信履歴を扱えるようにする。
  - 2026-03-27 進捗:
    - 医師 / 訪看 / 家族向けの緊急連絡ドラフト候補を `communication-queue` から生成し、患者詳細 / workflow へ表示
    - `CommunicationRequest` に template / recipient / related entity / context snapshot を追加し、緊急ドラフトを標準フォーマットで起票できるようにした
  - 実装内容:
    - 医師/訪看/家族向けの緊急連絡テンプレートキー整備
    - `CommunicationRequest` に template / context の標準化
    - 患者詳細または訪問準備から送信 draft を起票
  - 関連ファイル:
    - `src/server/services/communication-queue.ts`
    - `src/server/services/external-access.ts`
    - `src/app/api/patients/[id]/route.ts`
  - DoD:
    - 緊急連絡候補から draft が作成できる
    - 送信後に communication timeline に残る

- [x] VB-08: 施設一括訪問トラッカー専用UI `cc:完了`
  - 目的: 同一施設患者を日別・施設別にまとめて準備/完了管理する。
  - 実装内容:
    - `FacilityVisitBatch` ベースの一覧 UI
    - 施設ごとの患者、持参物、未準備、未完了をまとめて表示
    - day view から施設単位の drill-down を追加
  - 関連ファイル:
    - `src/server/services/home-care-ops.ts`
    - `src/app/(dashboard)/schedules/day-view.tsx`
    - `src/app/api/dashboard/workflow/route.ts`
  - DoD:
    - 同日同施設の訪問を 1 セクションで追える
    - 施設単位で準備漏れが分かる

- [x] VB-09: 地域資源マップの可視化 UI `cc:完了`
  - 目的: 夜間休日・緊急時に使える地域資源を、拠点・対応体制・空白地帯で見られるようにする。
  - 実装内容:
    - `pharmacy-sites` / shifts / geo 情報の集約 API
    - 管理画面に一覧 + 地域別サマリー表示
    - 夜間休日対応、麻薬、無菌、代行可否のフィルタ
  - 関連ファイル:
    - `src/app/api/pharmacy-sites/route.ts`
    - `src/app/(dashboard)/admin/analytics/*`
    - `src/server/services/home-care-ops.ts`
  - DoD:
    - 拠点別の対応体制と空白日が見える
    - 緊急時プレイブックへ遷移できる

- [x] VB-10a: モバイル訪問モード（軽量閲覧） `cc:完了`
  - 目的: 通信不安定でも、訪問要点と同期状態をすぐ確認できる軽量 UI を用意する。
  - 実装内容:
    - day view / visit brief の軽量表示
    - 重要情報のみ read-only でオフラインキャッシュ
    - pending sync 件数と通信状態を表示
  - 関連ファイル:
    - `src/app/(dashboard)/schedules/day-view.tsx`
    - `src/app/(dashboard)/schedules/day-view.shared.ts`
    - `src/lib/stores/offline-db.ts`
    - `src/lib/stores/sync-engine.ts`
  - DoD:
    - オフライン時でも訪問要点を確認できる
    - 同期待ち件数が分かる

- [x] VB-10b: モバイル訪問モード（訪問記録ドラフト） `cc:完了`
  - 目的: オフライン時でも訪問記録を下書きし、再接続後に再送できるようにする。
  - 実装内容:
    - `OfflineVisitDraft` / `OfflineSyncQueue` を使った visit record draft 保存
    - 既存 sync queue に visit record 再送を接続
    - 記録途中の step 状態と最終更新時刻を表示
  - 関連ファイル:
    - `src/lib/stores/offline-db.ts`
    - `src/lib/stores/sync-engine.ts`
    - `src/app/(dashboard)/schedules/day-view.tsx`
  - DoD:
    - オフラインで訪問記録を保存できる
    - 再接続後に自動または手動で再送できる

- [x] VB-10c: モバイル訪問モード（競合解決） `cc:完了`
  - 目的: 409 conflict 時に、破棄ではなく競合内容を見て手動解決できるようにする。
  - 2026-03-27 進捗:
    - sync engine で 409 conflict 時に queue/draft を破棄せず保持するよう変更
    - サーバー版/ローカル版の差分を day view に表示し、上書き / 破棄 / 再編集を選べるようにした
  - 実装内容:
    - sync engine で 409 時の draft 保持
    - サーバー版とローカル版の差分表示
    - 上書き / 破棄 / 再編集の選択肢を追加
  - 関連ファイル:
    - `src/lib/stores/sync-engine.ts`
    - `src/lib/stores/offline-db.ts`
    - `src/app/(dashboard)/schedules/day-view.tsx`
  - DoD:
    - conflict 時に draft が消えない
    - ユーザーが競合を解決できる

- [x] VB-11: AI要約の運用整備 `cc:完了`
  - 目的: AI短文化を「試験実装」から「運用機能」に引き上げる。
  - 2026-03-27 進捗:
    - provider / model / fallback reason を visit brief に保持し、UI 表示と fallback ログ出力を追加
    - AI / rule 比較表示、24h 失敗率表示、生成監査ログ、要約フィードバック収集 endpoint を追加
  - 実装内容:
    - provider 切替、失敗率監視、要約生成ログ、フィードバック収集
    - rule summary と AI summary の比較表示
    - source refs と生成時刻の監査性強化
  - 関連ファイル:
    - `src/server/services/visit-brief-ai.ts`
    - `src/server/services/visit-brief.ts`
    - `src/components/visit-brief/visit-brief-card.tsx`
  - DoD:
    - AI unavailable 時でも UX が崩れない
    - 要約の品質改善に必要な運用ログが残る

### 推奨実装順

1. VB-01 多職種共有サマリーの送達管理
2. VB-02 疑義照会ワークベンチの実務化
3. VB-03 リフィル自動再訪のスケジュール提案化
4. VB-04 算定ブロッカーの解消導線
5. VB-05 家族・施設セルフ報告の履歴化

</details>

## Phase 2: セット・月次運用・連携強化 `cc:完了`

<details>
<summary>6 subsections completed — click to expand</summary>

> depends: Phase 1b 完了 | 出口条件: セット運用安定化 + 締め処理の見える化

### 2-1. ④ 薬剤セット + ⑤ セット鑑査 `cc:完了`

> DoD: セット計画→実行→鑑査→持参パック→訪問持参連動が動作

> ※ 1b-5 で最小運用は先行実装済み。Phase 2 はフル機能化が目的

**④ 薬剤セット:**

- [x] セット計画画面: 対象期間、セット方式（施設カレンダー/1日4回/眠前のみ/カスタム）
- [x] スロットグリッド: 朝/昼/夕/眠前/頓用 × 日数のマトリクス
- [x] SetBatch: 明細→スロット割当、持参/施設預け/後送の区分、頓用は通常スロットから分離
- [x] 持参パック自動生成: 訪問持参チェックリスト、注意事項ラベル（冷所保管/麻薬等）
- [x] バリデーション: 鑑査未承認薬→セット不可、投与タイミング未定義→不可、処方変更→影響セット再確認

**⑤ セット鑑査:**

- [x] 鑑査待ち一覧 + セットグリッド確認画面（患者/日付/時間帯別）
- [x] 判定: 承認 / 部分承認（患者・日付・時間帯単位で承認範囲を特定）/ 差戻し（理由コード必須）
- [x] 承認 → 訪問計画のcarry_items確定、差戻し → セット担当に通知 + 不足分の再作業タスク起票
- [x] 一包化鑑査連携フック: 外部システム（PROOFIT等）のアダプタIF、画像認証結果をDispenseAuditに取込

### 2-2. 請求支援 (FR-401〜405) `cc:完了`

> DoD: 月次候補→バリデーション→確認→CSV出力が動作

- [x] BillingEvidence を前提に候補生成（visit単位の根拠欠落時は候補生成せず警告）
- [x] 請求候補生成（建物→ユニット→患者階層で単一建物振分け）
- [x] 3層バリデーション（D-05）+ 算定ルールエンジン（2026改定、バージョニング）
- [x] 服薬情報等提供料 5タイプ + 居宅療養管理指導費との同月不可
- [x] 在宅患者重複投薬・相互作用等防止管理料（処方提案→変更追跡）
- [x] CSV出力(YJコード) + 月次ダッシュボード

### 2-3. 経営指標・施設基準管理 `cc:完了`

> DoD: 各指標がリアルタイム集計され、施設基準の充足/不足が表示される

- [x] 経営指標ダッシュボード:
  - 処方箋集中率（調剤基本料区分に影響）
  - 後発医薬品調剤割合（地域支援・医薬品供給対応体制加算の要件、集中率85%超→70%以上必須）
  - 薬剤師1人あたり処方箋枚数（40枚/日基準）
  - 在宅訪問実績回数（年48回、2026改定で強化）
  - 処方箋月次受付枚数レポート
- [x] 施設基準管理(FacilityStandardRegistration): 届出一覧、要件充足チェック自動実行、更新期限アラート、要件未達→加算算定不可警告
- [x] かかりつけ薬剤師管理(PharmacistCredential): 研修認定有効期限、勤務実績(週32h+)、在籍継続期間、同意患者一覧

### 2-4. 通知・エスカレーション・カンファレンス `cc:完了`

- [x] 通知(FR-503) + EscalationRule + ConferenceNote（→Task変換）

### 2-5. 監査・管理設定・外部共有 `cc:完了`

- [x] 監査ログ閲覧(FR-502) + 管理設定(FR-504, 4層UI, 薬剤師シフト管理UI) + 外部連携監視(FR-505)
- [x] ExternalAccessGrant: 外部閲覧画面 + トークン(JWT,72h) + SMS OTP
- [x] 服薬カレンダー印刷/PDF + 家族向け簡易共有ビュー（ExternalAccessGrant Track B 拡張）

### 2-6. ケアチームアカウント + 外部連携 + オフライン `cc:完了`

- [x] 外部連携者ロール + CSV/NSIPS + FAX + オフライン下書き+同期(FR-106 Ph2)

</details>

## Phase 2b: 実務機能強化 `cc:完了`

<details>
<summary>10 subsections completed — click to expand</summary>

> 2026-03-28 立案: 既存コードベースの GAP 分析に基づく6機能の実装計画
> depends: Phase 1b 主要機能完了 | 出口条件: パイロット薬局で日常業務が完結する

### 2b-1. スタッフ管理機能 `cc:完了` (2026-03-31)

> 既存: Pharmacist CRUD API、Cognito 連携、シフト管理、資格管理は実装済み
> 不足: 専用UI、一覧性、勤怠、ワークロード分析、一括操作
> DoD: 管理者がスタッフの採用→配置→勤怠→評価を1画面で完結できる

**2b-1a. スタッフ管理専用ページ（`/admin/staff`）:**

- [x] スタッフ一覧テーブル（DataTable ベース） `cc:完了` (2026-03-31)
  - 列: 名前/カナ、ロール、所属店舗、アカウント状態（invited/active/suspended/retired）、最終ログイン、今月訪問数
  - フィルタ: ロール、店舗、状態、資格種別
  - ソート: 名前/訪問数/最終ログイン
  - 行アクション: 編集/停止/復帰/招待再送
  - 既存 API: `GET /api/pharmacists`（フィルタ拡張のみ）
- [x] スタッフ詳細パネル（サイドパネル or モーダル） `cc:完了` (2026-03-31)
  - プロフィール編集（名前/メール/電話/所属店舗/ロール変更）
  - 工程権限フラグ（can_dispense/can_audit_dispense/can_set/can_audit_set）のトグル
  - 訪問制限（max_daily_visits/max_weekly_visits/max_travel_minutes）
  - 専門分野（visit_specialties）、対応エリア（coverage_area）
  - 既存 API: `PATCH /api/pharmacists/[id]` action=update

**2b-1b. 資格管理 CRUD:**

- [x] 資格の新規登録・編集・失効 UI `cc:完了` (2026-03-31)
  - 現状: `pharmacist-credentials-content.tsx` は読み取り専用の一覧表示のみ
  - 追加: 登録フォーム（資格種別/番号/発行日/有効期限/研修時間/在籍年数）
  - API: `POST/PATCH /api/pharmacist-credentials` を新設
  - 既存モデル: `PharmacistCredential`（prisma/schema/organization.prisma）

**2b-1c. 勤怠・ワークロード分析:**

- [x] 薬剤師別 KPI ダッシュボード `cc:完了` (2026-03-31)
  - 月間訪問数 / 担当患者数 / 平均訪問時間 / 報告書提出率
  - データソース: `VisitRecord` + `CareReport` + `PharmacistShift` を集計
  - 既存基盤: `/admin/performance` の `page.tsx` を拡張
- [x] ワークロードバランス表示 `cc:完了` (2026-03-31)
  - 薬剤師間の訪問数/移動距離の偏り可視化
  - 既存 `visit-schedule-planner.ts` の `workload_penalty` スコアを流用

**2b-1d. 一括操作:**

- [x] CSV 一括インポート（薬剤師マスタ） `cc:完了` (2026-03-31)
  - カラム: 名前/カナ/メール/電話/ロール/店舗/資格
  - 既存 `inviteCognitoUser()` をバッチ呼出し
- [x] 一括シフト登録（月間テンプレート適用の拡張） `cc:完了` (2026-03-31)
  - 既存: `POST /api/pharmacist-shift-templates/apply`（単一薬剤師）→ 複数薬剤師同時適用

### 2b-2. 患者一覧機能強化 `cc:完了` (2026-03-31)

> 既存: 基本テーブル（名前/カナ/生年月日/性別/ケース状態）、カーソルページネーション、名前検索
> 不足: 高度フィルタ、リスク表示、クイックアクション、エクスポート
> DoD: 管理者/薬剤師が「今日対応すべき患者」を即座に絞り込める

**2b-2a. 高度フィルタ（API + UI）:**

- [x] API フィルタ拡張（`GET /api/patients`）
  - ケース状態（active/on_hold/discharged/terminated）
  - 担当薬剤師（CareTeamLink.user_id where role='pharmacist'）
  - 施設/建物（Residence.building_id）
  - 保険種別（payer_basis: medical/care/self）
  - リスクレベル（patient-risk.ts の score を参照）
  - 最終訪問日の範囲（VisitRecord.visited_at）
  - 同意状態（ConsentRecord の未取得/期限切れ）
  - 請求支援フラグ（Patient.billing_support_needed）
- [x] フィルタバー UI（patients-table.tsx 拡張）
  - マルチセレクト + 日付範囲ピッカー + リセットボタン
  - フィルタ適用数バッジ表示

**2b-2b. 一覧表示の情報密度向上:**

- [x] 追加列（切替可能）
  - 担当薬剤師名、リスクレベルバッジ（stable/watch/high）、最終訪問日、次回訪問予定
  - 未解決課題数、服薬中薬剤数、アクティブケース有無
  - 既存データソース: `GET /api/patients/[id]` の risk_summary / schedules を一覧 API にサマリー追加
- [x] カラム表示/非表示切替
  - DataTable の columnVisibility を活用（`src/components/ui/data-table.tsx` に既存機能あり）

**2b-2c. クイックアクション・エクスポート:**

- [x] 行アクション: 患者詳細へ遷移 / 訪問予定作成 / ケース状態変更
- [x] CSV/Excel エクスポート（フィルタ適用済み一覧）
  - 既存基盤: `billing-candidates/export` のパターンを流用
- [x] お気に入り/最近表示した患者（Zustand + localStorage）

### 2b-3. セット機能の実務拡張 `cc:完了` (2026-03-31)

> 既存: SetPlan(4方式)/SetBatch(グリッド)/SetAudit(承認/部分/差戻し)/持参パック/冷所・麻薬検知
> 不足: 患者固有の配薬方法、物理的なセット形態の表現、セット変更履歴
> DoD: 「この患者はお薬BOXの朝青・昼黄に入れてホッチキス止め」が画面で分かり、印刷できる

**2b-3a. 配薬方法マスタ + 患者固有設定:**

- [x] `PackagingMethod` マスタテーブル追加（prisma/schema/medication.prisma） `cc:完了` (2026-03-31)
  ```
  id, org_id, name, description, icon_key, sort_order, is_active
  初期データ: お薬BOX / お薬カレンダー / 一包化 / ホッチキス止め / テープ止め / 分包紙 / PTPシート / 液剤ボトル
  ```
- [x] `Patient.packaging_preferences` JSON フィールド追加（prisma/schema/patient.prisma） `cc:完了` (2026-03-31)
  ```json
  {
    "default_method_id": "uuid",
    "box_config": { "morning": "blue", "noon": "yellow", "evening": "pink", "bedtime": "white" },
    "special_instructions": "ホッチキス止め、名前シール貼付、大きい文字",
    "cognitive_note": "認知機能低下あり、家族管理",
    "staple_required": true,
    "label_font_size": "large"
  }
  ```
- [x] 患者詳細画面に「配薬方法」設定パネル追加
  - 配薬方法選択（マスタから）+ BOX色設定 + 特記事項テキスト
  - 設定は CareCase or Patient に紐付け

**2b-3b. セット画面への配薬方法統合:**

- [x] SetPlan.set_method を `PackagingMethod` FK に拡張（既存4値 + マスタ参照の併用） `cc:完了` (2026-03-31)
- [x] セットグリッド UI に配薬方法表示 `cc:完了` (2026-03-31)
  - グリッド上部: 「お薬BOX（朝=青, 昼=黄, 夕=ピンク, 眠前=白）」
  - 特記事項バナー: 「ホッチキス止め / 名前シール貼付」
  - 印刷レイアウト: BOX スロット色 + 患者固有指示を持参パックチェックリストに反映
- [x] `medication-set-full-content.tsx` の印刷ビューに配薬指示セクション追加 `cc:完了` (2026-03-31)

**2b-3c. セット変更履歴・差分:**

- [x] SetBatch の変更履歴（before/after diff） `cc:完了` (2026-03-31)
  - 再生成時に旧バッチを snapshot → diff 表示
  - 処方変更トリガーの自動検知（PrescriptionLine 更新 → 影響 SetBatch ハイライト）
- [x] packaging_instructions の構造化 `cc:完了` (2026-03-31)
  - 現在: free text + regex 検知（`/冷所/`, `/麻薬/`）→ 脆い
  - 改善: ENUM 型タグ配列に変更（`cold_storage`, `narcotic`, `half_tablet`, `crush_prohibited`, `separate_pack`, `unit_dose`）

### 2b-4. スケジュール提案機能の拡張 `cc:完了` (2026-03-31)

> 既存: visit-schedule-planner.ts（マルチファクタースコアリング、ルート最適化、制約チェック）
> 不足: 提案 UI、患者連絡結果の反映、リスケ提案、週間最適化
> DoD: 「来週の訪問予定を自動提案→確認→患者連絡→確定」のフローが UI で完結する

**2b-4a. スケジュール提案ダッシュボード（`/schedules/proposals`）:**

- [x] 提案一覧画面 `cc:完了` (2026-03-30)
  - 状態別タブ: 未承認 / 患者連絡中 / 確定済み / 却下
  - 各提案カード: 患者名、候補日時、担当薬剤師、スコア、提案理由
  - 一括承認 / 一括却下アクション
  - 既存 API: `GET /api/visit-schedule-proposals`
- [x] 提案詳細ビュー `cc:完了` (2026-03-30)
  - 候補一覧（1-5件）のランキング表示（スコア内訳: 移動コスト/薬剤師適合度/日付距離）
  - 地図上で訪問順ルートプレビュー（既存 `google-routes.ts` 連携）
  - 薬剤師のその日のスケジュールとの並び表示
  - 既存 API: `GET/PATCH /api/visit-schedule-proposals/[id]`

**2b-4b. 患者連絡ワークフロー:**

- [x] 提案承認 → 患者連絡タスク自動生成 `cc:完了` (2026-03-30)
  - 連絡方法選択（電話/FAX/メール）、連絡結果記録（確認済/不在/拒否/変更希望）
  - 既存: `contact_attempt` action は API 実装済み → UI 連携のみ
- [x] 変更希望時の再提案フロー `cc:完了` (2026-03-30)
  - 患者の希望日時を制約に追加 → `generateVisitScheduleProposalDrafts()` 再実行

**2b-4c. 週間最適化ビュー:**

- [x] 週単位の訪問予定最適化画面 `cc:完了` (2026-03-30)
  - 薬剤師 × 日のガントチャート（既存 day-view.tsx のタブレット週表示を拡張）
  - ドラッグ&ドロップで訪問の日付/薬剤師変更 → 再スコアリング
  - 空きスロットへの「この枠に提案」ボタン
- [x] 施設一括訪問の自動グループ化 `cc:完了` (2026-03-30)
  - 同一施設患者を同日に集約する提案（既存 `same_facility_bonus` スコアを活用）

### 2b-5. 報告書検索機能 `cc:完了` (2026-03-31)

> 既存: reports-table.tsx（状態/種別フィルタのみ、クライアントサイド）、API は patient_id + status のみ
> 不足: 日付範囲、キーワード検索、送達状態フィルタ、分析
> DoD: 「3月に○○医師に送った報告書で未確認のもの」が即座に検索できる

**2b-5a. API 検索拡張（`GET /api/care-reports`）:**

- [x] 日付範囲フィルタ（created_at / sent_at）
- [x] 報告書種別フィルタ（report_type — 現在クライアントサイドのみ → API に移行）
- [x] 送達状態フィルタ（DeliveryRecord.status: sent/failed/confirmed/response_waiting）
- [x] 送付先名検索（DeliveryRecord.recipient_name 部分一致）
- [x] 患者名検索（Patient.name / name_kana 部分一致 — 現在は patient_id のみ）
- [x] 全文キーワード検索（CareReport.content JSON 内の SOAP テキスト）
  - PostgreSQL `to_tsvector('japanese', ...)` or `ILIKE` でキーワードヒット

**2b-5b. 報告書一覧 UI 拡張（reports-table.tsx）:**

- [x] フィルタバー: 日付範囲 + 患者名 + 種別 + 送達状態 + キーワード
- [x] 追加列: 患者名（現在 patient_id のみ）、送付先名、送付日、送達チャネル
- [x] 送達状態バッジの色分け（sent=青、confirmed=緑、failed=赤、waiting=橙）
- [x] 行展開: 送達履歴タイムライン（DeliveryRecord の送付/リトライ/確認の時系列）

**2b-5c. 報告書分析:**

- [x] 送達成功率ダッシュボード（月別/医師別/チャネル別） `cc:完了` (2026-03-30)
  - 既存 `billing-evidence/analytics` のパターンを流用
- [x] 未確認報告書一覧（response_waiting が N日超）→ リマインドタスク自動生成 `cc:完了` (2026-03-30)

### 2b-6. 訪問時音声認識機能 `cc:完了` (2026-03-30)

> 既存: SOAP テキスト入力（Textarea）、ステップウィザード（S→O→A→P）、IndexedDB ドラフト保存
> 不足: Web Speech API 統合がゼロ。マイク参照は QR スキャンのカメラのみ
> DoD: 訪問先でスマホに向かって話すと SOAP テキストに変換され、編集→保存できる

**2b-6a. Web Speech API 統合:**

- [x] `src/lib/hooks/use-speech-recognition.ts` 新規作成 `cc:完了` (2026-03-30)
  - `webkitSpeechRecognition` / `SpeechRecognition` のブラウザ検出
  - 言語: `ja-JP`（日本語）固定、将来 `en-US` 切替対応
  - 設定: `continuous: true`（連続認識）、`interimResults: true`（中間結果表示）
  - 状態管理: `isListening` / `transcript` / `interimTranscript` / `error` / `isSupported`
  - マイク権限リクエスト + 権限拒否時のフォールバック UI

**2b-6b. SOAP 入力への統合:**

- [x] 各 SOAP セクションに「音声入力」トグルボタン追加 `cc:完了` (2026-03-30)
  - `visit-record-form.tsx` の Textarea 横にマイクアイコンボタン
  - `soap-step-wizard.tsx`（モバイル版）の各ステップにも同様追加
  - 録音中: ボタン赤点滅 + 中間テキストをリアルタイム表示（灰色イタリック）
  - 確定テキスト: Textarea に追記（既存テキストの末尾に append）
- [x] 音声→テキスト変換の後処理 `cc:完了` (2026-03-30)
  - 句読点自動挿入（日本語の場合「。」「、」の補完）
  - 医療用語の変換補正（「ないふく」→「内服」等）は Phase 3 で AI 補正として検討
- [x] IndexedDB ドラフト連携 `cc:完了` (2026-03-30)
  - 音声入力テキストも既存 `use-soap-draft.ts` の autosave に統合
  - オフライン時: Web Speech API はオンライン必須のため、オフライン時はボタン非活性 + ガイド表示

**2b-6c. 対応デバイス・制約:**

- [x] ブラウザ対応マトリクス `cc:完了` (2026-03-30)
  - Chrome/Edge: `webkitSpeechRecognition` サポート済み（主要ターゲット）
  - Safari (iOS): `SpeechRecognition` サポート済み（iOS 14.5+）
  - Firefox: 未サポート → フォールバック（ボタン非表示 + 手動入力のみ）
- [x] PWA 制約 `cc:完了` (2026-03-30)
  - HTTPS 必須（既に対応済み）
  - マイク権限は初回利用時に1回だけリクエスト
  - バックグラウンド時の録音停止ハンドリング

### 2b-7. 施設マスター `cc:完了` (2026-03-31)

> 既存: Residence.building_id（文字列のみ）、FacilityVisitBatch.facility_id（FK なし）、PharmacySite（自薬局のみ）
> 不足: Facility テーブルが存在しない。施設情報は患者住所やケアチームに散在し、一元管理できない
> DoD: 施設の基本情報・受入時間・担当者・所属患者を1画面で管理でき、訪問計画/請求に連動する

**2b-7a. Facility モデル新設（prisma/schema/organization.prisma）:**

- [x] `Facility` テーブル追加
  ```
  id, org_id, name, name_kana, facility_type(ENUM), postal_code, address, lat, lng
  phone, fax, email, representative_name
  acceptance_time_from, acceptance_time_to  // 受入時間帯
  visit_day_pattern (Json)                  // 定期訪問曜日パターン
  max_patients_per_visit                    // 1回あたり最大患者数
  notes, is_active
  ```
- [x] `FacilityType` ENUM
  ```
  hospital / clinic / nursing_home / group_home / special_nursing_home
  / rehabilitation_facility / home_care_support_clinic / other
  ```
  （病院 / 診療所 / 老人ホーム / グループホーム / 特養 / リハ施設 / 在宅療養支援診療所 / その他）
- [x] リレーション追加
  - `Residence.facility_id` → `Facility` FK（既存 `building_id` を置換）
  - `FacilityVisitBatch.facility_id` → `Facility` FK（既存文字列を置換）
  - `Facility` → `patients[]`（Residence 経由の逆参照）
  - `Facility` → `facilityContacts[]`（施設担当者）

**2b-7b. 施設担当者モデル（FacilityContact）:**

- [x] `FacilityContact` テーブル追加

  ```
  id, org_id, facility_id, name, role(施設看護師/施設管理者/施設相談員/その他)
  phone, email, fax, department, is_primary, notes
  ```

  - 施設側の連絡窓口を管理（患者の ContactParty とは別レイヤー）

**2b-7c. 施設管理 API:**

- [x] `GET/POST /api/facilities` — 施設一覧・新規登録 `cc:完了` (2026-03-30)
- [x] `GET/PATCH/DELETE /api/facilities/[id]` — 施設詳細・更新・無効化
- [x] `GET/PUT /api/facilities/[id]/contacts` — 施設担当者の管理
- [x] `GET /api/facilities/[id]/patients` — 施設所属患者一覧
- [x] バリデーション: `src/lib/validations/facility.ts` 新設

**2b-7d. 施設管理 UI（`/admin/facilities`）:**

- [x] 施設一覧テーブル（DataTable）
  - 列: 名称/種別/住所/電話/受入時間/所属患者数/アクティブ
  - フィルタ: 種別、エリア、アクティブ状態
- [x] 施設詳細ページ `cc:完了` (2026-03-30)
  - 基本情報編集 + 受入時間 + 定期訪問曜日
  - 施設担当者一覧（CRUD）
  - 所属患者一覧（Residence 経由）
  - 施設訪問履歴（FacilityVisitBatch 一覧）

**2b-7e. 既存機能との連動:**

- [x] 患者登録時: 施設選択 → Residence.facility_id 自動設定 + 住所/座標自動入力 `cc:完了` (2026-03-30)
- [x] 訪問計画: Facility.acceptance_time_from/to → PatientSchedulePreference.facility_time_from/to に自動反映 `cc:完了` (2026-03-30)
- [x] 施設一括訪問: FacilityVisitBatch 作成時に Facility マスタから患者リストを自動取得 `cc:完了` (2026-03-30)
- [x] 請求: BillingEvidence.building_patient_count を Facility.patients から正確に集計 `cc:完了` (2026-03-30)

### 2b-8. 他職種マスター `cc:完了` (2026-03-31)

> 既存: CareTeamLink（ケース単位、5ロール、自由テキスト）、ContactParty（patient単位、facility_staff含む）
> 不足: 他職種の情報がケース/患者に散在し、同じ医師が複数患者に紐づく場合に重複入力が発生する
> DoD: 地域の医師・看護師・ケアマネを一元管理し、患者ケアチーム登録時に選択できる

**2b-8a. ExternalProfessional モデル新設（prisma/schema/organization.prisma）:**

- [x] `ExternalProfessional` テーブル追加
  ```
  id, org_id, name, name_kana, profession_type(ENUM)
  organization_name, department, title
  phone, email, fax, address
  facility_id (optional FK → Facility)  // 所属施設
  specialties (Json)                     // 専門分野
  preferred_contact_method (ENUM: phone/fax/email/other)
  preferred_contact_time (String)        // 連絡希望時間帯
  notes, is_active
  ```
- [x] `ProfessionType` ENUM
  ```
  physician / dentist / nurse / visiting_nurse / care_manager
  / social_worker / physical_therapist / occupational_therapist
  / speech_therapist / dietitian / pharmacist_external / helper / other
  ```
  （医師/歯科医師/看護師/訪問看護師/ケアマネ/MSW/PT/OT/ST/管理栄養士/外部薬剤師/ヘルパー/その他）

**2b-8b. CareTeamLink との連携:**

- [x] `CareTeamLink.external_professional_id` FK 追加（optional）
  - 既存の自由テキスト（name/organization_name/phone 等）はフォールバックとして残す
  - ExternalProfessional 選択時は FK から自動入力 + 同期
  - FK なしの場合は従来通り自由テキスト入力（未登録の職種にも対応）

**2b-8c. 他職種マスター API:**

- [x] `GET/POST /api/external-professionals` — 一覧・新規登録 `cc:完了` (2026-03-30)
  - 検索: 名前/カナ/職種/所属施設で検索
- [x] `GET/PATCH/DELETE /api/external-professionals/[id]` — 詳細・更新・無効化
- [x] `GET /api/external-professionals/[id]/patients` — 担当患者一覧（CareTeamLink 逆参照）
- [x] バリデーション: `src/lib/validations/external-professional.ts` 新設

**2b-8d. 他職種マスター UI（`/admin/professionals`）:**

- [x] 他職種一覧テーブル（DataTable）
  - 列: 名前/カナ/職種/所属施設・組織/電話/メール/担当患者数
  - フィルタ: 職種、所属施設、アクティブ状態
- [x] 他職種詳細パネル `cc:完了` (2026-03-30)
  - 基本情報編集 + 所属施設選択（Facility マスタ連動）
  - 担当患者一覧（CareTeamLink 逆参照）
  - 連絡履歴（CommunicationEvent/CommunicationRequest で counterpart 検索）

**2b-8e. ケアチーム登録 UI の改善:**

- [x] `patient-care-team-panel.tsx` の入力改善
  - 現在: 全フィールド手入力 → 改善: 名前入力時に ExternalProfessional をサジェスト
  - 選択すると組織名/電話/FAX/メール/所属施設を自動入力
  - 「新規登録」ボタンで ExternalProfessional を即時追加

### 2b-9. カンファレンス記録機能 `cc:完了` (2026-03-31)

> 既存: ConferenceNote（タイトル/内容/参加者JSON/アクションアイテム→Task変換）、conferences-content.tsx
> 不足: conference_type なし / 算定連携なし / 報告書生成なし / 情報のシステム活用なし
> DoD: カンファレンス記録→算定根拠→報告書生成→患者情報への反映が一気通貫で動作する

**設計方針: カンファレンス情報の3つの出口**

```
                    ┌─→ [算定] BillingEvidence + BillingCandidate
                    │     退院時共同指導料 / 情報提供料 / ターミナルケア加算
ConferenceNote ─────┼─→ [報告書] CareReport + DeliveryRecord
  (構造化記録)       │     参加報告書 / 情報提供書 / 内部記録
                    └─→ [情報活用] 患者データへのフィードバック
                          ManagementPlan更新 / MedicationIssue起票 / VisitSchedule調整
```

**2b-9a. ConferenceNote モデル拡張（prisma/schema/communication.prisma）:**

- [x] `conference_type` ENUM 追加 `cc:完了` (2026-03-31)
  ```
  multidisciplinary          // 多職種カンファレンス（汎用）
  discharge_planning         // 退院前カンファレンス
  service_team_meeting       // サービス担当者会議
  death_conference           // デスカンファレンス
  medication_review          // 薬剤総合評価調整会議
  emergency_case_review      // 緊急事例検討
  ```
- [x] 構造化フィールド追加 `cc:完了` (2026-03-31)
  ```
  conference_type             ConferenceType
  patient_id                  String? (optional FK → Patient)
  facility_id                 String? (optional FK → Facility)
  structured_content          Json?   // 種別ごとの構造化データ（下記 9b〜9d で定義）
  billing_eligible            Boolean @default(false)
  billing_code                String? // SSOT key（例: medical.conference.discharge_joint_guidance）
  follow_up_date              DateTime?
  follow_up_completed         Boolean @default(false)
  generated_report_id         String? // 生成した CareReport の ID（traceability）
  ```
- [x] `participants` JSON の構造化強化 `cc:完了` (2026-03-30)

  ```json
  [
    {
      "name": "田中太郎",
      "role": "physician",
      "organization": "○○クリニック",
      "external_professional_id": "uuid",
      "attended": true,
      "is_report_recipient": true
    }
  ]
  ```

  - `external_professional_id` → ExternalProfessional マスタ連動
  - `attended` → 出欠管理（算定要件の参加者数チェックに使用）
  - `is_report_recipient` → 報告書送付対象フラグ

**2b-9b. 退院前カンファレンス（discharge_planning）:**

- [x] `structured_content` スキーマ `cc:完了` (2026-03-31)
  ```json
  {
    "hospital_name": "○○病院",
    "ward": "3階東病棟",
    "target_discharge_date": "2026-04-15",
    "diagnosis_summary": "誤嚥性肺炎後のリハビリ",
    "current_medications": [{ "drug_name": "...", "dose": "...", "frequency": "..." }],
    "medication_changes_on_discharge": [
      { "drug_name": "...", "change_type": "added|stopped|dose_changed", "reason": "..." }
    ],
    "home_care_requirements": "訪問薬剤管理指導（週1回）、服薬カレンダー管理",
    "support_arrangements": "訪問看護週2回、デイケア週3回",
    "pharmacist_role": "服薬指導、残薬管理、副作用モニタリング",
    "next_outpatient_date": "2026-04-22",
    "document_provided": true
  }
  ```
- [x] **算定連携**: 退院時共同指導料（600点） `cc:完了` (2026-03-31)
  - SSOT key: `medical.conference.discharge_joint_guidance`
  - 算定要件: ①入院中に病院で共同指導 ②文書提供（`document_provided=true`）③薬剤師が参加（participants に pharmacist role + attended=true）
  - `billing-evidence.ts` の `upsertBillingEvidenceForVisit` に conference_note_ref 連携を追加
- [x] **報告書生成**: 退院前カンファ → `CareReport(report_type=physician_report)` 自動生成 `cc:完了` (2026-03-31)
  - `medication_changes_on_discharge` を報告書の処方変更セクションに差込み
  - `home_care_requirements` を計画セクションに差込み
- [x] **情報活用**: `cc:完了` (2026-03-31)
  - `medication_changes_on_discharge` → MedicationIssue 自動起票（change_type ごとに）
  - `target_discharge_date` → VisitSchedule の初回訪問提案日を自動設定
  - `home_care_requirements` → ManagementPlan の次回更新時に参照表示

**2b-9c. サービス担当者会議（service_team_meeting）:**

- [x] `structured_content` スキーマ `cc:完了` (2026-03-31)
  ```json
  {
    "meeting_purpose": "ケアプラン変更に伴う担当者会議",
    "care_plan_changes": "訪問頻度の見直し（月2回→月4回）",
    "service_adjustments": [
      { "service": "訪問薬剤管理", "before": "月2回", "after": "月4回", "reason": "服薬管理強化" }
    ],
    "medication_related_items": [
      { "item": "服薬コンプライアンス低下", "action": "一包化検討", "assignee": "担当薬剤師" }
    ],
    "agreed_actions": [{ "action": "...", "assignee": "...", "deadline": "..." }],
    "next_meeting_date": "2026-05-15",
    "care_manager_name": "佐藤花子"
  }
  ```
- [x] **算定連携**: 服薬情報等提供料2（ケアマネ共有）（20点） `cc:完了` (2026-03-31)
  - SSOT key: `medical.information_provision.2_care_manager`（既存ルール）
  - 算定要件: 担当者会議でケアマネに薬学的情報を提供 + 記録保持
  - `billing_eligible` 自動判定: participants に care_manager role + attended=true → true
  - BillingEvidence.conference_note_ref に記録
- [x] **報告書生成**: 担当者会議 → `CareReport(report_type=care_manager_report)` 自動生成 `cc:完了` (2026-03-31)
  - `service_adjustments` と `medication_related_items` を報告書に差込み
  - 参加者のうち `is_report_recipient=true` の全員に送付候補を自動生成
- [x] **情報活用**: `cc:完了` (2026-03-31)
  - `service_adjustments` の訪問頻度変更 → VisitSchedule の recurrence_rule 変更提案を自動生成
  - `medication_related_items` → MedicationIssue 起票 + action_items → Task 変換
  - `agreed_actions` → 既存の conference-notes/[id]/tasks API で Task 自動生成
  - `next_meeting_date` → 次回会議リマインド Notification を日次ジョブで生成

**2b-9d. デスカンファレンス（death_conference）:**

- [x] `structured_content` スキーマ `cc:完了` (2026-03-31)
  ```json
  {
    "death_date": "2026-03-20",
    "death_location": "自宅",
    "care_duration_months": 18,
    "review_focus": ["疼痛管理", "服薬管理", "家族支援", "多職種連携"],
    "timeline_summary": "2024年9月開始→2025年6月から麻薬管理→2026年3月看取り",
    "medication_review": {
      "pain_control": "概ね良好",
      "last_week_changes": "レスキュー増量",
      "adverse_events": "なし"
    },
    "lessons_learned": "家族への早期介入が有効だった",
    "quality_indicators": {
      "pain_controlled": true,
      "family_satisfaction": "high",
      "medication_adherence": "good"
    },
    "improvement_actions": [
      {
        "action": "看取り期の服薬指導マニュアルを改訂",
        "assignee": "管理薬剤師",
        "deadline": "2026-06-30"
      }
    ]
  }
  ```
- [x] **算定連携**: ターミナルケア加算の根拠記録 `cc:完了` (2026-03-31)
  - 在宅ターミナルケア加算（2,500点）: 死亡日前14日以内に2回以上の訪問実績が必要
  - `death_date` + 直近14日の VisitRecord から自動判定 → `billing_eligible`
  - SSOT key: `medical.addition.terminal_care`（新規追加）
- [x] **報告書生成**: デスカンファ → `CareReport(report_type=internal_record)` 自動生成 `cc:完了` (2026-03-31)
  - 振返り記録として保存。外部送付は任意（主治医への最終報告）
  - PDF テンプレート: ケア経過タイムライン + 薬学評価 + 改善事項
- [x] **情報活用**: `cc:完了` (2026-03-31)
  - ケース終了（CaseStatus = terminated）への遷移導線
  - `improvement_actions` → Task 変換（組織レベルの改善タスク）
  - `quality_indicators` → 組織 KPI ダッシュボード（看取り実績・品質指標の蓄積）
  - `lessons_learned` → 将来の類似ケースの visit-brief に参照表示（Phase 3）

**2b-9e. 算定連携の実装詳細:**

- [x] BillingEvidence モデル拡張 `cc:完了` (2026-03-30)
  - `conference_note_ref String?` 追加（ConferenceNote.id を格納）
  - 既存パターン踏襲: `report_delivery_ref` と同様に CSV 形式で複数会議対応
- [x] SSOT ルール追加（現 `billing-rules.ts` に統合済み） `cc:完了` (2026-03-30)

  ```
  medical.conference.discharge_joint_guidance    退院時共同指導料          600点  manual  要件: 入院中共同指導+文書提供
  medical.addition.terminal_care                 在宅ターミナルケア加算    2500点  manual  要件: 死亡前14日以内に2回以上訪問
  medical.conference.emergency_joint_guidance     在宅患者緊急時等共同指導料 700点  manual  要件: 急変時の多職種共同指導
  ```

  - 既存の `medical.information_provision.2_care_manager`（20点）は担当者会議で自動候補化

- [x] `billing-evidence.ts` の `upsertBillingEvidenceForVisit` 拡張 `cc:完了` (2026-03-30)
  - 同月の ConferenceNote（`billing_eligible=true`）を検索
  - `conference_note_ref` に格納
  - 算定要件チェック: participants の attended 数、document_provided フラグ、死亡前訪問回数
  - `recommended_rule_keys` に該当ルールを追加（manual selection_mode → 手動確認）
- [x] BillingCandidate 生成 `cc:完了` (2026-03-30)
  - `dedupe_key`: `{org_id}:{patient_id}:{billing_code}:{billing_month}:{conference_note_id}`
  - `source_snapshot` に会議情報のスナップショットを保持（監査証跡）

**2b-9f. 報告書生成の実装詳細:**

- [x] `POST /api/conference-notes/[id]/generate-report` 新設 `cc:完了` (2026-03-30)
  - 入力: `{ report_type, include_structured_content, auto_send }`
  - 処理フロー:
    1. ConferenceNote + Patient + CareTeamLink を取得
    2. `report-templates.ts` に会議種別ごとのテンプレートビルダーを追加
       - `buildDischargeConferenceReport()` → PhysicianReportContent に退院時処方変更を差込み
       - `buildServiceTeamMeetingReport()` → CareManagerReportContent にサービス調整を差込み
       - `buildDeathConferenceReport()` → 内部記録テンプレート（ケア経過+評価+改善）
    3. CareReport を `draft` で作成、`generated_report_id` を ConferenceNote に書戻し
    4. `auto_send=true` の場合: participants の `is_report_recipient=true` に対して DeliveryRecord を自動生成
  - 既存の `care-reports/[id]/send` API で送付（既存フローに合流）
- [x] 報告書 → BillingEvidence の自動連動 `cc:完了` (2026-03-30)
  - 送付完了 → `report_delivery_ref` 更新 → 算定ブロッカー「報告書未送付」解消
  - 退院時共同指導: 文書提供の evidence として DeliveryRecord を参照

**2b-9g. システム内情報活用の実装詳細:**

- [x] カンファレンス → 患者データ自動反映サービス `cc:完了` (2026-03-31)
  - `src/server/services/conference-data-sync.ts` 新設
  - 会議保存時（POST/PATCH）にフック実行:

    ```
    discharge_planning:
      → MedicationIssue 起票（medication_changes_on_discharge の各変更）
      → VisitSchedule 初回訪問提案（target_discharge_date + 3日）
      → ManagementPlan 更新リマインド Task 生成
      → PatientSchedulePreference の facility_time を退院先施設から取得

    service_team_meeting:
      → VisitSchedule recurrence_rule 変更提案（service_adjustments の頻度変更）
      → MedicationIssue 起票（medication_related_items の各項目）
      → Task 生成（agreed_actions → conference-notes/[id]/tasks 既存API活用）
      → Notification 生成（next_meeting_date → 日次ジョブでリマインド）

    death_conference:
      → CaseStatus terminated 遷移提案
      → Task 生成（improvement_actions → 組織改善タスク）
      → 品質指標蓄積（quality_indicators → 月次ジョブで集計）
    ```

  - [x] pre_discharge: `medication_changes_on_discharge` から `MedicationIssue` を起票 `cc:完了` (2026-03-30)
  - [x] pre_discharge: `target_discharge_date + 3日` を優先した `VisitScheduleProposal` 起票 `cc:完了` (2026-03-30)
  - [x] pre_discharge: 管理計画書更新リマインド Task 生成 `cc:完了` (2026-03-30)
  - [x] pre_discharge: 退院先施設から `PatientSchedulePreference.facility_time` 反映 `cc:完了` (2026-03-30)
  - [x] service_manager: `VisitSchedule.recurrence_rule` 変更提案の本実装 `cc:完了` (2026-03-30)
  - [x] service_manager: `medication_related_items` から `MedicationIssue` を起票 `cc:完了` (2026-03-30)
  - [x] service_manager: `agreed_actions` から Task 生成 `cc:完了` (2026-03-30)
  - [x] service_manager: `next_meeting_date` の日次リマインド通知 `cc:完了` (2026-03-30)
  - [x] death_conference: ケース終結レビュー Task で terminated 遷移提案 `cc:完了` (2026-03-30)
  - [x] death_conference: `improvement_actions` から組織改善 Task 生成 `cc:完了` (2026-03-30)
  - [x] death_conference: `quality_indicators` を月次ジョブで集計 `cc:完了` (2026-03-30)

- [x] visit-brief への会議情報統合 `cc:完了` (2026-03-30)
  - `src/server/services/visit-brief.ts` の集約に `recent_conferences` セクション追加
  - 患者の直近30日のカンファレンス（退院前/担当者会議）を要約表示
  - 未完了の follow_up_date がある会議をハイライト
- [x] workflow ダッシュボードへの統合 `cc:完了` (2026-03-30)
  - `GET /api/dashboard/workflow` に「会議フォローアップ未完了」セクション追加
  - follow_up_date 超過 → ダッシュボードに警告

**2b-9h. カンファレンス API:**

- [x] `GET /api/conference-notes` フィルタ追加 `cc:完了` (2026-03-30)
  - `conference_type`, `patient_id`, `facility_id`, `date_from`, `date_to`, `billing_eligible`
- [x] `POST /api/conference-notes` バリデーション拡張 `cc:完了` (2026-03-30)
  - `conference_type` 必須、種別に応じた `structured_content` の Zod スキーマ検証
  - 保存時に `conference-data-sync` サービスを呼出し（情報活用フック）
- [x] `PATCH /api/conference-notes/[id]` 新設（編集対応） `cc:完了` (2026-03-30)
- [x] `POST /api/conference-notes/[id]/generate-report` 新設（報告書生成） `cc:完了` (2026-03-30)
- [x] バリデーション: `src/lib/validations/conference.ts` 新設 `cc:完了` (2026-03-30)

**2b-9i. カンファレンス UI 拡張（conferences-content.tsx）:**

- [x] 種別タブ: 全て / 退院前 / 担当者会議 / デスカンファ / その他 `cc:完了` (2026-03-30)
- [x] 種別別の作成フォーム（種別選択 → 動的フィールド表示） `cc:完了` (2026-03-30)
- [x] 参加者入力: ExternalProfessional サジェスト + 出欠チェック + 報告書送付対象チェック
- [x] 会議保存後のアクションパネル `cc:完了` (2026-03-30):
  - 「報告書を生成」ボタン → report_type 選択 → 送付先自動入力
  - 「算定候補を確認」リンク → billing candidates 画面へ遷移
  - 「フォローアップ項目」一覧 → Task / MedicationIssue / VisitSchedule への反映状態表示
- [x] カンファレンスカレンダービュー（月単位で会議一覧） `cc:完了` (2026-03-30)
- [x] 印刷/PDF 出力（退院時共同指導の文書 / 担当者会議議事録） `cc:完了` (2026-03-30)

### 2b-10. ダッシュボード リデザイン + 処方到着動線 + パフォーマンス最適化 `cc:完了` (2026-03-31)

> 2026-03-28 立案
> depends: Phase 1a（ダッシュボード基盤）, Phase 1b-1（処方受付）
> DoD: 3段レイアウト表示、処方受付→DispenseTask自動生成、Lighthouseスコア改善

**背景:** 現在のダッシュボードは「サマリーカード4枚 + 2列4セクション」の詰め込み型で見にくい。処方受付の入口が分かりにくく、DispenseTask の手動生成が必要。

**新レイアウト（3段構成）:**

| セクション                        | 内容                                                                                                                                      | データソース                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **上段: スケジュール**            | 既存 ScheduleDayView/CalendarView を `next/dynamic` で埋め込み。日/カレンダー切替タブ。CalendarView に処方未着ドット(cycle_id=null)を追加 | 既存 `GET /api/visit-schedules` をそのまま使用                        |
| **中段: パイプライン+アクション** | ワークフローパイプラインバー（受付→調剤→鑑査→セット→準備→訪問→報告の7工程件数）+ 統合アクションリスト（緊急度順、最大10件）               | 既存 workflow API の `cycleCounts` + `WorkbenchItem` パターンを再利用 |
| **下段: 患者カード一覧**          | 全アクティブ患者をリスクスコア順にカードグリッド表示。検索・ソート・ページネーション。各カードに「処方受付」ボタン                        | 既存 `listPatientRiskSummaries()` を再利用                            |

**処方到着動線の改善:**

- [x] 患者カードの「処方受付」ボタン → `/prescriptions/new?patient_id=...&case_id=...` で患者自動選択 `cc:完了` (2026-03-30)
- [x] `prescription-intakes/route.ts` POST: 疑義照会なしの場合 DispenseTask を自動生成（overall_status → dispensing） `cc:完了` (2026-03-30)
- [x] `sidebar.tsx` に「処方受付」リンク（`ClipboardPlus`, `/prescriptions/new`）追加 `cc:完了` (2026-03-30)

**パフォーマンス最適化:**

- [x] セクション分離: schedule/actions/patients を独立 `useQuery` に（1セクション遅延が全体をブロックしない） `cc:完了` (2026-03-31)
- [x] `next/dynamic` で ScheduleDayView(4700行)/CalendarView を遅延ロード `cc:完了` (2026-03-31)
- [x] セクション別 staleTime/refetchInterval（schedule:30s/60s、patients:120s） `cc:完了` (2026-03-31)
- [x] `Suspense` + セクション別スケルトンで独立描画 `cc:完了` (2026-03-31)
- [x] `loading.tsx` を3段レイアウトに合わせたスケルトンに更新 `cc:完了` (2026-03-31)

**変更ファイル:**

- 新規6: `types/dashboard-home.ts`, `api/dashboard/home/actions/route.ts`, `api/dashboard/home/patients/route.ts`, `dashboard/schedule-section.tsx`, `dashboard/actions-section.tsx`, `dashboard/patient-card.tsx`, `dashboard/patient-grid-section.tsx`
- 修正5: `dashboard/dashboard-content.tsx`(書換), `dashboard/page.tsx`, `prescription-intakes/route.ts`, `prescriptions/new/page.tsx`, `sidebar.tsx`
- 改修1: `schedules/calendar-view.tsx`（処方未着ドット+患者名表示）, `api/visit-schedules/route.ts`（cycle include追加）

**既存コード再利用:**

- `ScheduleDayView` / `CalendarView` — そのまま埋め込み（compact prop 追加のみ）
- `listPatientRiskSummaries()` — 患者カードのスコア/レベル/理由
- `listCommunicationQueue()` — アクションセクションの連絡アイテム
- `cycleCounts` (MedicationCycle groupBy) — パイプラインバー
- `WorkbenchItem` + `describeOperationalTask()` — アクションリスト
- `VISIT_TYPE_LABELS` / `SCHEDULE_STATUS_LABELS` — ラベル定数
- `OnboardingChecklist` — 変更なし（全ステップ完了で自動非表示）

**詳細設計:** `.claude/plans/temporal-strolling-spring.md` 参照

- [x] ダッシュボード情報配置の再編とグループ境界の明確化 `cc:完了` (2026-04-03)
  - 依頼内容: トップページの情報配置を見直し、当日運用・業務導線・患者確認のまとまりが視覚的に伝わるよう、順序変更と区切り線/セクション枠を導入する
  - 追加日時: 2026-04-03 08:03 JST
- [x] 全ページ向け UI/UX 指針策定と共通ページグルーピング適用 `cc:完了` (2026-04-03)
  - 依頼内容: デザイン指針を文書化し、その指針を Claude / Codex の両方が必ず参照するよう明記したうえで、全体ページに共通 scaffold を導入して情報グループを視認しやすくする
  - 追加日時: 2026-04-03 08:18 JST
- [x] Playwright による UI 配置検証と導線調整 `cc:完了` (2026-04-03)
  - 依頼内容: Playwright を使って主要画面の UI を確認し、画面配置と導線を検証したうえで、共通レイアウト検証と visual baseline 更新を行う
  - 追加日時: 2026-04-03 08:45 JST
  - 2026-04-03 追記: mobile-chromium を local config に追加し、患者一覧 / 報告書の詳細フィルタを折りたたみ化。PC では主要フィルタ優先、モバイルでは検索優先の配置へ再編
  - 2026-04-03 追記: workflow / billing の上段を判断帯へ整理し、visit detail ページも共通 scaffold と操作クラスタへ統一。患者詳細 / 訪問詳細の Playwright 検証を追加

</details>

## Phase 2c: マスター機能整備 + データリンク強化 `cc:完了`

<details>
<summary>9 subsections completed — click to expand</summary>

> 2026-03-30 立案。マスターデータの体系的整備と、マスター↔トランザクションのリンク構築。
> 出口条件: 薬局が初期設定を完了し、日常運用でマスター参照が途切れない状態。

### エンティティリンク図（施設→ユニット→患者→訪問）

```
Facility (施設)
├── FacilityUnit[] (ユニット: フロア/棟/ユニット)
│   ├── name: "2F東ユニット"
│   ├── floor: "2F"
│   └── capacity: 20
│
├── FacilityContact[] (施設連絡先)
│   └── role: "施設長" / "看護師長"
│
└── ExternalProfessional[] (関連専門職)
    └── 施設担当医/看護師/ケアマネ

Patient.Residence
├── building_id → Facility.id (FK化)
├── unit_id → FacilityUnit.id (NEW)
└── unit_name: "203号室"

VisitSchedule / FacilityVisitBatch
├── facility_id → Facility.id
├── facility_unit_id → FacilityUnit.id (NEW)
└── patient_ids → ユニット内の患者を自動グルーピング

CareTeamLink
├── facility_id → Facility.id (NEW)
└── external_professional_id → ExternalProfessional.id

PharmacySiteInsuranceConfig
└── 算定時に building_patient_count をユニット単位で計算可能に

PrescriptionIntake
├── prescriber_institution_id → PrescriberInstitution.id (NEW)
└── prescriber_institution: テキスト (後方互換)
```

### 2c-1. 施設ユニット管理 `cc:完了` (2026-03-31)

> Facility 配下にフロア/棟/ユニットの階層を追加。訪問はユニット単位で計画する。
> DoD: 施設にユニットを登録でき、患者がユニットに紐付き、訪問がユニット単位でグルーピングされること。
> 注意: 算定上の「単一建物居住者数」は建物単位が原則。ユニット単位カウントはグループホーム（3ユニット以下）のみ。

- [x] 2c-1a: FacilityUnit モデル + Residence FK + 単一建物特例ルール (`9877f2f`)
      FacilityUnit 新設、Residence.facility_id/facility_unit_id FK 追加、
      resolveBuildingPatientCount に厚労省4特例ルール実装済み
- [x] 2c-1b: VisitSchedule / FacilityVisitBatch にユニット単位のグルーピング `cc:完了` (2026-03-31)
      `facility_unit_id` 追加。同一ユニット患者を自動グルーピングして一括訪問
- [x] 2c-1c: 施設管理 UI にユニット CRUD 追加 `cc:完了` (2026-03-31)
      `/admin/facilities/[id]` にユニット一覧タブ + 患者マッピング表示
- [x] 2c-1d: 患者登録時に施設→ユニット選択 UI `cc:完了` (2026-03-31)
      Residence 入力で施設選択 → ユニット選択 → 部屋番号入力のカスケードUI

### 2c-2. 薬局運営基盤マスター `cc:完了` (2026-03-31)

> P0: 薬局が稼働するための最低限。depends: なし
> DoD: ユーザー招待/権限変更、薬局情報設定の登録/編集、休日登録が UI から完結すること。

- [x] 2c-2a: ユーザー・権限管理 UI `cc:完了` (2026-03-31)
      User/Membership の一覧/招待/権限変更/停止。Cognito 同期状態表示
- [x] 2c-2b: 薬局情報設定 API + UI (PharmacySiteInsuranceConfig) `cc:完了` (2026-03-31)
      保険種別×改定年度の config 登録/編集/有効期間管理
- [x] 2c-2c: 薬局基本情報 編集 UI (PharmacySite) `cc:完了` (2026-03-31)
      名称/住所/電話/FAX/届出フラグの編集画面
- [x] 2c-2d: 営業日・休日管理 UI (BusinessHoliday) `cc:完了` (2026-03-31)
      既存 API を使った UI 追加。カレンダービュー + 一括登録

### 2c-3. 医療機関マスター `cc:完了` (2026-03-31)

> 処方元の構造化管理。報告書宛先・疑義照会先として参照。depends: 2c-2
> DoD: 医療機関を登録でき、処方受付時に選択でき、報告書宛先として参照されること。

- [x] 2c-3a: PrescriberInstitution モデル新設 `cc:完了` (2026-03-30)
      `id, org_id, name, institution_code, address, phone, fax, notes`
- [x] 2c-3b: PrescriptionIntake.prescriber_institution_id FK 追加 `cc:完了` (2026-03-30)
      既存 `prescriber_institution` テキストとの後方互換維持
- [x] 2c-3c: CareReport 送達先に医療機関マスターを参照 `cc:完了` (2026-03-30)
      報告書の宛先選択で PrescriberInstitution を候補表示
- [x] 2c-3d: 医療機関マスター管理 UI (`/admin/institutions`) `cc:完了` (2026-03-30)
      CRUD + 処方実績の集計表示

### 2c-4. 報告・連携テンプレート拡張 `cc:完了`

> 報告書/同意書/トレレポのテンプレート管理強化。depends: 2c-3
> DoD: テンプレートにバージョン管理があり、送達ルールで自動送達先が決まること。

- [x] 2c-4a: Template モデル拡張 `cc:完了` (2026-03-31)
      `target_role, format(pdf/html), version, effective_from/to` 追加
- [x] 2c-4b: 同意書テンプレート管理 (ConsentFormTemplate) `cc:完了` (2026-03-31)
      ConsentRecord 作成時にテンプレート版を参照
- [x] 2c-4c: 文書送達ルール (DocumentDeliveryRule) `cc:完了` (2026-03-31)
      文書種別 × CareTeamLink.role → チャネル(fax/email/mcs) の自動送達ルール
- [x] 2c-4d: 通知チャネル設定の拡張 `cc:完了` (2026-03-31)
      NotificationRule に FAX/MCS チャネル追加

### 2c-5. 採用薬マスター `cc:完了`

> 自局で採用している薬品リスト + 後発品優先順位。depends: 2c-2
> DoD: 採用薬フラグで調剤候補をフィルタでき、在庫下限アラートが動作すること。

- [x] 2c-5a: PharmacyDrugStock 拡張 (採用薬フラグ) `cc:完了` (2026-03-31)
      `is_formulary, min_stock_alert, preferred_generic_drug_id` 追加
- [x] 2c-5b: 採用薬一覧 UI (`/admin/formulary`) `cc:完了` (2026-03-31)
      DrugMaster から採用薬を選択、在庫下限アラート設定

### 2c-6. 処方安全アラートルール管理 `cc:完了`

> 重複/相互作用/PIM 等のアラートの ON/OFF・閾値管理。depends: 2c-5
> DoD: アラートルールを ON/OFF でき、算定チェックが候補生成時に自動検証されること。

- [x] 2c-6a: DrugAlertRule の API 実装 `cc:完了` (2026-03-31)
      CRUD + アラートタイプ別 ON/OFF
- [x] 2c-6b: DrugAlertRule 管理 UI (`/admin/alert-rules`) `cc:完了` (2026-03-31)
      アラート種別一覧 + 閾値設定 + テスト実行
- [x] 2c-6c: 算定チェックルールの実行時検証 `cc:完了` (2026-03-31)
      BillingExclusionRules を候補生成時に自動検証

### 2c-7. 訪問計画マスター `cc:完了`

> 訪問エリア定義。depends: 2c-1
> DoD: 訪問可能エリアが定義でき、エリア外の患者登録時に警告が出ること。

- [x] 2c-7a: ServiceArea モデル新設 `cc:完了` (2026-03-31)
      `id, org_id, site_id, name, area_type(radius/polygon), geo_data(Json), notes`
- [x] 2c-7b: 新規患者登録時にエリア判定 + 警告表示 `cc:完了` (2026-03-31)
- [x] 2c-7c: 訪問エリア設定 UI (`/admin/service-areas`) `cc:完了` (2026-03-31)

### 2c-8. システム設定・監視 `cc:完了` (2026-03-31)

> 運用安定性に必要な管理機能。depends: なし
> DoD: Setting 編集とジョブ監視が管理画面から操作できること。

- [x] 2c-8a: Setting 管理 UI (`/admin/settings`) `cc:完了` (2026-03-31)
      scope 別フィルタ (org/site/user) + JSON エディタ
- [x] 2c-8b: IntegrationJob 監視 UI (`/admin/jobs`) `cc:完了` (2026-03-31)
      実行状況一覧 + エラーログ + 手動再実行

### 2c-9. マスタ起点の横展開・共有最適化 `cc:完了` (2026-03-31)

> 患者起点だけでなく、施設・他職種・処方元医療機関・送達実績を横断利用して重複入力と連絡漏れを減らす。
> DoD: 一度登録した連携先情報が、報告書送付・疑義照会・会議参加者設定・訪問計画に自動提案されること。

- [x] 2c-9a: 連携先プロファイル集約ビュー `cc:完了` (2026-03-30)
      FacilityContact / ExternalProfessional / PrescriberInstitution ごとに、
      `preferred_contact_method`, `preferred_contact_time`, `last_contacted_at`,
      `last_success_channel`, `active_patient_count`, `pending_response_count` を集約表示
- [x] 2c-9b: 処方元医療機関情報の横展開 `cc:完了` (2026-03-30)
      PrescriptionIntake で選択した PrescriberInstitution を、
      CommunicationRequest の疑義照会先、CareReport の既定宛先、
      ConferenceNote の参加者候補へ自動反映
- [x] 2c-9c: 施設運用情報の横展開 `cc:完了` (2026-03-31)
      Facility の受入時間・定期訪問曜日・主要連絡先・施設共通注意事項を、
      VisitScheduleProposal / FacilityVisitBatch / VisitBrief / ConferenceNote の初期値に反映
- [x] 2c-9d: 他職種情報の横展開 `cc:完了` (2026-03-30)
      ExternalProfessional の所属施設・専門分野・希望連絡チャネル・過去連携タイムラインを、
      CareTeamLink 選択、CareReport 送付先候補、CommunicationRequest 連絡先候補で共通利用
- [x] 2c-9e: 送達結果からの自動学習 `cc:完了` (2026-03-30)
      DeliveryRecord / CommunicationEvent の成功・失敗チャネルを集計し、
      FacilityContact / ExternalProfessional / PrescriberInstitution の
      既定連絡チャネル候補とフォールバック順に反映

</details>

## Phase 3: 外部連携・最適化・通知高度化 `cc:完了`

<details>
<summary>5 subsections completed — click to expand</summary>

> 着手条件: Phase 2 安定稼働1ヶ月以上。詳細はPhase 2完了時に策定。
> 2026-03-28 GAP分析: 各アダプタは interface contract + stub 実装済み。実接続のみ残る。

- [x] 3-1: HL7 FHIR R4 / 電子処方箋管理サービス接続 `cc:完了` (2026-03-31)
  - `src/server/adapters/e-prescription/index.ts` を env-driven HTTP 実装へ置換し、`fetchPrescription` / `searchPrescriptions` / `confirmDispense` を実装
  - `supportsSearch` / `supportsDispenseConfirmation` / `supportsPartialDispense` を `true` に切替
  - `src/server/adapters/fhir/index.ts` の `getPatient` / `getMedicationRequests` / `createMedicationDispense` を実装
  - upstream 認証情報・接続先 URL の払い出し後、そのまま接続可能な形まで実装済み
- [x] 3-2: オンライン資格確認連携 `cc:完了` (2026-03-31)
  - `src/server/adapters/qualification-check/index.ts` を env-driven HTTP 実装へ置換し、`checkInsurance` を実装
  - `supportsOnlineLookup` / `supportsBenefitHistory` / `supportsCareInsurance` を `true` に切替
  - 分析/KPI は `admin/metrics`, `admin/analytics`, `billing-evidence/analytics` まで実装済み
- [x] 3-3: 通知チャネル実接続 `cc:完了` (2026-03-31)
  - SMS: `src/server/adapters/sms/index.ts` — Twilio 実接続を実装（未設定時は安全にスキップ）
  - LINE: `src/server/adapters/line/index.ts` — LINE Messaging API 実接続を実装
  - リアルタイム: `src/server/adapters/realtime/index.ts` — channel-based publish / subscribe 実装
- [x] 3-4: パフォーマンス最適化（P95<500ms） `cc:完了` (2026-03-31)
  - 詳細プラン: `.omc/plans/phase3-4-performance-optimization.md` (Rev.2)
  - 計測基盤は実装済み（`performance.ts` + `/admin/performance`）
  - `tools/scripts/perf-smoke.ts`: `--path` 指定時のデフォルト `/api/health` 除外修正
  - `src/lib/utils/server-cache.ts`: TTL付き LRU キャッシュ新設（50エントリ）
  - `/api/dashboard/workflow`: `getHomeCareFeatureSummary` 並列化 + 3 Promise.all → 1 統合 + 15s レスポンスキャッシュ
  - `/api/patients`: `DISTINCT ON` + `ROW_NUMBER()` で enrichment 最適化、contacts → `_count`
  - `prisma/schema/visit.prisma`: composite index ×2 追加
  - `src/lib/db/client.ts`: pg pool 10 → 20（DATABASE_POOL_SIZE で設定可能）
  - TanStack Query staleTime: マスタ系 300s、スケジュール系 30s、ダッシュボード actions 30s
  - 残り: `pnpm dev` + `pnpm perf:smoke` でベースライン/最適化後の実測、Prisma マイグレーション適用
- [x] 3-5: UAT フィードバック永続化 `cc:完了` (2026-03-31)
  - `src/app/(dashboard)/admin/uat/uat-content.tsx` から `src/app/api/admin/uat-feedback/route.ts` を呼び出し、優先度・進捗・チェック項目を DB 保存
  - 保存済みフィードバック一覧を UAT 画面に表示し、実運用レビューを画面内で追跡可能化

</details>

## Phase 4: コードリファクタリング `cc:完了` (2026-03-31)

<details>
<summary>5 subsections completed — click to expand</summary>

> 重い API ルートの構造的リファクタリング。God handler 分解、重複除去、Service 層抽出。
> 詳細プラン: `.omc/plans/api-route-refactoring.md`
> depends: Phase 3 安定稼働 | 出口条件: workflow ルートが 100 行以下、共通ユーティリティ抽出済み

- [x] 4-1: 共通ユーティリティ抽出 `cc:完了` (2026-03-31)
  - `isoOrNull` → `src/lib/utils/date.ts`（3ファイル重複除去）
  - `deriveFacilityLabel` → `src/lib/utils/facility.ts`（7ファイル重複除去）
  - `batchResolveNames` → `src/lib/utils/name-resolver.ts`（6ファイル重複除去）
  - マジックナンバー定数化 → `src/lib/constants/workflow.ts`
- [x] 4-2: Workflow ダッシュボード分解 `cc:完了` (2026-03-31)
  - 型定義 → `src/types/api/workflow-dashboard.ts`
  - データ取得 → `src/server/services/workflow-dashboard-queries.ts`
  - セクションビルダー → `src/server/services/workflow-dashboard-sections.ts`（7関数）
  - ルートハンドラ: 1600行 → 50-80行
- [x] 4-3: Patients ルート改善 `cc:完了` (2026-03-31)
  - インメモリフィルタ → DB WHERE 句に移動（10+ 条件）
  - `PatientService.createWithIntake()` 抽出
  - `PatientResponseMapper` 抽出（プライバシーマスキング共通化）
- [x] 4-4: Visit-Schedules 改善 `cc:完了` (2026-03-31)
  - `ScheduleEnrichmentService` 抽出（Workflow と共有）
  - Prisma include 形状の名前付き定数化
- [x] 4-5: テスト + スナップショット検証 `cc:完了` (2026-03-31)
  - `facility` / `name-resolver` / `workflow-dashboard-sections` の単体テストを追加
  - `workflow` / `patients` / `visit-schedules` のスナップショット回帰を追加

</details>

## Phase 5: 患者情報機能改善 `cc:完了` <!-- 2026-06-11 コード監査: 全 13 タスクの実装痕跡を確認(詳細は各タスク注記) -->

> **前提**: Phase 5-PRE (PRE-01〜06) + Phase 12-1 (CI/CD) が完了していること。  
> Patient モデルはシステムの重力中心。変更は CDS・請求・報告・外部共有・オフライン・患者詳細 IA に波及する。  
> 2026-04-04 追記: UI/UX SSOT に基づき、Patient 詳細は「即時判断」「主要作業」「補助情報」の順で再編しながら段階移行する。

### 統合依存関係グラフ（フェーズ横断）

```
12-1 (CI/CD) → PRE-01〜06 (前提基盤 + UI/同期切替設計)
                    │
P-00 (現況調査)     │
 ├→ P-01 (allergy構造化 + 検査値管理基盤)  ← 最重要・最大リスク
 │    ├→ P-02 (CDS allergy改善)
 │    ├→ P-03 (検査値連携 + renal CDS改善)
 │    ├→ P-12 (患者詳細/共有 UI 再編)
 │    ├→ Phase 7-1 (SOAP wizard 検査値連携)
 │    ├→ Phase 8 (外部共有・PDF更新)
 │    └→ Phase 10 (オフライン/再接続保護)
 │
 ├→ P-04 (PatientInsurance Phase 1)
 │    └→ P-05 (PatientInsurance Phase 2: asOf 参照切替)
 │         ├→ Phase 7-2 (訪問請求プレビュー)
 │         ├→ Phase 9 (請求KPI・月次ジョブ)
 │         └→ P-12 (保険 UI current/upcoming/history)
 │
 ├→ P-06 (gender enum + QR 正規化)
 ├→ P-07 (packaging統合)
 ├→ P-08 (アーカイブ + 履歴可視性境界)
 ├→ P-09 (インテーク構造化)
 ├→ P-10 (管理計画 印刷/PDF 統一レンダリング)
 ├→ P-11 (セルフレポート GET)
 └→ P-12 (患者詳細/共有 UI 再編)
```

### 並列実行グループ

- **Wave 1** (独立・同時着手可): P-00, P-04, P-06, P-07, P-10, P-11, P-12a(UI 設計)
- **Wave 2** (Wave 1 依存): P-01 (←P-00), P-05 (←P-04), P-08, P-09
- **Wave 3** (Wave 2 依存): P-02 (←P-01), P-03 (←P-01, Phase 7-1), P-12b(UI 実装)

### 5-0. P-00: 患者モデル変更の現況調査 `cc:完了` <!-- docs/phase5-p00-investigation.md -->

- [ ] `Patient.allergy_info` カラムの実データパターン分析
  - パターン A: `string[]` — 患者登録時の `z.array(z.string())` 由来
  - パターン B: `AllergyEntry[]` — `{ drug_name, therapeutic_category, substance }` CDS 由来
  - パターン C: `{ egfr: number }` 混在 — checker.ts のハック
  - パターン D: `null`
- [ ] 検査値の現行流入元棚卸し
  - SOAP wizard の `structured_soap.objective.lab_values`
  - PDF / 報告書 / patient detail / visit brief への反映経路
  - 外部共有・オフラインキャッシュへの混入有無
- [ ] `structured_soap` 周辺の型境界棚卸し
  - `createVisitRecordSchema`
  - `soap-text-builder`
  - visit handoff
  - PDF / report generator
- [ ] `medical_insurance_number` / `care_insurance_number` 直接参照箇所の棚卸し
  - patient list / patient detail / billing preview / billing evidence / dashboard / monthly job / masking
- [ ] `packaging_preferences` と `PatientPackagingProfile` の read/write 分岐棚卸し
- [ ] QR 取込の `gender='unknown'` 流入経路の棚卸し
- [ ] 患者アーカイブ時に影響を受ける read path の棚卸し
  - schedule / visit brief / billing evidence / report generator / monthly stats / monthly job
- [ ] 患者アーカイブ時に影響を受けるジョブ/通知経路の棚卸し
  - daily.ts
  - next-day.ts
  - operational task metadata
  - notification link
- **受入条件**: 変換ルール・同期切替対象・UI 影響面が文書化されていること

### 5-1. P-01: allergy_info 構造化 + 検査値管理基盤 `cc:完了` <!-- api/patients/[id]/labs/route.ts 実装済み -->

> **最重要タスク** — allergy duck-type と `allergy_info` への eGFR 混在を廃止し、患者単位の検査値履歴と最新値参照を正本化する

**ブロッカー**: P-00 完了

#### スキーマ変更

- [ ] `allergy_info Json?` の型を明確化（Zod schema で `AllergyEntry[]` を定義）
  ```ts
  AllergyEntry {
    drug_name: string
    therapeutic_category?: string
    substance?: string
    category: 'drug' | 'food' | 'other'
    severity: 'mild' | 'moderate' | 'severe' | 'unknown'
    confirmed_at?: string
    source?: string
  }
  ```
- [ ] `PatientLabObservation` モデル新設
  ```prisma
  model PatientLabObservation {
    id                 String   @id @default(cuid())
    org_id             String
    patient_id         String
    analyte_code       LabAnalyteCode
    measured_at        DateTime
    value_numeric      Float?
    value_text         String?
    unit               String?
    abnormal_flag      String?   // high / low / critical / normal
    reference_low      Float?
    reference_high     Float?
    source_type        String    // visit_record / imported_pdf / manual / external
    source_visit_record_id String?
    note               String?
    created_at         DateTime @default(now())
    updated_at         DateTime @updatedAt
  }
  ```
- [ ] `PatientLabSnapshot` もしくは `latest_by_analyte` projection 方針を決定
  - patient detail / visit brief / CDS は履歴スキャンではなく最新値参照を使う
- [ ] `LabAnalyteCode` enum を追加
  - **初期対象項目（2026-04-04 調査ベース）**
  - 処方安全・薬学的介入で使用頻度が高い中核: `wbc`, `neut`, `hb`, `plt`, `pt_inr`, `ast`, `alt`, `t_bil`, `scr`, `egfr`, `ck`, `crp`, `k`, `hba1c`
  - 在宅療養での栄養・脱水・循環評価の拡張: `tp`, `alb`, `na`, `cl`, `bun`, `bnp`, `nt_pro_bnp`, `blood_glucose`
- [ ] `allergy_info` データ移行 SQL と `PatientLabObservation` 初期投入/逆変換手順を作成
- [ ] 既存 `VisitRecord.structured_soap.objective.lab_values` から検査値履歴を backfill
  - `measured_at` は visit_date ベース
  - source_type は `visit_record`
  - source_visit_record_id を保存
- [ ] 既存報告書 / brief / text builder が参照する検査値出力を `PatientLabObservation` / latest projection に寄せる

#### API 変更

- [ ] `createPatientSchema` / `updatePatientSchema` の `allergy_info` を `AllergyEntry[]` に変更
- [ ] `GET /api/patients/[id]` に `lab_summary`（最新値 + 測定日 + stale 判定）を追加
- [ ] `GET /api/patients/[id]/labs` — 検査値履歴一覧
- [ ] `POST /api/patients/[id]/labs` — 手入力/外部取込
- [ ] `PATCH /api/patients/[id]/labs/[labId]` — 補正・注記
- [ ] `GET /api/patients/[id]` / shared payload で `allergy_info` は表示用 formatter を通して返す
- [ ] `structured_soap` と `lab_summary` の責務分離を明文化
  - 訪問時点のスナップショットは `structured_soap`
  - 患者最新値は `PatientLabObservation` / snapshot
- [ ] `src/types/structured-soap.ts` の `LabValues` 型を対象 analyte に合わせて拡張
- [ ] `createVisitRecordSchema` との整合を取る

#### UI 変更

- [ ] `patient-master-card.tsx` のアレルギー欄を構造化入力 UI に改善
  - タグ + severity + 情報源
  - 重症アレルギーは patient summary 帯にも再掲
- [ ] 患者詳細 基本情報タブに `検査値サマリー` カード追加
  - まず `eGFR / Scr / K / CRP / HbA1c / PT-INR / Alb` を優先表示
  - stale（例: 30/90/180 日超）バッジを表示
- [ ] 患者詳細に `検査値履歴` セクションまたはタブを追加
  - 最新値一覧
  - analyte ごとの履歴テーブル
  - モバイルでは縦積みで最新値 → 履歴 CTA の順
- [ ] visit brief / visit preparation / medications で最新検査値を抜粋表示
- [ ] 検査値詳細画面で analyte 切替・時系列閲覧・異常値強調を可能にする
- [ ] disease-specific panel を用意
  - CKD: `Scr / eGFR / K / BUN`
  - 糖尿病: `HbA1c / blood_glucose`
  - 感染: `WBC / Neut / CRP`
  - 栄養: `Alb / TP / Hb`
  - 心不全: `BNP / NT-proBNP / eGFR`

#### 調査メモ（2026-04-04）

- [ ] 処方安全で薬局疑義照会に使われやすい検査値として、九州大学病院の院外処方せん表示 14 項目を初期候補に採用
  - WBC, Neut, Hb, PLT, PT-INR, AST, ALT, T-Bil, Scr, eGFR, CK, CRP, K, HbA1c
- [ ] 在宅高齢患者の栄養アセスメントで利用頻度の高い項目を拡張候補に採用
  - TP, Alb, Na, K, Cl, BUN, Cr, Hb, WBC, CRP
- [ ] 心不全在宅患者向けの拡張候補として `BNP / NT-proBNP` を disease-specific panel に追加

- **受入条件**: 患者単位で検査値の最新値と履歴を保持でき、`allergy_info` から eGFR を読むコードが消えること

### 5-2. P-02: CDS checkAllergyReactions 改善 `cc:完了` <!-- src/server/cds/checker.ts:758、allergy_cross 種別+severity 対応 -->

**ブロッカー**: P-01 完了

- [ ] `AllergyEntry.severity` による重み付け
  - `severe` → critical
  - `moderate` → warning
  - `mild` → info
- [ ] `AllergyEntry.category` によるマッチ精度向上
  - `drug` のみ薬効分類マッチ対象
  - `food` / `other` は自由記述アラート
- [ ] `CdsAlertPanel` の表示に severity バッジ反映
- [ ] patient detail のサマリー帯に「重症アレルギーあり」を表示
- **受入条件**: 既存アラートルールとの整合性維持、checker / UI テスト追加

### 5-3. P-03: 検査値連携 + CDS renal / monitoring 改善 `cc:完了` <!-- checker.ts egfr_min/max(L71-72,193)、qr-lab-promotion -->

**ブロッカー**: P-01 完了、Phase 7-1 の structured SOAP 連携方針確定

- [ ] `buildStructuredSoap` が wizard の検査値入力を破棄しないよう修正方針を確定
- [ ] `visit-record-form` で入力した検査値を `PatientLabObservation` へ反映
  - 案A: 訪問記録保存時に自動同期
  - 案B: 差分確認ダイアログ付きで同期
- [ ] `createVisitRecordSchema` / `structured_soap` に検査値項目の型境界を設ける
  - `lab_values` の許可項目
  - 数値/単位の正規化
- [ ] `StructuredSoap.LabValues` と form / persistence / text builder の型差分を解消
- [ ] `checkRenalDoseAdjustment` は `latest analyte = egfr` を直接参照
- [ ] `renal_dose` 以外にも検査値ベース alert の拡張余地を設計
  - `pt_inr` × 抗凝固薬
  - `k` × 利尿薬/RAA 系
  - `crp / wbc` × 感染フォロー
- [ ] `visit-record-form.tsx` の `VISIT_RECORD_ALERT_TYPES` と patient summary 帯の表示整合を取る
- [ ] `soap-text-builder` / visit handoff / report template で新しい検査値候補の表示戦略を決める
- **受入条件**: 最新検査値が visit record → patient summary → CDS に一貫反映されること

### 5-4. P-04: PatientInsurance モデル新設 (Phase 1) `cc:完了` <!-- prisma/schema/patient.prisma:434 -->

#### スキーマ

- [ ] `PatientInsurance` モデル新設
  ```prisma
  model PatientInsurance {
    id                String   @id @default(cuid())
    org_id            String
    patient_id        String
    insurance_type    InsuranceType  // medical, care, public_subsidy
    insurer_number    String?
    symbol            String?
    number            String?
    branch_number     String?
    copay_ratio       Int?
    valid_from        DateTime? @db.Date
    valid_until       DateTime? @db.Date
    is_active         Boolean  @default(true)
    notes             String?
    created_at        DateTime @default(now())
    updated_at        DateTime @updatedAt
  }
  ```
- [ ] `InsuranceType` enum: `medical`, `care`, `public_subsidy`
- [ ] Prisma マイグレーション + RLS ポリシー
- [ ] 既存 `medical_insurance_number` / `care_insurance_number` からのデータ移行スクリプト

#### API

- [ ] `GET /api/patients/[id]/insurance` — 保険情報一覧
- [ ] `POST /api/patients/[id]/insurance` — 保険追加
- [ ] `PUT /api/patients/[id]/insurance/[insuranceId]` — 期間・番号更新
- [ ] 既存履歴を消さずに current/upcoming/history を更新する契約にする
- [ ] `resolvePatientInsurance(patientId, type, asOf)` / `resolvePatientPayerBasis(patientId, asOf, visitType)` ヘルパー作成
- [ ] `patient-service.ts` の新規患者作成で `PatientInsurance` を同時作成する

#### UI

- [ ] 患者詳細 基本情報タブに `保険情報` を再設計
  - `現在有効`
  - `次回適用予定`
  - `履歴`
- [ ] 患者登録フォームに保険入力セクション追加
  - current の最小入力
  - history は後編集
- [ ] 保険情報カードは flat 2項目ではなく、期限・負担割合・種別バッジを持つ意味グループ化 UI にする

- **受入条件**: `asOf` ベースの解決関数を通じて current/upcoming/history を扱えること

### 5-5. P-05: PatientInsurance 既存参照切替 (Phase 2) `cc:完了` <!-- patients API で参照。insurance/[insuranceId] API も存在 -->

**ブロッカー**: P-04 完了

- [ ] `billing-payer-basis` の参照切替
- [ ] `billing-evidence/core.ts` の参照切替
- [ ] `visit-schedule-billing-preview.ts` の参照切替
- [ ] `visit-schedule-proposals` の参照切替
- [x] `visit-schedules/generate` から `insurance_type` クライアント入力依存を撤廃 `cc:完了` (2026-06-15: 候補日ごとに PatientInsurance から payer basis を解決して上限判定)
  - サーバー側で patient insurance を解決して上限判定
- [ ] `patient-service.ts` の `payer_basis` フィルタ切替
- [ ] `patient-service.ts` の create/update で旧列ではなく `PatientInsurance` を書き込む
- [ ] 患者一覧テーブル / patient detail / privacy masking / dashboard monthly stats / monthly job の参照切替
- [ ] `Patient.medical_insurance_number` / `care_insurance_number` を Phase 5 cutover で参照停止し、削除時期を確定する
- [ ] 回帰テスト追加
  - patient list filter
  - patient detail badges / visits tab
  - billing preview / billing evidence
  - monthly stats / monthly job
- **受入条件**: 全画面・集計・請求が同じ `asOf` 解決ロジックで動作すること

### 5-6. P-06: gender String → Enum 化 + QR 正規化 `cc:完了` <!-- enum Gender(patient.prisma:1, L108) -->

- [ ] `Gender` enum 追加: `male`, `female`, `other`
- [ ] Prisma マイグレーション: `ALTER COLUMN "gender" TYPE "Gender" USING ...`
- [ ] QR 取込の `unknown` を cutover 時点で `other` に正規化
- [ ] `patients/check-duplicate` / patient form / qr-scan / medications のラベル整合を取る
- [ ] TypeScript 型の整合確認
- **受入条件**: QR 由来患者登録が壊れず、UI 上の表記ゆれがないこと

### 5-7. P-07: packaging_preferences 二重管理解消 `cc:完了` <!-- packaging_preferences フィールドは撤去済み(grep 0 件)、patients/[id]/packaging API に一本化 -->

- [ ] **設計決定**: `PatientPackagingProfile` に一本化、`Patient.packaging_preferences` Json を廃止
- [ ] `PatientPackagingProfile` を拡張
  - `box_config`
  - `special_instructions`
  - `cognitive_note`
- [ ] 新規患者作成 / 患者更新 API / set-plan / set-batches / packaging summary を `PatientPackagingProfile` 参照へ一括切替
- [ ] backfill 完了後に `Patient.packaging_preferences` カラム削除
- **受入条件**: set-plan / dispensing / patient detail で表示差分なく移行できること

### 5-8. P-08: 患者アーカイブ（論理削除） `cc:完了` <!-- api/patients/[id]/archive/route.ts + patient-detail-tabs の archiveMutation/ConfirmDialog -->

#### 設計決定（実装前に確定）

- [ ] 「通常一覧では非表示」「履歴請求・印刷・既存訪問・月次集計では参照可能」の境界を決める
- [ ] 方式選定: RLS ポリシーに `archived_at IS NULL` 組込み vs Prisma middleware
  - **推奨**: RLS を基本にしつつ、履歴系 read path は includeArchived 可能にする
- [ ] アーカイブ時の関連エンティティ処理
  - CareCase
  - VisitSchedule
  - BillingEvidence
  - report generator
  - monthly stats / monthly job
  - daily job
  - next-day job
  - operational task / notification link

#### UI / UX

- [ ] 患者一覧に `アーカイブ済み含む` フィルタ + 状態バッジ追加
- [ ] 患者詳細に `アーカイブ中` バナー + read-only 表示 + 復元 CTA を追加
- [ ] スケジュール / visit brief / shared links にアーカイブ患者の識別子を表示
- [ ] モバイルでも順序を変えず、通常患者との区別が一目で分かる表現にする

#### 実装

- [ ] `Patient` に `archived_at DateTime?`, `archived_by String?` 追加
- [ ] `PATCH /api/patients/[id]/archive` / `PATCH /api/patients/[id]/restore`
- [ ] `withOrgContext` に `includeArchived` オプション追加
- [ ] plain `prisma.find*` 経路も含めて履歴系の archived 参照方針を統一
- [ ] `daily.ts` / `next-day.ts` の patient read path と通知リンクをアーカイブ耐性化
- **受入条件**: 通常運用では隠れ、履歴/請求/印刷/集計では落ちないこと

### 5-9. P-09: インテークデータ構造化 `cc:完了` <!-- patient.prisma:340 structured intake columns -->

- [ ] `PatientSchedulePreference` に専用カラム追加
  - `adl_level String?`
  - `dementia_level String?`
  - `swallowing_route String?`
  - `care_level String?`
  - `infection_isolation Boolean @default(false)`
- [ ] `CareCase.required_visit_support` Json 内の重複データとの整合ルール決定
- [ ] 既存 `patientIntakeSchema` の該当フィールドとマッピング
- [ ] `patient-intake-summary-card.tsx` を専用カラムから読み取りに変更
- [ ] 表示グループを再設計
  - 訪問条件
  - 介護・生活背景
  - 感染/医療注意
- [ ] 患者一覧での ADL / 認知症レベルフィルタ追加（任意）
- **受入条件**: インテーク表示が構造化され、患者詳細で上から順に判断できること

### 5-10. P-10: ManagementPlan 印刷 / PDF の構造化レンダリング統一 `cc:完了` <!-- api/management-plans/[id]/pdf + pdf-documents.tsx -->

- [ ] `ManagementPlan.content` の型定義策定
  ```ts
  ManagementPlanContent {
    goals: string[]
    assessment_items: AssessmentItem[]
    guidance_content: string
    monitoring_items: string[]
    special_notes?: string
  }
  ```
- [ ] Zod schema 作成
- [ ] `management-plan/print/page.tsx` の `JSON.stringify` を廃止
- [ ] `pdf-documents.tsx` 側の管理計画レンダラも同じセクション順に揃える
- [ ] 画面版 / 印刷版 / PDF で見出し順を統一
- **受入条件**: どの出力面でも同じ情報階層で読めること

### 5-11. P-11: GET /api/patient-self-reports/[id] 追加 `cc:完了` <!-- route.ts:32 -->

- [ ] `src/app/api/patient-self-reports/[id]/route.ts` に GET ハンドラ追加
- [ ] 既存テストファイルの仕様確認・整合
- [ ] プライバシーマスキング適用
- [ ] patient detail / communications から単票参照できる導線を追加
- **受入条件**: 既存 PATCH と同じ認可チェック、テスト通過

### 5-12. P-12: 患者詳細 / 共有 UI 再編 `cc:完了` <!-- patient-detail-tabs(タブ+患者ハブ+2026-06-11 ワークスペース右レール追加)、shared-viewer -->

> UI/UX SSOT に従い、Patient 詳細・患者編集・外部共有を「即時判断」「主要作業」「補助情報」の順に再設計する

#### 情報設計

- [ ] 患者詳細画面の IA 再設計
  - ヘッダー
  - サマリー帯
  - 詳細タブ/主要作業
  - 補助情報/履歴
- [ ] サマリー帯に優先表示する情報を定義
  - 重症アレルギー
  - 最新検査値（eGFR, K, CRP, HbA1c, PT-INR, Alb）
  - 現在有効な保険
  - アーカイブ状態
- [ ] patient master 編集は 1 枚の巨大フォームではなく意味グループに分割
  - 基本属性
  - 連絡/住所
  - 保険
  - アレルギー
  - 補助メモ
- [ ] shared viewer は内部 key 表示ではなく利用者向け表示名へ変換
- [ ] `allergy_info` / lab summary / insurance summary の共有用 formatter を設計

#### Cutover UX

- [ ] オンライン復帰時の hard reload による患者編集ロストを避ける
  - `reloadOnOnline` 対策を Phase 10 待ちにせず患者編集導線の前提条件へ格上げ

#### モバイル / 画面横断

- [ ] モバイルでは順序を変えず縦積みする
- [ ] schedule / patient list / visit brief に patient state badge を揃える
- [ ] print / PDF / shared / dashboard の患者要約表現を統一
- [ ] schedule / day-view / jobs が使う patient summary 契約を定義
  - patient name
  - archived badge
  - insurance summary
  - critical allergy / lab flags
- [ ] `schedule-includes.ts` / `day-view.shared.ts` / `day-view.tsx` の DTO 拡張タスクを明記
  - patient summary 契約に必要な項目を select へ追加
  - day-view の badge / summary 表示へ反映
- [ ] `shared-viewer` は raw JSON 表示を廃止し、利用者向け表示名と説明へ変換
- [ ] `soap-text-builder` / PDF / shared formatter の共通ヘルパー化方針を決める

- **受入条件**: 患者詳細・共有・印刷で情報階層が揃い、追加項目が「項目追加」ではなく意味グループとして読めること

---

## Phase 6: 処方・調剤ワークフロー改善 `cc:完了` <!-- 2026-06-11 コード監査: 全 7 タスク実装済み(dispense-form 疑義照会導線、qr-drafts/[id] packaging_method 送信 L207、generate-batches Math.ceil L261、inquiry_resolved 表示、unmatched フィルタ L197、reject-reason-stats API、inquiry status フィルタ) -->

> 処方受付→調剤→鑑査→セットの日常業務フローの品質・効率改善

### 6-1. 調剤中からの疑義照会起票 `cc:完了`

- [ ] `dispensing/[taskId]/dispense-form.tsx` に「疑義照会を起票」ボタン追加
- [ ] `POST /api/inquiry-records` を調剤画面から直接呼出し（API側は対応済み）
- [ ] 起票後に該当明細を `blockedInquiryByLineId` に自動追加
- **受入条件**: 調剤中に疑義照会を起票→部分調剤保存→解決後に再開できること

### 6-2. QRドラフト確定時の packaging_method 送信修正 `cc:完了`

- [ ] `qr-drafts/[id]/page.tsx` L285-300: 確定ペイロードに `packaging_method` を含める
- [ ] `packaging_instruction_tags` も同様に送信
- **受入条件**: QR経由のセット計画で packaging_method が正しく設定されること

### 6-3. セットバッチ quantity_per_slot 小数丸め処理 `cc:完了`

- [ ] `set-plans/[id]/generate-batches/route.ts` L251-254: 小数発生時に切り上げ or 薬剤師確認フラグ
- [ ] 一包化薬で 0.5 錠等の非現実的値を防止
- **受入条件**: 3錠/2スロット → 適切な分配ルールが適用されること

### 6-4. 疑義照会解決→調剤再開の自動誘導 `cc:完了`

- [ ] `inquiry_resolved` 状態のサイクルに対するタスク生成 or 通知
- [ ] 調剤一覧での `inquiry_resolved` サイクル表示（「調剤再開可」バッジ）
- **受入条件**: 疑義照会解決後に調剤担当者が即座に再開できること

### 6-5. QRドラフト一覧の未照合患者フィルタ `cc:完了`

- [ ] `GET /api/qr-scan-drafts?unmatched=true` クエリパラメータ追加
- [ ] 一覧に「未照合」フィルタタブ + 件数バッジ
- **受入条件**: 未照合ドラフトを一覧レベルで即座に把握できること

### 6-6. 鑑査差戻し理由のコード体系化 `cc:完了`

- [ ] `reject_reason` にコード値追加（`drug_name_mismatch`, `quantity_error`, `packaging_error` 等）
- [ ] フリーテキスト補足も維持（`reject_reason_code` + `reject_reason_detail`）
- [ ] 差戻し理由の集計ダッシュボード（admin）
- **受入条件**: 月次で差戻し理由別件数を集計できること

### 6-7. 疑義照会 status フィルタ + line_update フィールド拡張 `cc:完了`

- [x] `GET /api/inquiry-records?status=unresolved` フィルタ追加
- [ ] `line_update` に `drug_code`, `packaging_instructions`, `route` を追加
- **受入条件**: ダッシュボードで未解決疑義照会件数を効率的に取得できること

---

## Phase 7: 訪問・スケジュールワークフロー改善 `cc:完了` <!-- 2026-06-11 コード監査: 全 6 タスク実装済み(buildStructuredSoap wizard 組立 L228、specialCapEligible 受渡 L169/391、facility-visit-batches DELETE L26/PATCH L83、superRefine L75、ROUTING_API_PROVIDER 切替、checklist-template) -->

> 訪問計画→実施→記録の品質改善。SOAP構造化データの実効性確保が最重要。

### 7-1. buildStructuredSoap の wizard 入力反映修正 ★Critical `cc:完了`

- [ ] `visit-record-form.tsx` L140-161: `buildStructuredSoap` を wizard state から組立てに変更
- [ ] `symptom_checks`, `adherence_score`, `side_effect_checks`, `problem_checks`, `intervention_checks` を実データで送信
- [ ] PDF/報告書テンプレートでの adherence_score/intervention 展開が正しく動作確認
- **受入条件**: ウィザードで入力した構造化SOAPデータがDBに保存・PDF出力されること

### 7-2. specialCapEligible の初期バリデーション渡し `cc:完了`

- [ ] `visit-schedule-proposals/route.ts` L308-315: `specialCapEligible` を `validateProposalBillingExclusions` に渡す
- [ ] 特定加算患者の月8回上限チェックが正しく動作
- **受入条件**: 麻薬/TPN/CV ポート患者の月上限が正しく適用されること

### 7-3. 施設バッチ DELETE API + ユニット横断対応 `cc:完了`

- [ ] `DELETE /api/facility-visit-batches/[id]` — バッチ解除
- [ ] `PATCH /api/facility-visit-batches/[id]` — 順序のみ部分更新
- [ ] `mixed_facility_unit` エラーのオプション許容パラメータ追加
- **受入条件**: 施設バッチの作成・並替・解除・ユニット横断が一通り動作すること

### 7-4. SOAP 完了時バリデーション追加 `cc:完了`

- [ ] `outcome_status: 'completed'` 時に S or P のいずれかに入力必須
- [ ] `visit-record.ts` に条件付き superRefine 追加
- **受入条件**: 空SOAPでの完了保存がブロックされること

### 7-5. ルーティングプロバイダ抽象化 `cc:完了`

- [ ] `road-routing.ts` に `RoutingProvider` インターフェース追加
- [ ] `OsrmProvider` / `GoogleRoutesProvider` 実装
- [ ] `ROUTING_API_PROVIDER` 環境変数で切替
- **受入条件**: OSRM → Google Routes API への切替がコード変更なしで可能

### 7-6. 訪問準備チェックリストのテンプレート化 `cc:完了`

- [ ] `checklist: z.record(...)` → org/facility レベルのテンプレートから生成
- [ ] 感染対策・麻薬持参等の施設固有チェック項目を追加可能に
- **受入条件**: 施設ごとにカスタムチェック項目が設定・表示されること

---

## Phase 9: 請求・管理機能改善 `cc:完了` <!-- 2026-06-11 コード監査: 全 5 タスク実装済み(SAMPLE_LOGS 削除済、nextCursor/hasMore 使用、facilities ConfirmDialog L803、検索スコープ staff/tasks/facility/visit 拡張、billing-kpi-section) -->

> 管理系の silent failure 解消と運用効率改善

### 9-1. 監査ログのサンプルデータ表示バグ修正 ★Critical `cc:完了`

- [ ] `audit-logs-content.tsx` L115-122: API 404 時の `SAMPLE_LOGS` フォールバック削除
- [ ] 代わりに「ログがありません」の EmptyState 表示
- **受入条件**: 本番環境でサンプルデータが表示されないこと

### 9-2. 請求候補のページネーション実装 `cc:完了`

- [ ] `billing-candidates-content.tsx` L216: `limit=100` → cursor ベースの無限スクロール or ページネーション
- [ ] API の `hasMore` / `nextCursor` をUI で使用
- [ ] 候補テーブルに患者名カラム追加
- **受入条件**: 100件超の候補が正しく表示されること

### 9-3. 施設削除の確認ダイアログ追加 `cc:完了`

- [ ] `facilities-content.tsx` L388: `deleteMutation.mutate()` 直呼出し → 確認ダイアログ挟む
- **受入条件**: マスタデータ削除前に確認が必須

### 9-4. グローバル検索の検索スコープ拡張 `cc:完了`

- [ ] 処方、訪問記録、施設、スタッフ、タスクを検索対象に追加
- [ ] 結果のキーボードナビゲーション（矢印キー）
- [ ] カテゴリ別「すべて表示」リンク
- **受入条件**: Cmd+K で患者・薬剤以外のエンティティも検索できること

### 9-5. ダッシュボードに請求 KPI 追加 `cc:完了`

- [ ] 当月請求候補数、未確定数、ブロッカー数の表示
- [ ] `delivery_incomplete` / `not_claimable` カウンタのUI表示
- **受入条件**: メインダッシュボードから請求状況が一目で把握できること

---

## Phase 11: セキュリティ・コンプライアンス強化 `cc:完了` <!-- 2026-06-11 コード監査+実装: 全 10 件完了。11-8 は本番のみ専用シークレット必須化(非本番は NEXTAUTH_SECRET フォールバック維持で test/E2E 互換) -->

> 3省2ガイドライン準拠の残ギャップ解消。HIGH 4件 + MEDIUM 6件。

### 11-1. x-org-id ヘッダーのサーバー検証 ★HIGH `cc:完了`

- [x] `src/lib/auth/context.ts:149-176` で x-org-id をセッション org_id と照合、membership 検証付きでマルチ org 切替のみ許可
- [x] JWT に orgId クレーム埋込(`config.ts:147,180`)

### 11-2. オフライン PHI 暗号鍵の保護強化 ★HIGH `cc:完了`

- [x] `src/lib/offline/crypto.ts:120-125` で `extractable: false`、IndexedDB 保存(L70-84)、ログアウト時削除(L157-166)。localStorage 不使用

### 11-3. レート制限の DynamoDB バックエンド必須化 ★HIGH `cc:完了`

- [x] `src/lib/api/rate-limit.ts:413-425` で本番 DynamoDB 未設定時に DenyAllRateLimitStore(拒否)
- [x] 認証エンドポイント 5回/分(`RATE_LIMIT_AUTH_MAX`, L36)

### 11-4. 外部共有 OTP の bcrypt ハッシュ化 ★HIGH `cc:完了`

- [x] `src/app/api/external-access/route.ts:348` で `bcrypt.hash(rawOtp, 12)`

### 11-5. Cognito トークンリフレッシュ実装 `cc:完了`

- [x] `src/lib/auth/config.ts:152-171` で有効期限チェック + refreshToken 更新、失効時 RefreshAccessTokenError

### 11-6. session_version のリクエスト毎検証 `cc:完了`

- [x] `src/lib/auth/context.ts:129-147` で User.session_version と JWT クレーム照合(mismatch→401)
- [x] `api/me/logout-all/route.ts:17-28` で session_version インクリメント

### 11-7. 一括薬歴 PDF エクスポートの監査ログ追加 `cc:完了`

- [x] `src/server/services/pdf-bulk-export.ts:592,815` で `recordDataExportAudit`(actorId/orgId/patientIds/IP)

### 11-8. 外部アクセストークンの専用シークレット必須化 `cc:完了`

- [ ] `external-access.ts:357` の `EXTERNAL_ACCESS_TOKEN_SECRET ?? NEXTAUTH_SECRET` フォールバック廃止 → 専用シークレット必須
- **受入条件**: `EXTERNAL_ACCESS_TOKEN_SECRET` 未設定時にエラー

### 11-9. 監査ログエクスポートの行数制限 `cc:完了`

- [x] `src/app/api/audit-logs/export/route.ts:58-64` で EXPORT_LIMIT=10000 + truncated 警告ヘッダー(L97,146)

### 11-10. dangerouslySetInnerHTML の監査・DOMPurify 導入 `cc:完了`

- [x] 2026-06-11 監査: `dangerouslySetInnerHTML` の使用箇所ゼロを確認 → DOMPurify 導入不要(新規使用時に再評価)

---

## Phase 13: テスト・品質基盤強化 `cc:完了` <!-- 2026-06-11 コード監査: 全 5 タスク実装済みを確認 -->

> テストカバレッジ拡大と E2E の信頼性向上

### 13-1. E2E 認証フロー追加 `cc:完了`

- [x] ログイン → MFA → パスワードリセットの E2E spec(`tools/tests/e2e-auth-flow.spec.ts`)

### 13-2. E2E 請求ワークフロー追加 `cc:完了`

- [x] 候補生成 → 確認/除外 → エクスポートの E2E spec(`tools/tests/e2e-billing-flow.spec.ts`)

### 13-3. E2E 処方受付→調剤完了フロー追加 `cc:完了`

- [x] QR スキャン → ドラフト確定 → 調剤 → 鑑査の E2E spec(`tools/tests/e2e-prescription-dispensing-flow.spec.ts`)

### 13-4. カバレッジ閾値の強化 `cc:完了`

- [x] `vitest.config.ts:18-24` で statements/branches/lines/functions の閾値設定済み
- [x] `qr-scan-drafts/[id]/route.test.ts` 存在確認済み

### 13-5. E2E 並列実行化 `cc:完了`

- [x] `playwright.config.ts:21` で `fullyParallel: true`、`:24` で CI `workers: 4` 設定済み

---
