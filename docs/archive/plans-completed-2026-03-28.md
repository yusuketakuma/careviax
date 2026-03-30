# CareViaX Plans — Archived Completed Tasks (2026-03-28)

> Archived from Plans.md. These tasks are fully implemented and committed.

---

## 直近トラック: 訪問支援・処方/調剤・共有要約 `cc:完了`
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

---

### 0-1. プロジェクト初期化 `cc:完了`
> DoD: `pnpm dev` 起動、`pnpm build` 成功、CI green、AWS全サービス接続確認

- [x] Next.js 16 + TypeScript 6 + React 19, pnpm, ESLint 10, Prettier 3, Tailwind CSS 4 + shadcn/ui
- [x] shadcn/ui 医療テーマ: ブルーグレー配色、コントラスト4.5:1+、zebra stripe テーブル（CLAUDE.md デザイン方針準拠）
- [x] AWS: IAM, RDS PostgreSQL(Multi-AZ, KMS), Cognito(MFA/TOTP, 13文字+, ロックアウト), S3(Object Lock), SES, Amplify Hosting(東京固定)
- [x] Prisma 7（RDS接続）, NextAuth v5 + Cognito, Serwist 9 PWA
- [x] `.env.example`, Vitest 4, Playwright, セキュリティヘッダー, CI(GitHub Actions), IaC(AWS CDK)

---

### 0-2. データモデル全体（Prisma Schema） `cc:完了`
> depends: 0-1 | DoD: `prisma migrate deploy` 成功、全テーブル作成、シード完了
> ※ 全テーブル同時マイグレーション。グループ分けは設計整理用。Prisma multi-file schema（prisma/schema/*.prisma）でファイル分割。

**0-2a. 組織・利用者・薬局運営系:**
- [x] Organization, PharmacySite（届出フラグ・体制加算区分・薬局住所座標 lat/lng）, User（Cognito連携）
- [x] Membership（role ENUM 7種 + can_dispense/can_audit_dispense/can_set/can_audit_set フラグ）
- [x] FacilityStandardRegistration（施設基準届出管理: 届出種別, 届出日, 有効期限, 更新期限アラート, 要件達成状態JSON）
- [x] PharmacistCredential（かかりつけ薬剤師要件: 研修認定証, 有効期限, 在籍継続年数, 週勤務時間実績）
- [x] PharmacistShift（薬剤師訪問可否: date, pharmacist_id, available BOOLEAN, available_from/to, note）

**0-2b. 患者・案件系:**
- [x] Patient（請求支援フラグ含む）, CareCase, Residence（building_id/unit_name/住所座標 lat/lng）
- [x] ContactParty, CareTeamLink, ConsentRecord
  - ConsentRecord: 同意種別（訪問薬剤管理/個人情報取扱/外部共有/写真撮影）、取得方法（紙署名スキャン/デジタル）、取得日、有効期限、撤回日
  - 同意撤回時: ケース終了判定 + データ保持ポリシー（法定保存期間中は保持、閲覧制限フラグ付与）
  - 同意の有効期限管理: 期限切れ前リマインド、未取得→訪問不可アラート
- [x] ManagementPlan（薬学的管理指導計画書、版管理、月次更新）

**0-2c. 処方箋応需・調剤・セット系:**
- [x] MedicationCycle（overall_status 14段階）
  - visit/readiness/reporting の派生状態を計算するための sub_status 群を追加
  - on_hold に潰さない例外状態: no_show / hospitalized / refused_receipt / awaiting_reply / report_failed / carry_items_partial
  - 状態遷移マトリクス（ステートマシン定義）:
    - 許可遷移ルール: from→to のペア + 実行可能ロール + 必須条件（例: dispensed→audited は鑑査ロールのみ）
    - 遷移時副作用: 通知生成、タスク起票、carry_items更新、BillingEvidence生成のトリガー定義
    - 不正遷移のブロック（API層でバリデーション）+ 監査ログ記録
- [x] PrescriptionIntake（source_type: paper/fax/e_prescription/facility_batch/refill）
  - refill_remaining_count, refill_next_dispense_date（リフィル処方箋管理）
  - split_dispense_total/split_dispense_current（分割調剤管理）
  - prescription_expiry_date（有効期限: 発行日+4日）
- [x] PrescriptionLine（薬剤・規格・用法・日数・包装指示・一般名/後発品フラグ）
- [x] InquiryRecord（疑義照会: 照会内容、照会先医師、照会結果、処方変更内容、照会日時）
- [x] DispenseTask, DispenseResult, DispenseAudit
- [x] SetPlan, SetBatch, SetAudit
- [x] WorkflowException

**0-2d. スケジュール・訪問系:**
- [x] VisitSchedule（cycle_id, case_id, visit_type, scheduled_date/time_window, pharmacist_id, route_order, carry_items, pre_visit_checklist_completed）
  - visit_type: initial/regular/temporary/revisit/delivery_only/emergency/physician_co_visit
  - schedule_status: planned/in_preparation/ready/departed/in_progress/completed/cancelled/postponed/rescheduled/no_show
  - recurrence_rule（定期訪問: 月2回第1・第3火曜等のRRULE形式）
  - facility_batch_id（施設一括訪問のグループID）
  - time_constraint_start/end（施設受入時間帯・患者在宅時間帯）
  - medication_start_date / medication_end_date（服用開始日/服用最終日 — 処方内容から自動計算）
  - visit_deadline_date（訪問期限日 — 原則として服用最終日以前。超過時はアラート）
- [x] FacilityVisitBatch（facility_id, scheduled_date, pharmacist_id, patient_ids[], estimated_duration, route_from_pharmacy）
  - 施設一括訪問: 同一施設の複数患者をまとめて計画・実行
- [x] VisitRecord（SOAP構造化, 受領記録, next_visit_suggestion_date）
  - outcome_status: completed/revisit_needed/postponed/cancelled/delivery_only/completed_with_issue
  - cancellation_reason / postpone_reason / revisit_reason を構造化保持
- [x] VisitPreparation（schedule_id, checklist JSON, medication_changes_reviewed, carry_items_confirmed, previous_issues_reviewed, prepared_at, prepared_by）
  - 訪問前準備チェックリスト: 持参薬確認/処方変更確認/前回課題確認/ルート確認

**0-2e. 医薬品マスタ系（厚労省/PMDA/SSK公開データ）:**
- [x] DrugMaster（医薬品マスタ本体）:
  - yj_code（12桁）, receipt_code（レセ電9桁）, hot_code（HOT13桁）, jan_code
  - drug_name, drug_name_kana, generic_name, drug_price, unit, dosage_form
  - therapeutic_category（薬効分類4桁）, manufacturer
  - is_generic BOOLEAN, is_narcotic BOOLEAN, is_psychotropic BOOLEAN
  - max_administration_days（投与日数制限）
  - transitional_expiry_date（経過措置期限）
  - データソース: SSK基本マスター（CSV/ZIP, 無料, ssk.or.jp）
- [x] DrugPackageInsert（添付文書情報）:
  - drug_master_id, contraindications JSON, interactions JSON, adverse_effects JSON
  - dosage_adjustment_renal JSON, precautions_elderly JSON
  - document_version, revised_at, source_format ENUM(xml/sgml/pdf)
  - データソース: PMDA添付文書XML（メディナビ経由一括DL, 無料）
- [x] DrugInteraction（相互作用マスタ）:
  - drug_a_id, drug_b_id, severity ENUM(contraindicated/caution/minor), mechanism, clinical_effect
  - source ENUM(pmda_xml/kegg/manual)
  - データソース: PMDA添付文書XMLの併用禁忌/注意セクションをパース
- [x] DrugAlertRule（CDSアラートルール）:
  - alert_type ENUM(interaction/duplicate/allergy_cross/renal_dose/pim_elderly/high_risk/narcotic/max_days)
  - condition JSON, severity, message
  - ハイリスク薬: 厚労省 特定薬剤管理指導加算対象（薬効分類コードでマッピング）
  - 高齢者PIM: 厚労省 高齢者の医薬品適正使用の指針（PDF→構造化、手動初期投入）
  - 腎機能用量調整: JSNP 投与量一覧 第37版（PDF→構造化、手動初期投入）
- [x] PharmacyDrugStock（在庫医薬品マスタ — テナント別）:
  - site_id, drug_master_id, is_stocked BOOLEAN, stock_qty（概算在庫数）, reorder_point
  - last_dispensed_at, preferred_generic_id（当薬局の採用後発品）
  - 用途: 調剤時に「当薬局に在庫がある薬剤」のみフィルタ表示、欠品時の代替候補提示、一般名処方→採用後発品の自動選択
  - 在庫数は概算管理（厳密な在庫管理はレセコン/在庫システムの責務。CareViaXは訪問調剤の実務支援に絞る）
- [x] GenericDrugMapping（一般名→後発品対応表）:
  - generic_name, brand_drug_ids[], price_comparison
  - データソース: 厚労省 一般名処方マスタ（Excel, 無料）+ 薬価基準収載品目リスト
- [x] DrugMasterImportLog（取込履歴）:
  - source ENUM(ssk/pmda/mhlw_price/mhlw_generic/hot), imported_at, record_count, status, error_log

**0-2f. 薬学管理系:**
- [x] MedicationProfile, ResidualMedication（減数調剤対応、禁止薬剤フラグ）
- [x] MedicationIssue, Intervention, Task
- [x] FirstVisitDocument（初回訪問緊急連絡先文書）

**0-2g. 連携・文書系:**
- [x] CommunicationEvent, CommunicationRequest/Response
- [x] CareReport, DeliveryRecord, ConferenceNote, EscalationRule, ExternalAccessGrant
  - CareReport / DeliveryRecord に draft/sent/failed/confirmed/response_waiting を保持
  - reschedule / emergency_insert 時の通知先・通知結果・連絡理由を保持
- [x] TracingReport（服薬情報提供書）

**0-2h. 管理・設定系:**
- [x] BillingCandidate, Notification, AuditLog, IntegrationJob, Template
- [x] BillingEvidence（visit単位の根拠）:
  - payer_basis（医療/介護/自費/非算定）, claimable BOOLEAN, exclusion_reason
  - order_ref / consent_ref / management_plan_ref / report_delivery_ref / visit_record_ref
  - monthly_count_snapshot, same_month_exclusion_flags, validation_notes
- [x] SourceOfTruthMatrix / IntegrationBoundary:
  - 患者基本、処方原本、調剤実績、持参情報、報告書送達、請求候補ごとに「CareViaX正本 / 外部正本 / 同期方向 / 障害時復旧手順」を定義
  - `docs/compliance/responsibility-matrix.md` に D-12 対応の責任分界表・復旧手順・`org_id` 例外を明文化
  - `prisma/seed.ts` で `patient_basic` / `prescription_original` / `dispense_result` / `carry_items` / `report_delivery` / `billing` の初期 `SourceOfTruthMatrix` を投入
- [x] Setting（4層）, LabelDictionary
- [x] 全テーブル: created_at, updated_at, org_id, `@@index`, `prisma generate`
  - `AuditLog.updated_at` を追加し、`Organization` / `Setting` / `LabelDictionary` / `DrugMasterImportLog` の index を補完
  - グローバル参照マスタと共通辞書は `org_id` 例外として責任分界表に明記
  - `pnpm db:generate` / `pnpm exec eslint prisma/seed.ts` を確認

---

### 1a-1. 患者・案件管理 `cc:完了`
> depends: 0-4 | DoD: 患者CRUD→ケース作成→状態遷移→終了処理→計画書作成が動作

- [x] 紹介受付フォーム (FR-001): 依頼元（医師指示書/ケアマネ依頼/施設依頼/家族相談）、必要書類チェック（指示書/同意書/保険証/介護保険証）
- [x] 患者基本情報 CRUD (FR-002): 請求支援フラグUI + 住所→座標自動変換（ジオコーディング）
- [x] ケアチーム管理 + 患者詳細画面（8タブ）+ タイムライン + 検索
- [x] ケース状態遷移 + 終了処理(F-08)
- [x] 薬学的管理指導計画書: 作成・版管理・月次更新リマインド・処方変更時の再策定アラート
- [x] 患者重複検知 (FR-004) — P1
- [x] 同意取得UI:
  - 同意書一覧画面（患者別: 種別/取得日/有効期限/ステータス）
  - 紙署名→スキャンアップロード→ConsentRecordに紐付けフロー
  - 未取得同意の警告表示（訪問予定作成時に必須同意チェック）

---

### 1a-5. ⑧ 報告・連携 `cc:完了`
> depends: 1a-1（連携ログ）, 1a-3（報告書） | DoD: 主要報告書の作成/送付/失敗追跡が動作
- [x] CommunicationEvent は MVP では主要イベントのみ:
  - 訪問予定変更
  - 主治医報告
  - ケアマネ報告
  - トレーシングレポート送付
  - 送達失敗/再送
- [x] 連携タイムライン + 連携ログ一覧画面
- [x] CareReport: 訪問記録→自動差込→テンプレート→PDF→SES
  - 主治医報告（速やかに送付、算定要件）
  - ケアマネ報告（介護保険患者は訪問ごとに必須、月次まとめ不可）
  - 施設申し送り/看護共有/家族共有/内部記録
- [x] DeliveryRecord:
  - draft / sent / failed / confirmed / response_waiting
  - FAX/メール/SES のチャネル別送達記録
- [x] 文書テンプレート(FR-302) + タスク管理(FR-304)

---

### 1a-7. モバイル/タブレットUI `cc:完了`
> depends: 1a-1〜1a-6 | DoD: スマートフォン/タブレットで訪問業務の一日が完結する

**スマートフォン（≤767px）専用画面:**
- [x] 本日の訪問リスト（メイン画面）: 訪問順カード表示、スワイプで訪問開始/完了
- [x] 患者カード: 患者名、住所（1タップでナビ起動）、推定到着時刻、前回課題バッジ、持参物チェック状態
- [x] 訪問記録入力（SOAP簡易版）: ステップ形式（S→O→A→P を1画面ずつ）、音声入力ボタン（OS標準IME）
- [x] 残薬入力: 薬剤リスト→残数タップ入力（テンキー）、写真撮影ボタン（残薬現物記録）
- [x] 受領確認: 署名パッド（タッチ手書き）or 受領者名+続柄入力
- [x] QRスキャン: カメラ起動→即時読取→患者照合（1a-4のモバイル最適化版）
- [x] 通知一覧: プッシュ通知タップ→該当画面へディープリンク
- [x] ボトムタブ: 本日の訪問 / 患者検索 / スケジュール(日表示) / 通知 / メニュー

**タブレット（768-1279px）専用最適化:**
- [x] 訪問記録入力（主要入力デバイス）: SOAP 4セクション同時表示（2カラムレイアウト）
- [x] スケジュール: 日/週ビュー（横向き推奨、縦軸=時間/横軸=薬剤師のガントチャート）
- [x] 患者詳細: サイドパネル+メインコンテンツのマスター/ディテール構成
- [x] 訪問前準備チェック: チェックリスト+地図を横並び表示
- [x] 処方差分ビュー: 前回/今回の2カラム比較（デスクトップの3ペインを2ペインに縮小）

**モバイル共通（スマホ+タブレット）:**
- [x] タッチ最適化: タッチターゲット44px以上（WCAG AA）、スワイプジェスチャー対応
- [x] プルダウンリフレッシュ: 訪問リスト/ダッシュボードの手動更新
- [x] ネットワーク状態表示: オンライン/オフラインバナー（オフライン時は読取専用を明示）
- [x] PWAインストール促進: 初回アクセス時にホーム画面追加バナー
- [x] 画面回転対応: 縦固定（スマホ）、縦横対応（タブレット、横向きでガントチャート拡大）
- [x] カメラ連携: 処方箋スキャン、残薬写真、QR読取のネイティブカメラAPI統合
- [x] GPS連携: 訪問開始/終了時の位置情報記録（任意、プライバシー設定で無効化可能）

---

### 1b-1. ① 処方箋応需（処方受付〜調剤開始前） `cc:完了`
> depends: 1a-1 | DoD: 全経路の処方受付→構造化→疑義照会→MedicationCycle生成が動作

**処方箋受付（経路別）:**
- [x] 紙処方箋: 患者/家族持参 → 原本スキャン(S3) → 構造化入力
- [x] FAX処方箋: 訪問診療医/施設からのFAX → 受領記録 → 原本ビューア → **原本未回収管理**（FAX受付後3日超→アラート、原本は訪問時に薬剤師が回収）
- [x] 電子処方箋: 電子処方箋管理サービス連携（Phase 3 で実装、ここではアダプタIF定義のみ）
- [x] 施設まとめ処方: 施設看護師からの複数患者分一括受領 → 患者別に分離→個別MedicationCycle生成
- [x] リフィル処方箋: 薬局保管 → 次回調剤日リマインド → 残回数管理 → 調剤可能ウィンドウ（前回調剤日+投薬日数の±7日、予定日除く）→ ウィンドウ外は調剤不可
- [x] 処方箋有効期限チェック: 発行日+4日、期限切れ→受付不可アラート

**処方内容確認・照合:**
- [x] 処方明細の構造化エディタ(PrescriptionLine) + 原本ビューア
- [x] 前回処方との差分比較ビュー（追加/変更/中止/用量変更をハイライト）
- [x] 一般名処方 → 後発医薬品候補の自動提示 + 選択記録
- [x] 保険情報確認（オンライン資格確認のIF設計、実装はPhase 3）
- [x] DO処方チェック: 前回と同一内容の場合→漫然投与リスク警告（消炎鎮痛剤/抗菌薬/下剤等の長期継続）
- [x] 在宅移行初期管理料(230点)算定チェック: 初回算定月に自動通知（初回訪問前日までに患家訪問→環境聴取が必要）

**疑義照会 (InquiryRecord):**
- [x] 照会起票: 照会理由（用量疑義/相互作用/禁忌/重複/その他）、照会先医師、照会内容
- [x] 照会結果記録: 変更あり（変更内容→PrescriptionLine更新）/ 変更なし（理由記録）/ 回答待ち
- [x] 照会中は調剤開始不可（該当明細のみブロック、他の明細は進行可）
- [x] 照会履歴の患者タイムライン統合

**MedicationCycle生成:**
- [x] 患者照合 → ケース紐付け → MedicationCycle作成
- [x] 分割調剤: 長期処方の分割管理（分割回数/今回回数/次回調剤予定日）
- [x] バリデーション: 重複候補検知、未構造化ブロック、不明→WorkflowException
- [x] 通知: 緊急→調剤キュー即通知
- [x] PharmacyDrugStock 初期設定UI: DrugMaster から薬局の採用薬品を選択→登録、採用後発薬の設定
- [x] 訪問予定との接続:
  - 処方差分サマリーを VisitPreparation に反映
  - carry_items_ready / partial / blocked を VisitSchedule に反映

---

### 1b-4. トレーシングレポート + 依頼/照会ワークフロー `cc:完了`
> depends: 1a-5 | DoD: トレーシングレポート送付、依頼→返信→クローズが動作

- [x] TracingReport: 課題→起票→送付→受領確認
- [x] CommunicationRequest/Response: 状態遷移9段階
- [x] 返信待ち一覧 + エスカレーション

---

### 1b-5. 最小セット運用（Pilot前必須） `cc:完了`
> depends: 1b-2 | DoD: セットが必要な患者に対して、最小限のセット→確認→持参反映が動作

- [x] セット対象患者のフラグ管理（pilot対象の明示）
- [x] 最小SetPlan: 対象期間、セット方式、注意事項
- [x] 最小SetAudit: 承認 / 差戻し / 部分承認
- [x] 部分承認時は carry_items_partial と再作業タスクを自動起票
- [x] 持参チェックリストへ確定反映
