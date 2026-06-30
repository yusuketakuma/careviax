# PH-OS Pharmacy — Implementation Plan

> 仕様書: [ワークフロー](docs/ph-os_pharmacy_workflow_spec_project_context.md) | [多職種連携](docs/ph-os_pharmacy_multidisciplinary_collaboration_spec_project_context.md) | [設計判断](docs/decisions.md)
> アーキテクチャ / デザイン方針: CLAUDE.md 参照
> ※ Phase 3 は Phase 2 完了時に詳細化する

### 明示的な非ゴール（既存レセコン/薬局システムの責務）

- フル在庫管理（発注・仕入・棚卸し・在庫評価）→ PH-OSは在庫医薬品マスタ（採用薬フラグ+引当フラグ）の薄い層のみ
- 麻薬管理帳簿・毒薬劇薬受払い簿 → レセコンが法定帳票を担う
- 領収書・調剤報酬明細書の発行 → レセコンの中核機能（二重入力回避）
- 会計・一部負担金の収納管理 → レセコン/会計システム
- POS・仕入・発注 → 在庫管理専用システム

### 実装優先原則（今回レビュー反映）

- MVPは「訪問日次運用 + 報告送付 + 最低限の処方差分/持参判定」を最優先にし、重いマスタ/処方安全チェック/請求自動化は後段に寄せる
- `MedicationCycle` は「処方起点の1運用サイクル」を維持する。MVPでも訪問予定は処方差分・持参可否・未解決課題と切り離さない
- PH-OS / レセコン / 電子薬歴 / 在宅支援システムの責任分界を先に固定し、二重入力を避ける
- 公開情報ベースの市場比較では、既存製品は「訪問記録・計画書/報告書作成・FAX/メール送付・現場共有」に強い。初期価値は最適化機能より、現場記録/連携/持参漏れ防止に置く

### 直近トラック: デザイン言語による状態色トークン全面統一（2026-06-20）`cc:完了`

<!-- 2026-06-20: 既存の6軸状態色トークン基盤(--state-*/--tag-*/StateBadge/StatusDot/STATUS_TOKENS)へFE全体を統一移行。multi-agent workflow(54 agent)。typecheck/lint/test green、pre-existing失敗10件も併せて解消。未コミット→別途コミット予定。 -->

- [x] 基盤: `status-labels.ts` に24 familyの value→role マップ追加（CASE/SCHEDULE/PRIORITY/VISIT_OUTCOME/REPORT 他）、死にコード `SCHEDULE_STATUS_STYLES` 除去、`docs/ui-ux-design-guidelines.md §色` を6軸セマンティックへ更新（CLAUDE.md旧規則=患者緑橙灰 は不採用）、移行台帳 `docs/state-color-migration-map.md` 新規
- [x] 画面移行: 21パーティション（相互排他）で生Tailwindパレットを `StateBadge`/`StatusDot`/`--state-*`/`--tag-*`/`--chart-*` へ統一。624箇所移行、生パレット 179→20ファイル（残20はカテゴリ/臨床ハザード/印刷/dead の意図的保留、台帳に根拠明記）
- [x] 敵対的レビュー＋修正: HIGH 2（pca-pumps cancelled→blocked / network-status-banner オフライン→blocked）+ MED 4 を修正。現在地ラインを `info(青)` に統一（dashboard-cockpit / schedule-team-board）
- [x] 残課題: dead `pharmacistStatusClass` 除去、stale `page-section.test`(rounded-xl) 修正
- [x] 別件回収: pre-existing 失敗10件解消（共通dialog の日本語化「閉じる」に phos テスト8件追随、data-explorer-catalog に薬局連携2モデル追記）
- [x] 検証: `pnpm typecheck` PASS / `pnpm lint` clean / `pnpm test` green
- 関連: `careviax-state-color-system`（メモリ）/ `ops/DESIGN_LANGUAGE.md` / `docs/state-color-migration-map.md`

### 直近トラック: v0.2 薬局間連携仕様追随（2026-06-19）

- [x] v0.2 仕様を上位版 SSOT として扱い、既存コード側を仕様に合わせる運用へ更新
- [x] 薬局間連携の基盤モデル/API: 連携薬局、提携、患者共有ケース、患者リンク、訂正依頼、訪問依頼、訪問記録、契約、請求候補、月次請求/無償報告、医師報告下書き
- [x] 契約文書 API foundation: 契約書テンプレート第1-23条検証、契約版/費用条件表プレビュー、`ContractDocument` 保存、契約書 PDF 生成/保存、署名済み PDF upload attach、本文非保存のメタ監査
- [x] 契約書作成 UI: 管理セットアップ画面から契約書テンプレート選択、費用条件表プレビュー、契約書 PDF 生成保存、署名済み PDF アップロード、`ContractDocument` 保存、保存済み契約書一覧確認までを接続
- [x] 契約状態管理: `PharmacyContractStatus` を v0.2 仕様の `expired` / `terminated` へ追随し、旧 `ended` / `archived` は migration で rename
- [x] 患者共有ケース状態管理: `PatientShareCaseStatus` を v0.2 仕様の `consent_pending` / `partner_confirmation_pending` / `declined` へ追随し、旧 `pending_partner` は migration で rename。作成→同意→協力確認→有効化の順序を API/UI/browser proof で固定
- [x] 患者一覧の共有状態算出: 患者マスターに共有フラグを持たせず、`PatientShareCase` の active/有効同意から `pharmacy_share` を算出し、件数・協力薬局数・共有範囲キーだけを患者一覧レスポンスへ返す
- [x] 患者共有ポリシー共通化: 修正/追記依頼の対象所有者、相手薬局所有データへの直接編集不可、active 共有ケース限定の依頼可否を `patient-share-policy.ts` に集約
- [x] 患者共有データ出力ポリシー共通化: 添付閲覧、添付ダウンロード、印刷、PDF 出力、PDF ダウンロード、データダウンロードに必要な `share_scope` を `patient-share-policy.ts` で fail-closed 判定し、共有範囲更新 API の audit/response に許可出力アクションを接続
- [x] 訪問依頼状態管理: `PharmacyVisitRequestStatus` を v0.2 仕様の `requested`→`accepted`→`recording`→`submitted`→`confirmed`→`physician_report_created`→`claim_checked` へ追随し、旧 `cancelled` / `expired` は migration で `declined` へ集約
- [x] 患者共有/訪問/記録/契約/請求ステータス遷移共通化: `pharmacy-partnerships.ts` に患者共有ケース、訪問依頼、協力訪問記録、契約/契約版の明示的な遷移・有効化ルールを追加し、同意登録、患者リンク承認/辞退、有効化、受諾/辞退、記録提出、基幹確認/差戻し、医師報告下書き、請求候補化、契約/契約版 active 化の status 更新を共通ヘルパー経由に統一。月次請求は `transitionPharmacyInvoice` で発行/送付/受領/支払予定/入金/取消/再発行を共有遷移化済み
- [x] 月次請求状態管理: `PharmacyInvoice` の発行/送付/受領/支払予定/入金/取消/再発行を `PATCH /api/pharmacy-invoices/:id` と月次請求 UI から実行し、`payment_scheduled_for` date-only カラムと `pharmacy_invoice_*` 監査検索語彙まで接続
- [x] 月次請求 UI 安全化: 請求書/無償報告書の状態更新は確認ダイアログ後のみ実行し、取消/再発行は理由入力を必須化。請求履歴の内部 ID 表示と生エラー詳細表示も抑制
- [x] 患者別・訪問依頼別メッセージ API/DB: `PharmacyCooperationMessageThread` / `PharmacyCooperationMessage`、有効共有ケース境界、本文 redacted DB 監査、PHI-free 通知サービス連携
- [x] 最小オペレーター UI: 薬局間連携ワークフロー、管理セットアップ、月次請求、患者カードからの共有ケース作成、訪問依頼作成、共有範囲更新
- [x] メッセージ UI: 薬局間連携ワークフローから患者共有ケース・訪問依頼ごとのメッセージ一覧/投稿を実行
- [x] メッセージ browser 実証: 薬局間連携ワークフローから患者共有ケース・訪問依頼ごとのメッセージ一覧/投稿を実操作で確認
- [x] 状態遷移 UI 安全化: 共有開始、患者リンク、訪問依頼、協力訪問記録、報告書ドラフト作成の高リスク操作を確認ダイアログ経由に固定
  - 2026-06-19: `pharmacy-cooperation-workflow-content.test.tsx` で共有開始/リンク承認/受諾/辞退、訪問依頼受諾/辞退、訪問記録提出/確認/確認+報告/差戻し、報告書ドラフト作成の確認前 fetch 抑止と既存 payload 維持を検証済み。`pnpm exec vitest run 'src/app/(dashboard)/workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.test.tsx'` は 12 tests passed。`pnpm format:check`、対象 ESLint、`pnpm typecheck` passed。
- [x] 監査補完: 共有ケース/同意/訂正/ファイル/同意文書/audit-log 検索の最小監査、`AuditLog.actor_pharmacy_id` / `actor_site_id` / `patient_id`
- [x] v0.2 completion audit: `docs/pharmacy-cooperation-v0.2-completion-audit.md` に機能棚卸し、完了条件別証跡、未適用 migration、rollback 方針、残課題を集約
- [ ] ブラウザ実証: 患者カード作成 → 同意/リンク/有効化 → 訪問依頼 → 訪問記録 → 請求 → 報告下書き
  - [x] Route-mocked browser proof: `consent_pending` 共有ケースを前提に、同意登録、患者リンク基幹承認/協力受諾、共有有効化、訪問依頼、協力訪問記録、基幹確認、医師報告下書き、請求候補生成、請求書 PDF リンクまでを検証
  - [ ] 患者カード作成の browser 直踏み: local e2e DB に v0.2 migrations (`AuditLog.actor_pharmacy_id`, `ConsentRecord.document_file_id`) が未適用のため、患者詳細 SSR が Prisma P2022 で停止。患者カード作成自体は unit で継続カバー。
- [x] ConsentRecord の document download context 強化と expiry/document update UI
- [ ] 新規マイグレーションの実DB適用確認

### 外部システム比較から採る方針

- 調剤レセコン系: 在宅スケジュール/介護請求入力まで持つ製品があるが、PH-OSでは請求エンジン全面置換はしない
- 電子薬歴系: タブレット記録、写真、訪問報告書・計画書作成はベースライン機能として扱う
- ふぁむけあ系: 報告書作成、FAX/メール送信予約、トレーシングレポート、店舗間共有は MVP の参照ベンチマークとする
- シジダス系: 一包化委受託/外部委託オペレーションは Phase 2+ の連携拡張テーマとして扱う

## ワークフロー全体像（8工程）

| #   | 工程名         | 英語キー            | 主担当         | 入力                                | 出力                           |
| --- | -------------- | ------------------- | -------------- | ----------------------------------- | ------------------------------ |
| 1   | **処方箋応需** | prescription_intake | 受付/事務      | 処方箋（紙/FAX/電子/施設/リフィル） | 構造化明細、MedicationCycle    |
| 2   | **調剤**       | dispensing          | 調剤担当薬剤師 | 処方明細 + 在庫確認                 | 調剤実績、差異記録、持参候補   |
| 3   | **調剤鑑査**   | dispense_audit      | 鑑査担当薬剤師 | 処方原本 + 調剤実績                 | 承認/差戻し + 処方安全アラート |
| 4   | **薬剤セット** | medication_set      | セット担当     | 鑑査済み薬剤                        | セット構成、持参パック         |
| 5   | **セット鑑査** | set_audit           | 鑑査担当       | セット実績                          | 承認/部分承認/差戻し           |
| 6   | **訪問計画**   | visit_planning      | 事務/薬剤師    | 持参確定品 + 患者スケジュール       | 訪問予定、ルート、準備チェック |
| 7   | **訪問実施**   | visit_execution     | 訪問担当薬剤師 | 訪問予定 + 持参薬 + 前回課題        | SOAP記録、残薬、課題、介入     |
| 8   | **報告・連携** | reporting           | 薬剤師/事務    | 訪問記録                            | 報告書送付、送達追跡、連携ログ |

```mermaid
flowchart LR
  subgraph 受入
    A[紹介依頼] --> B[患者登録] --> C[計画書策定]
  end
  subgraph "① 処方箋応需"
    E[処方箋受領] --> F[構造化・照合]
    F --> G{疑義照会?}
    G -->|なし| H[MedicationCycle]
    G -->|あり| G1[照会→反映] --> H
  end
  subgraph "②③ 調剤・鑑査"
    H --> I[調剤]
    I --> J[調剤鑑査]
    J -->|差戻し| I
  end
  subgraph "④⑤ セット・鑑査"
    J -->|承認| K[薬剤セット]
    K --> L[セット鑑査]
    L -->|差戻し| K
    L -->|承認| M[持参パック]
  end
  subgraph "⑥ 訪問計画"
    C --> N[訪問予定]
    M --> N
    N --> O[ルート最適化] --> P[準備チェック]
  end
  subgraph "⑦ 訪問実施"
    P --> Q[本日の訪問] --> R[SOAP記録]
    R --> S[次回訪問提案]
  end
  subgraph "⑧ 報告・連携"
    R --> T[報告書→送付]
    R --> V[連携ログ]
    R --> W[トレーシングレポート]
  end
  subgraph 月次
    T --> X[請求支援]
  end
  S --> N
```

---

## 直近トラック: デザイン忠実実装 + バックエンド補完(design/ v1.9 → new) `cc:完了`

<!-- 2026-06-14: 新14画面(Phase1-4)完了 + D-3〜D-9 残ギャップ23件を wave2/design-fidelity-residual で実装完了(unit 6356 green)。残 blocked は D-8-3 音声STT(外部依存)のみ。migration 適用と main マージは人手判断待ち。 -->

> 開始: 2026-06-11
> **ターゲット更新(2026-06-11 夜)**: `design/images/new/` の 14 枚(01_dashboard〜14_settings、1600x1000)が最優先ターゲット。旧 P0/P1 は new でカバーされない画面の補助参照。
> 新デザインの主な進化: セーフティボード(赤帯・常時表示)、RX-YYYY-NNNN 番号、サイドバーに「カード/患者一覧/ハンドオフ」+件数バッジ+グループ見出し、上部バーに常設検索+「同期済み HH:MM」+モードドロップダウン、工程チップ(取込/入力/判断/調剤/監査/セット/訪問/報告)、「直近の動き」フィード、チームの会話
> 体制(2026-06-11 確定): **サブエージェント(すべて Fable、model 指定なし)が実装を担当し、Fable 本体は品質確認(撮影→視覚比較→合否判定→差し戻し)に専念**(推論コスト最適化)。仕様はファイル参照(docs/design-gap-analysis-new.md)で受け渡す
> SSOT: `docs/design-fidelity-mapping.md`(進捗) / `docs/design-gap-analysis.md`(旧 62 画面分析) / `docs/design-gap-analysis-new.md`(新 14 画面読解: シェル仕様+カード概念+共通パターン 12 種+移行計画)

### 新 14 画面の完了済み基盤(2026-06-11)

- [x] 読解: workflow `new-design-analysis` 完了 → `docs/design-gap-analysis-new.md` / `.json`。全 14 画面 effort=L。要点: カード=1 RX(処方サイクル)の作業台、9 工程(取込/入力/判断/調剤/監査/セット/訪問/報告/算定)、サイドバー 6 グループ(今日/患者/工程/連携/管理)+監査・ハンドオフ件数バッジ
- [x] 旧 p0_05/06 + バックエンド: workflow `d23-search-and-backend` 完了 → /search + 詳しく絞り込むモーダル(p0_06 撮影比較 **合格**、p0_05 は構成一致・結果待ち setup 修正済み・再撮影は次バッチ)、GET /api/me/sites + PUT /api/me/site(監査ログ)+ GET/PATCH /api/me/preferences + ui-store workMode/careMode + app-header careMode 連動。tsc clean / 128 テスト green を本体検証済み
- [x] 撮影基盤: `design-screen-map.ts` に new_01〜new_14 登録、ベースライン 14 枚撮影済み

- [x] Phase 1(シェル+共通部品): workflow `new-design-phase1-shell` 完了、**本体撮影比較で合格**(2026-06-12)
  - シェル 12 ファイル: サイドバー 5 グループ(今日/患者/工程/連携/管理。doc の「6」は off-by-one)+ exact/excludeExact による患者一覧/カードのアクティブ分離 + use-nav-badges(監査=/api/dispense-audits、ハンドオフ=/api/handoff-board、60s、エラー時非表示)+ app-header(モード▼ DropdownMenu→PATCH /api/me/preferences、常設検索+"/" ショートカット、同期済み HH:MM=offline-store.lastSyncedAt/オフライン橙)
  - 共通部品 13 ファイル: safety-board(タグ色: 麻薬=赤/冷所=ティール/一包化=青)/ process-chips(ProcessChips+ProcessProgressDots、PROCESS_STEPS_9: dispensed・audit_pending=監査「いまここ」、reported=算定)/ action-rail 拡張(「根拠・記録」、BlockedReason categoryLabel・ageLabel・actionLabel/Href、EvidencePanel meta・openLabel — 全 optional 後方互換)/ rx-number('rx_year'=RX-YYYY-NNNN 追加、既定は既存互換)
  - 検証: tsc/eslint green、layout 79 + workspace/prescription/search 90 テスト green(エージェント報告)+ 本体で tsc 再確認・new_01/new_06 撮影比較
- 運用メモ(2026-06-12): ローカル PostgreSQL(5433)が停止していた場合、tmux 下では brew services 不可 → `pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start` で直接起動。dev サーバーは大量ファイル変更後に webpack chunk timeout を起こすことがある → 再起動で解消

- [x] Phase 2a(seed + 06_card + 01_dashboard): workflow `new-design-phase2a` 完了、**本体撮影比較で両画面とも合格**(2026-06-12)
  - seed: 処方 4 行(RX-2026-0500、オキシコドン麻薬/インスリン冷所)、アレルギー(セフェム系・発疹 2019)、eGFR 38、ふらつき注意、監査キュー 6(=サイドバーバッジ)、ハンドオフ 3、当日 14:00 訪問、直近の動き(調剤完了/残薬調整疑義照会)。intakeCurrent は RX 表示用に ID 改番(末尾 0500)+旧 ID 掃除
  - 06_card: `card-workspace.tsx` 新設(/patients/[id] 既定ビュー)。?view=profile / 旧 ?tab= で旧タブ温存。buildPatientWorkspace 拡張(safety/prescription_lines/recent_activities/today_tasks)。本体追修正: 監査期限フィルタに completed 追加、アレルギーラベル reaction 対応、止まっている理由を新文言(ご家族の同意待ち=患者・1日/送付先の確認=事務・30分+個別アクション)
  - 01_dashboard: `/api/dashboard/cockpit` 新 API + `dashboard-cockpit.tsx`(条件バナー/今すぐ対応/今日の流れ/工程の今/右レール)。旧セクションは下部温存
  - 既知の残課題: E2E 旧スペック(ui-detail-layout / ui-major-screens / ui-audit-extensions)が patient-detail-tablist を既定ルートで参照 → ?view=profile への追随が必要(Phase 2b 後に一括)

- [x] Phase 2b(残り 12 画面): workflow `new-design-phase2b` 完了(Fable 6 体・78 ファイル)、**本体撮影比較で全 14 画面の構成合格**(2026-06-12)
  - 02 患者一覧(/api/patients/board BFF + patients-board)/ 03 スケジュール(全員タイムライン+余白)/ 04 訪問(準備チェック+繰り下げ注記+オフライン注記)/ 05 取込(**新ルート /prescriptions/intake**。旧 /prescriptions/new は「手動で取り込む」から到達)/ 07 調剤(3 ペイン+割り込み防護+中断理由)/ 08 監査(キュー選択→麻薬監査+計数テーブル+合格・差戻し二択。/api/dispense-tasks/[id]/workbench 新 BFF、double_count 監査ログ)/ 09 セット(物理画面+レーン)/ 10 報告・共有 / 11 算定チェック / 12 ハンドオフ(渡した・来た+3点セット)/ 13 マスター(5 マスター+鮮度)/ 14 設定(安全ロック+働き方+/api/settings/operational-policy)
  - 本体追修正: screen-map(new_05 ルート、new_08 キュー選択+描画待ち setup)、navigation-config(処方取込→/prescriptions/intake、カードの excludePrefixes)+テスト追随、operational-policy route の非ハンドラ export 解消、rate-limit カタログへ新 API 11 ルート登録
  - 最終検証(本体): tsc clean / 全体 vitest 5850 中 5839+rate-limit 修正分 green。残 10 失敗(secrets / websocket lambdas / room-token / phos observability)は AWS SDK 内部フィールド比較の既存事象で今回の変更と無関係
  - 旧 UI は全画面でビューポート下部 or 旧ルートに機能温存
  - 既知の意図的差分(共有部品仕様): 止まっている理由見出しの赤丸件数バッジ非対応 / SafetyBoard サブタイトル常時表示 / EvidencePanel の「開く」はアウトラインボタン
- [x] Phase 3(残課題): workflow `new-design-phase3` 完了 + 本体品質確認(2026-06-12)`cc:完了`
  - seed 拡充: 追加患者 12 名(佐々木ハル/伊藤キヨ/施設グリーンヒル入居 3 名ほか)+ 第 2 ユーザー「佐藤 恵」(seed.ts)+ 調剤中タスク/調剤実績(二人制バナー成立)/施設セット(SetPlan・SetBatch・SetAudit)/取込 5 件/報告下書き・返信待ち。db:e2e:seed 2 回実行で冪等確認(35 テーブルでカウント一致)
  - @db.Date 境界統一: `src/lib/utils/date-boundary.ts` 新設(localDateKey/utcDateFromLocalKey/todayUtcRange、JST 固定テスト 11 件)+ API/services/jobs 36 ファイルを置換。api 全 296 ファイル 2457 テスト green
  - E2E 追随: 4 スペック 16 テスト(?view=profile / card-workspace testid 振り分け)+ 本体で ui-dashboard-nav を新ナビ仕様(5 グループ・カードのアクティブ・パンくず廃止・コックピット遷移)へ全面書き換え → 9/9 green
  - 本体最終撮影比較(データ入り): 02(12 名分布+チップ件数)/ 07(いまの 1 件: セーフティボード+処方比較・減量/照会回答ハイライト+チェックリスト — setup にキュー選択追加)/ 08(二人制バナー: 調剤 佐藤 09:30+計数列)/ 09(施設グリーンヒル+レーン+居室テーブル+工程待ち 2 件)→ **最終合格**。残り画面も全数再撮影済み(構成合格+データ投入済み)
  - 新規残課題(Phase 4 候補): xl 境界 1280px でコックピット条件バナー/プロフィール受付票が不可視・潰れる(レスポンシブ調整)。FacilityVisitBatch.patient_ids のダミー 9 件(旧 UI で名前解決時 3 名のみ表示)。11_billing の BillingEvidence/Candidate デモデータ。ui-patient-flow の mobile-chromium 既存赤(患者一覧 tbody リンクがモバイル hidden)
- [x] コミット: トラック一式を main へ 5 分割コミット(2026-06-12)`cc:完了`
  - 001d39f docs(design assets+調査)/ 0047aa3 prisma(seed+migrations)/ cb9cdd9 backend(BFF+me API+date-boundary)/ 1c1815d frontend(シェル+14 画面)/ 22b8c7c tests(撮影ループ+E2E 追随)。作業ツリー clean
- [x] Phase 4: workflow `new-design-phase4` 完了 + 本体撮影判定合格(2026-06-12)`cc:完了`
  - レスポンシブ: 条件バナーの 1280px 問題の真因は viewport 分岐ではなく cold-compile flake(実測で DOM 可視確認)→ テストを 1280 検証へ戻し待ち時間拡大。cockpit 2 カラムを lg〜、患者詳細右レールを 2xl〜(xl 帯の受付票 dd 圧潰解消、1280=112px/1600=120px 実測)。モバイルは縦積みで情報を隠さない
  - ui-patient-flow: patients-board カード起点(patient-board-card-link)へ書き換え、mobile-chromium 18/18(修正前 10 failed)。副次で hydration mismatch flake 2 件根治(suppressHydrationWarning)+性別 Select の aria-label 追加
  - seed: BillingEvidence 3 件+疑義 BillingCandidate 1 件+BillingRule → /api/billing-evidence/check 実測 KPI(合格3/疑義1/本日候補5)。グリーンヒル入居 9 名追加で patient_ids 12 名全実在化(患者総数 28)。冪等 2 回確認
  - 本体判定: new_11(KPI 3 枠+疑義行+右レール)合格、new_01/new_06 回帰なし(1600 で右レール維持)
  - 残メモ: 患者詳細ミニカードが md 未満で hidden(モバイル情報非表示)— 別タスク候補。10_report の田中行 patient_label が電話番号表示(既存データ事象)
- [x] リファクタ指示書: `refactor-instructions.md` 作成+多角調査で増補(2026-06-12)`cc:完了`
  - Debt Map D1〜D15(認可二重系統/監査インライン 54/日付残存 13/死コード/AWS モック脆弱テスト/ラベル分散/肥大 8 ファイル/新旧並立/FileAsset/schema 3 件/レスポンス封筒/env 118 キー/fire-and-forget 77/型境界/ログ方針)
  - Appendix Q1〜Q6 に実測ベースの推奨回答付与(Q2=9 工程置換・Q3=受付済系統一は承認後 Phase 5 で実装可)。実測済みの強み(response ヘルパー 290/any 1 件/ジョブロック等)を「直さない」対象として明記
  - seed 拡充(エージェント notes 集約): 02=患者 12 名分布(佐々木ハル inquiry_resolved・鈴木新規・伊藤キヨ 10:30 訪問・施設グリーンヒル 12 名ほか)+ 各患者の安全タグ/eGFR、04=VisitPreparation(4/4)+施設バッチ+車両、05=取込 5 件+元 FAX 画像+QrScanDraft、07=調剤中(pending)タスク 1 件、08=調剤実績(計数・調剤者 佐藤=第 2 ユーザー要)、09=施設グリーンヒル SetPlan/SetBatch/レーン件数、10=報告下書き・返信待ち
  - @db.Date 当日境界の不統一: visit-schedule-service は UTC 日付キー、/api/visit-schedules/today・cockpit はローカル深夜 → JST で当日取りこぼしの恐れ(02-04 エージェント実測)。統一リファクタ要
  - E2E 旧スペック追随: ui-detail-layout / ui-major-screens / ui-audit-extensions が patient-detail-tablist を既定ルートで参照 → ?view=profile 化
  - 旧ターゲット p0_05 の再撮影(結果待ち setup 修正済み・未確認)

### 進行中 workflow

- なし(Phase 3 編成待ち)

### 検証ループ(全画面タスク共通の完了条件)

各画面は以下のループを回し、忠実度 OK になるまで完了にしない:

1. 実装(既存実装を活かしてデザインへ寄せる)
2. 撮影: `DESIGN_SCREEN_IDS=<id> pnpm test:e2e:local -- ui-design-fidelity`(viewport 1600x1000、出力 `tools/tests/.artifacts/design-fidelity/<id>.actual.png`)
3. 比較: actual と `design/images/**/<id>.png` を並べ、レイアウト・グルーピング・文言・状態色・右パネル構成の差分を列挙
4. 修正 → 再撮影(差分解消まで反復)
5. lint / unit test green を確認

比較の判断基準: ターゲット PNG は「一瞬の静止画」。スクロール・カンバン移動・タブ切替は動く前提で構築し、ビューポート外の続きは差分にしない(詳細は `docs/design-fidelity-mapping.md` の静止画原則)。実装方針に迷いが生じたらサブエージェントを多角展開して検討する。

### D-1. 基盤: 検証ループ + シェル/テーマ + 共通部品 `cc:完了` (2026-06-12 全サブタスク完了)

- [x] D-1-1: 検証ループ基盤(`tools/tests/helpers/design-screen-map.ts` + `tools/tests/ui-design-fidelity.spec.ts`、62 画面マッピング・capture-report.json 出力) `cc:完了` (2026-06-11)
- [x] D-1-2: シェル改修 — ダークネイビーサイドバー(PH-OS ロゴ + 在宅薬局オペレーション、下部ユーザー表示)+ 上部バー(モードバッジ/通知/ヘルプ/ユーザー名) `cc:完了` (2026-06-11)
  - `src/app/globals.css`(sidebar トークンをダークネイビー化)
  - `src/components/layout/sidebar.tsx` / `src/components/layout/app-header.tsx`
  - 検証: p0_07 撮影比較で反映確認、unit 12 件 green、ESLint clean
- [x] D-1-3: 右パネル共通部品 —「次にやること」(主操作 1 つ)/「止まっている理由」(赤・橙)/「根拠・資料」(見るリンク) `cc:完了` (2026-06-11)
  - `src/components/features/workspace/action-rail.tsx`(NextActionPanel / BlockedReasonsPanel / EvidencePanel / WorkspaceActionRail)
  - unit 8 件 green。画面への組み込みは D-2 以降で実施
- [x] D-1-4: 文言ルール横断反映(ブロッカー→止まっている理由 系) `cc:完了` (2026-06-11)
  - 16 ファイル一括置換(src/phos は本体未使用の独立試作のため対象外)。複合語は自然な日本語へ(算定ブロッカー→算定を止めている理由、請求根拠ブロッカー→請求根拠の不足 等)
  - 影響範囲 852 テスト green(collaboration-room-token の 2 失敗は AWS 環境依存の既存事象・無関係)
- [x] D-1-6: 62 画面ギャップ並列調査(9 エージェント)→ `docs/design-gap-analysis.md` / `.json` に永続化 `cc:完了` (2026-06-11)
  - 画面別: kind/effort/UI ギャップ/バックエンド不足/データ源/撮影セットアップ(60 画面分)
  - 横断 70 ノート + バックエンド 7 領域(オフライン同期 / サイト切替 / モード保持 / SavedView / 認可・監査標準形 / workflow-exceptions projection / ヒヤリハット・音声)
- [x] D-1-5: デモシナリオ seed 整備(検証ループ前提・全 D フェーズ共通) `cc:完了` (2026-06-11)
  - `prisma/seed-design-demo.ts` 新規(seed.ts 末尾から呼出、冪等 upsert): 田中一郎(84歳/男性/自宅)+ セット監査待ちサイクル + 処方差分(トラセミド追加/アムロジピン中止)+ SetPlan(お薬カレンダー・一包化・別包)+ 確定済み訪問予定/次回訪問 + WorkflowException 2 件 + 未読通知 6 件
  - 注意: `@db.Date` カラムは UTC midnight に正規化して渡す(JST midnight だと 1 日ズレる)

### D-2. 中核画面(通知 04 / 検索 05・06 / ダッシュボード 07 / カード詳細 08) `cc:完了` (2026-06-12 p0_05 再撮影確認で全サブタスク完了)

> 設計判断(2026-06-11 調査確定):
>
> - p0_08 は `/patients/[id]` 改修(3 カラム骨格・PatientWorkspaceRail・visit_brief 配線が既存。/workflow は org 横断管制塔で責務外)。p0_38 着手時に `/patients/[id]/today` 分割を再判断
> - 通知 5 分類(急ぎ/薬剤師確認/事務で対応/返信待ち/未同期)は enum 拡張せず表示時マッピング(type/event_type/metadata から派生)。「未同期」は offline-store からのクライアント合成行
> - 全体検索は `/search` ページ新設(デザインはページ風全幅)。既存 global-search-modal のロジックを流用し Cmd+K は /search へ。p0_06「詳しく絞り込む」は /search 上のモーダル
> - 共通部品: ListOpenCard(バッジ+タイトル+サブ文+「開く」)と FilterChipBar(青選択チップ)を p0_04/05 で共用

- [x] D-2-1: p0_07 ダッシュボード カードグリッド(集計バッジ行 + 患者カード最上部化 + ヘッダー主操作 2 ボタン) `cc:完了` (2026-06-11)
  - `dashboard-summary-badges.tsx` 新規(/api/dashboard/today、ラッパー無し JSON に両対応)
  - `dashboard-content.tsx` 組み替え(患者グリッドを今日の運用の先頭へ、請求 KPI を補助へ)
  - `workflow-page-header.tsx` に actions[](先頭のみ primary)
  - 残: カード内の主操作 1 つへの絞り込みは p0_08(D-2-2)と合わせて調整
- [x] D-2-2: p0_08 カード詳細ワークスペース(右パネル 3 点セットの基準実装、`/patients/[id]` 改修) `cc:完了` (2026-06-11)
  - シェル共通改修も同時実施: `navigation-config.ts` をデザインのフラット 14 項目へ(患者/ワークフロー/通知等は activePrefixes でダッシュボード項目に包含)、`app-header.tsx` をモードバッジ+「通知 N」+ヘルプ+ユーザー2行表示へ、`notification-bell.tsx` を「通知 N」テキストトリガー化(stream 無効時も初回 fetch)
  - バックエンド: `patient-detail.ts` に `buildPatientWorkspace`(進行中サイクル: overall_status / open WorkflowException / 処方の変化(用法・日数付き、detectMedicationChanges 流用)/ 前回・今回服用期間 / SetPlan+加工 / 処方せん画像 URL)を追加し overview に同梱。`visit_schedules` select に time_window_start / confirmed_at 追加
  - フロント: タブ再編(薬剤師メモ(既定)/工程/処方・監査/セット/訪問/報告/履歴。basic/cases/documents は ?tab= 直アクセスに退避)、`pharmacist-memo-tab.tsx`(今日の見どころ/処方の変化テーブル/セットの注意)、`process-tab.tsx`(8 工程ストリップ+現在工程)、左ミニカード(予定+正式決定/前回薬/今回薬/次回訪問/現在工程+カードを編集/一覧へ戻る)、`cycle-workspace.ts`(16 ステータス→状態表示+次アクション)、右レール工程駆動化(xl〜表示)
  - 検証: 撮影比較 3 周(ヘッダー除去→日付 UTC 修正→通知バッジ表示)で忠実度 OK。tsc / ESLint clean、patients/[id] 41 + layout 47 テスト green
  - 残(次フェーズ送り): 「今日の見どころ」の文言品質(visit_brief ルール生成文の人間味)は p1_03 AI まとめレビューで扱う。タブ「セット」の中身は現状 medications 内容(SetPlan 詳細ビューは D-3 セット工程と合わせて精査)
- [x] D-2-3a: p0_04 お知らせ一覧 `cc:完了` (2026-06-11)
  - 共通部品新設: `filter-chip-bar.tsx`(青選択チップ)/ `list-open-card.tsx`(バッジ+タイトル+サブ文+「開く」)— p0_05 でも再利用
  - `notification-category.ts`: 5 分類(急ぎ/薬剤師確認/事務で対応/返信待ち/未同期)を type/event_type から表示時マッピング(enum 拡張なし)。system は「すべて」のみ。「未同期」は offline-store の pendingSyncCount から合成
  - `notifications-content.tsx` 全面改修(見出し「お知らせ」、未読優先+重要度ソート、開く=既読化+遷移、全て既読)。`?type=` 旧リンクは category へ互換マッピング
  - 検証: 撮影比較 2 周で忠実度 OK。unit 11 件 green
- [x] D-2-3b: p0_05 全体検索(/search ページ)/ p0_06 詳しく絞り込む `cc:完了` (2026-06-12 p0_05 warm 再撮影で結果カード表示を確認・合格。連続撮影時の「検索中...」は撮影 flake でコード起因ではない)
  - 体制(2026-06-11〜): Workflow で Opus=設計 / Sonnet=実装 / Fable=オーケストレーション+撮影検証
  - 実行中: workflow `d23-search-and-backend`(検索系フロント + D-9 先行の me/sites・me/site・me/preferences API + ui-store workMode/careMode)

> **D-3〜D-9 残ギャップ実装(2026-06-14)** `cc:完了`(ブランチ `wave2/design-fidelity-residual`、6コミット、unit 6356 green / typecheck / lint clean)
> 8トラック並列調査で「新14画面実装後の真の残ギャップ」を確定 → 実装可能 **23 件**を5バッチ並列実装 + 4次元レビュー(敵対的検証)→ HIGH 3件修正。
> 旧 p0_XX の大半は新14画面で**既カバー**(p0_09/10/12/13/14 調剤=new_05/07/08/09、p0_16/22/23 訪問=new_03/04、p0_25/31 連携、p0_38/39-45/47/48 マスタ=new_13/14、p0_01/02/03/32-37 認証・安全)のため除外。
> **マイグレーション未適用**: `prisma/migrations/20260614120000_wave2_design_fidelity_contract` はローカルDB起動不可のため未適用。デプロイ前に `pnpm db:migrate`(`prisma migrate deploy`)で適用要(unit はモックのため不要)。
> **未マージ**: main へのマージは人手判断待ち。

### D-3. 調剤フロー(処方 09-11 / 調剤・監査 12-13 / セット 14-15) `cc:完了`

- [x] p0_11 処方の変化を確認 専用差分レビュー画面(medication-diff に用法/日数追加) `cc:完了`
- [x] p0_15 セット監査 3ペイン再構築(写真確認 + 6項目チェックリスト + set-photo基盤、サーバ側チェックリスト強制) `cc:完了`
- (p0_09/10/12/13/14 は new_05/07/08/09 で既カバー)

### D-4. 訪問フロー(スケジュール 16-21 / 訪問モード 22-24) `cc:完了`

- [x] p0_17 正式決定フロー忠実化 / p0_18 予定作成・編集ドロワー(下書き/確認待ち) / p0_19 重なり解消+車両競合検知 / p0_20 緊急ルート再計算(locked多シナリオ) / p0_21 ルート最適化詳細+守る条件 / p0_24 施設パケット構造化 `cc:完了`
- (p0_16 全員ガント=new_03、p0_22/23 訪問モード既カバー)

### D-5. 連携・請求(25-31) `cc:完了`

- [x] p0_26 送付先編集フォーム+書込API / p0_27 薬剤師相談・事務戻し解決フロー / p0_28 報告書コンポーザー(複数共有先+送付前チェック+一括送付) / p0_29 返信待ち2ペイン `cc:完了`
- (p0_25 事務サポート / p0_31 残薬調整は既存実装で充足)

### D-6. 安全・オフライン・認証(32-37, 01-03) `cc:完了`

- [x] D-6-1/2/3: 4ルート(select-site/select-mode/safety-check/offline-sync)は実装済→**シェル導線整備**で到達可能化 + 空 /issues 削除。p0_01/34/35/36/37 は既カバー `cc:完了`

### D-7. マスタ・設定(38-45, 47-48) `cc:完了`

- [x] 車両点検期限の専用カラム化(notes正規表現解消) / capacity ナビ導線追加。マスタCRUD・設定は new_13/14 で既カバー `cc:完了`

### D-8. P1 画面(p1_01〜p1_14) `cc:完了`(D-8-3 のみ blocked)

- [x] D-8-1: p1_01 保存ビュー(SavedView モデル + CRUD API + 名前付きビュー) `cc:完了`
- [x] D-8-2: p1_09 ヒヤリハット管理(IncidentReport は既実装) `cc:完了`
- [ ] D-8-3: p1_11 音声メモ・文字起こし(STT=AWS Transcribe/外部creds必須) `cc:blocked`
- [x] D-8-4: その他 P1 画面(voice-memo 等は既実装、残りは新14画面で充足) `cc:完了`

### D-9. バックエンド補完(横断) `cc:完了`

- [x] D-9-1: dispense PATCH 権限ゲート+監査 / 監査ルートテスト / claims-XML送信の監査追加(レビュー修正) `cc:完了`
- [x] D-9-2: オフライン競合検出は既実装で充足(視点確認済) `cc:完了`
- [x] D-9-3: 「止まっている理由」projection を共有ライブラリ化(blocked-reason-projection)し4ルートで再利用 `cc:完了`

---

- 直近トラック: 訪問支援・処方/調剤・共有要約 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## Phase 0: 基盤構築・データ定義 `cc:blocked` <!-- 0-2i PMDA登録 + 0-5 I-04 バックアップ実地 が外部依存でブロック -->

> 実装順は **Phase 0a Core → Phase 1a MVP → Phase 0b Advanced → Phase 1b/2** を原則とする
> 目的: Phase 1a を Phase 0 全量完了で待たせない。現場検証に必要な最小基盤を先に通す

### 0a. Core と 0b. Advanced の分割方針

**Phase 0a Core（Phase 1a 着手条件）:**

- 0-1. プロジェクト初期化
- 0-2a〜0-2d, 0-2f〜0-2h のうち MVP必須テーブル
- 0-3. 認証・権限・RLS基盤
- 0-4. 共通基盤
- 0-5. 監視・バックアップ・ガイドライン準拠のうち MVP必須項目

**Phase 0b Advanced（Phase 1a 後続でよい）:**

- 0-2e. 医薬品マスタ系
- 0-2i. 医薬品マスタ取込パイプライン
- 施設基準管理の高度集計
- 請求候補の高度ルールエンジン

### 0-1. プロジェクト初期化 `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

> DoD: `pnpm dev` 起動、`pnpm build` 成功、CI green、AWS全サービス接続確認

- [x] Next.js 16 + TypeScript 6 + React 19, pnpm, ESLint 10, Prettier 3, Tailwind CSS 4 + shadcn/ui
- [x] shadcn/ui 医療テーマ: ブルーグレー配色、コントラスト4.5:1+、zebra stripe テーブル（CLAUDE.md デザイン方針準拠）
- [x] AWS: IAM, RDS PostgreSQL(Multi-AZ, KMS), Cognito(MFA/TOTP, 13文字+, ロックアウト), S3(Object Lock), SES, Amplify Hosting(東京固定)
- [x] Prisma 7（RDS接続）, NextAuth v5 + Cognito, Serwist 9 PWA
- [x] `.env.example`, Vitest 4, Playwright, セキュリティヘッダー, CI(GitHub Actions), IaC(AWS CDK)

</details>
### 0-2. データモデル全体（Prisma Schema） `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 0-1 | DoD: `prisma migrate deploy` 成功、全テーブル作成、シード完了
> ※ 全テーブル同時マイグレーション。グループ分けは設計整理用。Prisma multi-file schema（prisma/schema/\*.prisma）でファイル分割。

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
- [x] DrugAlertRule（処方安全アラートルール）:
  - alert_type ENUM(interaction/duplicate/allergy_cross/renal_dose/pim_elderly/high_risk/narcotic/max_days)
  - condition JSON, severity, message
  - ハイリスク薬: 厚労省 特定薬剤管理指導加算対象（薬効分類コードでマッピング）
  - 高齢者PIM: 厚労省 高齢者の医薬品適正使用の指針（PDF→構造化、手動初期投入）
  - 腎機能用量調整: JSNP 投与量一覧 第37版（PDF→構造化、手動初期投入）
- [x] PharmacyDrugStock（在庫医薬品マスタ — テナント別）:
  - site_id, drug_master_id, is_stocked BOOLEAN, stock_qty（概算在庫数）, reorder_point
  - last_dispensed_at, preferred_generic_id（当薬局の採用後発品）
  - 用途: 調剤時に「当薬局に在庫がある薬剤」のみフィルタ表示、欠品時の代替候補提示、一般名処方→採用後発品の自動選択
  - 在庫数は概算管理（厳密な在庫管理はレセコン/在庫システムの責務。PH-OSは訪問調剤の実務支援に絞る）
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
  - 患者基本、処方原本、調剤実績、持参情報、報告書送達、請求候補ごとに「PH-OS正本 / 外部正本 / 同期方向 / 障害時復旧手順」を定義
  - `docs/compliance/responsibility-matrix.md` に D-12 対応の責任分界表・復旧手順・`org_id` 例外を明文化
  - `prisma/seed.ts` で `patient_basic` / `prescription_original` / `dispense_result` / `carry_items` / `report_delivery` / `billing` の初期 `SourceOfTruthMatrix` を投入
- [x] Setting（4層）, LabelDictionary
- [x] 全テーブル: created_at, updated_at, org_id, `@@index`, `prisma generate`
  - `AuditLog.updated_at` を追加し、`Organization` / `Setting` / `LabelDictionary` / `DrugMasterImportLog` の index を補完
  - グローバル参照マスタと共通辞書は `org_id` 例外として責任分界表に明記
  - `pnpm db:generate` / `pnpm exec eslint prisma/seed.ts` を確認

</details>
### 0-2i. 医薬品マスタ取込パイプライン `cc:blocked` <!-- PMDA メディナビ登録（外部手続き）待ち -->

> depends: 0-2e（マスタテーブル作成後） | DoD: 全データソースから取込完了、DrugMaster 1万3千品目+、相互作用データ検索可能
> 2026-03-27 進捗:
>
> - SSK 公開ページから最新 ZIP を解決し、ZIP 展開・Shift-JIS CSV 解析・`DrugMaster` upsert を行うサービスを追加
> - SSK 仕様書では医薬品全件マスターがダブルクォート付き CSV のため、実装は固定長ではなく quoted CSV パーサーを採用
> - `DrugMasterImportLog` 一覧 API / SSK 手動起動 API / 管理画面の手動取込ボタンを追加
> - SSK 項目 28/34 に合わせて `dosage_form` / `transitional_expiry_date` を反映
> - `/api/jobs/drug-master-refresh` と EventBridge 月次ジョブ雛形を追加し、最新 ZIP URL が未更新なら skip する差分確認を実装
> - SSK 項目 36（薬価基準収載年月日）から新医薬品の14日制限を導出し、`max_administration_days` を自動設定

**SSK基本マスター取込（第1層・保険請求基盤）:**

- [x] SSK ZIP ダウンロード → 解凍 → Shift-JIS→UTF-8変換 → 固定長テキストパース
  - 公式 SSK 全件マスターは quoted CSV のため、実装は固定長ではなく CSV 列仕様に合わせてパース
- [x] DrugMaster へ全量ロード（YJコード/レセ電コード/薬価/薬効分類/後発品フラグ/麻薬区分/投与日数制限）
  - `max_administration_days` は SSK の薬価基準収載年月日から「新医薬品の初年度14日制限」を導出して設定
- [x] HOTコードマスター（MEDIS, 無料）取込 → DrugMaster.hot_code へ結合
  - 2026-03-28: `src/server/services/drug-master-import/hot.ts` と `/api/drug-master-imports/hot` を追加し、YJコード優先・販売名 fallback で `DrugMaster.hot_code` を更新
  - 実行時の配布 URL は `HOT_MASTER_URL` または API body の `fileUrl` で渡す前提
- [x] 更新スケジュール: 薬価改定時（4月）に全量入替 + 新薬収載時（月次）に差分確認
  - `drug-master-refresh` ジョブが最新 SSK ZIP URL を比較し、差分あり時のみ全量 upsert を実行

**厚労省 薬価・一般名マスタ取込（第2層）:**

- [x] 薬価基準収載品目リスト（Excel）パース → DrugMaster.drug_price 更新
  - 2026-03-28: MHLW `tpYYYYMMDD-01_01.xlsx` を自動解決して `DrugMaster.drug_price/manufacturer/dosage_form` を更新する parser と `/api/drug-master-imports/mhlw-price` を追加
- [x] 一般名処方マスタ（Excel）パース → GenericDrugMapping 生成
  - 2026-03-28: `ippanmeishohoumaster_*.xlsx` の本表 + 例外コード表を結合し、`GenericDrugMapping` を全再構築する import を追加
- [x] 後発医薬品リスト取込 → DrugMaster.is_generic 更新
  - 2026-03-28: MHLW 薬価リスト内の後発フラグ列を利用して `DrugMaster.is_generic` を更新し、一般名マスタ更新と合わせて `/api/drug-master-imports/mhlw-generic` / `drug-reference-refresh` ジョブを追加

**PMDA 添付文書取込（第3層・処方安全チェック基盤）:**

- [ ] PMDAメディナビ登録（無料）→ マイ医薬品集サービスで全医療用医薬品XMLを一括DL
  - 2026-03-28: importer 自体は実装済みだが、全量/差分 ZIP の取得は PMDA メディナビ/マイ医薬品集の登録と配布 URL 管理が前提
  - 2026-03-31: 管理画面に `PMDA_PACKAGE_INSERT_FULL_URL` / `PMDA_PACKAGE_INSERT_DELTA_URL` の運用前提を明記済み。ローカル実装完了、残作業は PMDA 側登録と配布 URL 発行のみ
  - 2026-04-01: `/api/admin/pilot-launch-dossier` と readiness 集計からは URL 実値を返さず、設定有無のみを返すように変更。残作業は PMDA 側登録と URL 発行、その後の実地 import 疎通確認のみ
  - 2026-04-04: URL 調査結果 — 登録不要の一括DL URLは存在しない。個別DLは `info.pmda.go.jp/go/pack/{ID}/` で可能だが一括は Medi-Navi 登録必須（無料）。登録: https://www.pmda.go.jp/safety/info-services/medi-navi/0007.html / サービス: https://www.pmda.go.jp/safety/info-services/medi-navi/0012.html
- [x] XML パーサー: 禁忌/併用禁忌/併用注意/重大な副作用/用法用量セクションを構造化抽出
  - 2026-03-28: `src/server/services/drug-master-import/pmda.ts` で XML/ZIP を解析し、主要セクションを構造化抽出
- [x] → DrugPackageInsert（禁忌/相互作用/副作用JSON）に保存
  - 2026-03-28: `/api/drug-master-imports/pmda` から `DrugPackageInsert` へ upsert 可能にした
- [x] → DrugInteraction テーブルへ併用禁忌・併用注意を展開（drug_a × drug_b ペア）
  - 2026-03-28: 相手薬剤コード/名称を `DrugMaster` と照合し、`pmda_xml` source の pair を upsert
- [x] 更新: PMDAメディナビの「指定期間更新分」DLで差分更新
  - 2026-03-28: `pmda-package-insert-refresh` ジョブと EventBridge 雛形を追加し、`PMDA_PACKAGE_INSERT_DELTA_URL` または `zipUrl` を使って差分 ZIP を処理

**手動構造化データ投入（第4層・高齢者/腎機能）:**

- [x] 高齢者PIMリスト（厚労省PDF）→ 手動で DrugAlertRule に投入（alert_type=pim_elderly）
  - 2026-03-28: `/api/drug-master-imports/manual-clinical` と `manual.ts` を追加し、手入力/転記 JSON で `pim_elderly` ルールを全置換できるようにした
- [x] 腎機能別用量調整（JSNP PDF 第37版）→ 手動で DrugPackageInsert.dosage_adjustment_renal に投入
  - 2026-03-28: 同じ manual clinical bundle から `DrugPackageInsert.dosage_adjustment_renal` と `precautions_elderly` を更新可能にした
- [x] ハイリスク薬（特定薬剤管理指導加算対象）→ 薬効分類コードで DrugAlertRule にマッピング
  - 2026-03-28: manual clinical bundle で `high_risk` ルールを `yj_codes` / `therapeutic_categories` 条件付きで差し替え可能にした

**管理画面:**

- [x] 医薬品マスタ検索画面: YJコード/品名/薬効分類で検索、添付文書詳細表示
- [x] 取込履歴一覧（DrugMasterImportLog）: ソース別の最終取込日時・件数・エラー
- [x] 手動取込トリガーボタン（管理者権限）

### 0-3. 認証・権限・RLS基盤 (FR-501) `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 0-2 | DoD: RLS正当性テスト通過

- [x] Prisma + RLS（SET LOCAL）, ヘルパー関数, 全テーブルポリシー, S3ポリシー
  - 2026-03-28: `withOrgContext` で `app.current_org_id/current_actor_id/current_member_role/current_ip_address/current_user_agent` を `set_config` で注入し、`tools/infra/file-storage-bucket-policy.json` と presigned PUT の SSE 強制を追加
- [x] RLS正当性テスト（Vitest）, 権限マトリクス（7ロール+工程フラグ4種）
  - 2026-03-28: `src/lib/db/__tests__/rls.test.ts` で transaction context 注入を検証し、`src/lib/auth/__tests__/permissions.test.ts` で 7 ロール x 4 工程フラグの matrix を固定

**認証画面フロー（Cognito + NextAuth）:**

- [x] ログイン画面: メール+パスワード入力、エラー表示（無効な認証情報/ロックアウト中）
- [x] MFA/TOTP 入力画面: 6桁コード入力、リカバリーコードフォールバック
- [x] MFA 初期設定: QRコード表示 → TOTP登録 → 確認コード検証 → リカバリーコード表示+保存促進
- [x] パスワード変更: 現在のパスワード+新パスワード（13文字以上、強度インジケータ）
- [x] パスワードリセット: メール入力→確認コード→新パスワード設定
- [x] 初回ログイン: パスワード強制変更 + MFA設定必須
- [x] セッションタイムアウト（30分）: 再認証モーダル（パスワード再入力、操作中データは保持）
- [x] アカウントロックアウト時: 案内画面（管理者への連絡方法を表示）
- [x] ユーザー設定/マイページ:
  - プロフィール編集（表示名、連絡先）
  - MFA設定管理（TOTP追加/削除）
  - 通知設定（種別ごとのON/OFF、ブラウザPush許可）
  - 薬剤師: 自分の訪問実績サマリー、今月の訪問カウンター

</details>
### 0-4. 共通基盤 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 0-3 | DoD: App Shell動作、監査ログ書込み、CRUD 1つ動作

- [x] App Shell + グローバルナビ + レスポンシブ + WCAG AA
- [x] 監査ログ(PostgreSQLトリガー) + API ヘルパー(Zod 4) + レート制限 + TanStack Query 5
  - 2026-03-28: `prisma/migrations/20260328120000_audit_log_triggers/migration.sql` で critical tables の DB 監査トリガーを追加。`src/lib/api/rate-limit.ts` は path 単位 bucket に修正し、`src/proxy.test.ts` / `src/lib/api/rate-limit.test.ts` を追加
- [x] メール送信(SES) + 文言辞書(LabelDictionary)

**グローバルナビゲーション設計:**

- [x] デスクトップ: 左サイドバー（工程別メニュー: 受付/調剤/鑑査/セット/訪問/報告 + 管理メニュー）
- [x] サイドバー折りたたみ（アイコンのみ表示）+ ピン固定切替
- [x] パンくずリスト: 患者→ケース→訪問記録 等の階層表示
- [x] グローバル検索バー（Cmd+K）: 患者名/薬剤名/コードで横断検索、最近の操作履歴
- [x] モバイル: ボトムタブナビ（本日の訪問/患者/スケジュール/通知/メニュー）
- [x] タブレット: サイドバー折りたたみデフォルト、スワイプで展開

**通知UI:**

- [x] インアプリ通知センター: ヘッダーのベルアイコン + ドロワー（未読バッジ付き）
- [x] トースト通知: 操作完了/エラー/警告の一時表示（sonner or shadcn/ui toast）
- [x] ブラウザPush通知: PWA Service Worker 経由、ユーザー許可制（緊急訪問/差戻し等）
- [x] 通知種別フィルタ: 緊急/業務/リマインド/システム
- [x] 既読管理: 個別既読 + 一括既読

**フォーム共通基盤:**

- [x] react-hook-form + @hookform/resolvers/zod（サーバー/クライアント同一Zodスキーマ）
- [x] バリデーションUI: フィールド横インラインエラー + 送信時サマリー（上部にスクロール）
- [x] 離脱防止: `beforeunload` + Next.js Router イベントで未保存警告ダイアログ
- [x] 自動保存: 訪問記録/SOAP等の長文入力は debounce 30秒で下書き保存（Dexie → Phase 2でサーバー同期）

**共通UIパターン:**

- [x] ローディング: 一覧→スケルトン、操作ボタン→スピナー、ページ遷移→トップバーのプログレスバー
- [x] 空状態（Zero State）: データなし時のイラスト+CTAボタン（「最初の患者を登録」等）
- [x] 初期導入オンボーディング: ステップガイド（組織設定→薬剤師登録→患者登録→初回訪問）
- [x] エラー画面: 404/500/ネットワークエラー/RLS権限エラーの各テンプレート
- [x] 確認ダイアログ: 破壊的操作（キャンセル/削除/差戻し）の共通ConfirmDialogコンポーネント
- [x] 二重確認: 取消不可操作はテキスト入力確認（「キャンセル」と入力して確定）

**データテーブル共通コンポーネント:**

- [x] TanStack Table v8 + shadcn/ui DataTable ベース
- [x] 標準機能: 列ソート、列フィルタ、列表示/非表示切替、列幅リサイズ、sticky header、zebra stripe
- [x] 行選択（チェックボックス、一括操作用）、行展開（詳細インライン表示）
- [x] CSV エクスポートボタン、印刷ボタン
- [x] レスポンシブ: デスクトップ→フルテーブル、タブレット→列優先度で非表示、モバイル→カードリスト表示に切替

**状態管理設計:**

- [x] Zustand ストア構成:
  - `useAuthStore`: 認証状態、現在ユーザー、現在組織/店舗
  - `useUIStore`: サイドバー開閉、テーマ、通知ドロワー、モーダル管理
  - `useOfflineStore`: 同期状態、キャッシュTTL、オフラインフラグ、ペンディングキュー
- [x] TanStack Query: サーバー状態の一元管理（Zustandと責務分離: Zustand=クライアントUI状態のみ）

**レスポンシブブレークポイント戦略:**

- [x] デスクトップ(≥1280px): フル機能、サイドバー常時表示、データテーブル、マルチペイン
- [x] タブレット(768-1279px): 訪問記録入力の主要デバイス、サイドバー折りたたみ、シングルペイン+ドロワー
- [x] モバイル(≤767px): 本日の訪問、訪問記録、通知確認に特化、ボトムタブナビ
- [x] デバイス対応マトリクス:
  - 2026-03-28: `src/app/(dashboard)/dashboard/device-support-matrix.tsx` を追加し、dashboard から breakpoint 別の対応範囲を確認可能にした
    | 画面 | デスクトップ | タブレット | モバイル |
    |---|---|---|---|
    | ダッシュボード | ◎フル | ◎フル | ○簡易版 |
    | スケジュールカレンダー | ◎月/週/日 | ○週/日 | ○日+リスト |
    | 本日の訪問 | ◎ | ◎ | ◎（主要画面）|
    | 訪問記録(SOAP) | ◎ | ◎（主要入力）| ○（最小入力）|
    | 調剤キュー/鑑査 | ◎ | ○ | ×（非対応）|
    | 処方エディタ | ◎ | ○ | ×（非対応）|
    | 管理設定 | ◎ | ○ | ×（非対応）|

**印刷スタイル:**

- [x] `@media print` グローバルスタイル: ナビ/サイドバー/フッター非表示、改ページ制御
- [x] 薬歴/報告書/服薬カレンダー/計画書: 各印刷レイアウト（A4縦）
- [x] PDF出力（送付用）とブラウザ印刷（手元確認用）の使い分けUI

**API Route 設計規約:**

- [x] RESTful エンドポイント一覧定義（Next.js Route Handlers）:
  - 患者系: `POST/GET/PATCH /api/patients`, `GET /api/patients/:id/timeline`
  - ケース系: `POST /api/cases`, `PATCH /api/cases/:id/transition`
  - スケジュール系: `POST/GET/PATCH/DELETE /api/visit-schedules`, `POST /api/visit-schedules/generate`（定期一括生成）, `GET /api/visit-schedules/today`
  - 訪問記録系: `POST/GET/PATCH /api/visit-records`
  - 処方系: `POST /api/prescription-intakes`, `POST /api/medication-cycles`, `PATCH /api/medication-cycles/:id/transition`
  - 調剤系: `GET /api/dispense-queue`, `POST /api/dispense-results`, `POST /api/dispense-audits`
  - 報告系: `POST /api/care-reports`, `POST /api/care-reports/:id/send`, `POST /api/tracing-reports`
  - シフト系: `GET/POST/PATCH /api/pharmacist-shifts`, `GET /api/pharmacist-shifts/available?date=&time=`（空き検索）
  - ダッシュボード系: `GET /api/dashboard/today`, `GET /api/dashboard/overdue`, `GET /api/dashboard/monthly-stats`, `GET /api/dashboard/workflow`, `GET /api/dashboard/medication-deadlines`
  - マスタ系: `GET /api/drugs?q=&category=`（医薬品検索）, `POST /api/drug-master/import`
  - 全エンドポイントに認可ミドルウェア（ロール+工程フラグ検証）を適用
- [x] エラーレスポンス標準形式:
  - `{ code: string, message: string, details?: object }` 統一フォーマット
  - エラーコード体系: `AUTH_*`, `VALIDATION_*`, `WORKFLOW_*`, `RLS_*`, `EXTERNAL_*`
  - i18n 対応: LabelDictionary 参照でクライアント向けメッセージを日本語化
  - HTTP ステータス: 400(バリデーション), 401(未認証), 403(権限不足), 404(不存在), 409(競合/状態遷移不正), 422(業務ルール違反), 500(内部エラー)
- [x] ページネーション戦略:
  - 一覧系API: cursor ベース（大量データ対応、リアルタイム追加に強い）
  - レスポンス形式: `{ data: T[], nextCursor?: string, hasMore: boolean, totalCount?: number }`
  - デフォルト件数: 一覧50件、ダッシュボード10件、検索20件
- [x] 楽観的ロック:
  - VisitRecord, MedicationCycle, SetBatch 等の同時編集対象テーブルに `version` カラム追加
  - 更新時に `WHERE version = :expected` → 不一致で 409 Conflict 返却
  - クライアント側: TanStack Query の `onError` で競合検知→リフェッチ→差分表示

**ファイルアップロード/ダウンロード:**

- [x] `POST /api/files/presigned-upload` — S3 presigned PUT URL 発行（MIME制限、サイズ制限、有効期限5分）
- [x] `GET /api/files/:id/presigned-download` — S3 presigned GET URL 発行（有効期限15分）
- [x] 用途別パス: `prescriptions/{orgId}/{patientId}/`, `visit-photos/{orgId}/{visitId}/`, `reports/{orgId}/{reportId}/`
- [x] アップロード完了コールバック: クライアント→API→メタデータDB保存 + ウイルススキャン（将来）

**PDF 生成サービス:**

- [x] 技術選定: React-PDF(@react-pdf/renderer) をサーバーサイドで実行（Next.js Route Handler内）
- [x] テンプレート: 報告書/計画書/薬歴/服薬カレンダー/トレーシングレポートの各テンプレートコンポーネント
- [x] 一括出力: 個別指導対応（数百件）→ キュー制御 + ZIP 圧縮 + S3一時保存 + ダウンロードURL通知
  - 2026-03-28: 患者一覧から選択した薬歴PDFを `IntegrationJob` キューで ZIP 化し、`bulk-exports/{orgId}/{jobId}/` に一時保存。完了時は通知から直接ダウンロード可能。
- [x] A4 縦/横切替、ヘッダ/フッタ（薬局名、ページ番号、出力日時）

**検索 API 共通仕様:**

- [x] 全文検索: 患者名/薬剤名はカナ・部分一致対応（PostgreSQL `ILIKE` or `pg_trgm`）
- [x] フィルタ: Zod スキーマで型安全なクエリパラメータ（`?status=active&from=2026-01-01&pharmacistId=xxx`）
- [x] ソート: `?sort=scheduled_date&order=asc`（デフォルトソートは各エンドポイントで定義）

</details>
### 0-5. 監視・バックアップ・ガイドライン準拠 `cc:blocked` <!-- I-04 バックアップ復旧試験（AWS認証情報）待ち -->

> depends: 0-1 | DoD: 復旧試験完了、監視稼働、ガイドライン文書5点+本番インフラ完備
> 2026-03-28 GAP分析: 本番インフラ・コンプライアンス文書・セキュリティ強化の3領域で重大な不足を検出

- [x] 責任分界表/プライバシーポリシー/利用目的明示/IT-BCP/インシデント手順書 + セッションタイムアウト(30分)
- [x] 監査ログエクスポート:
  - [x] 閲覧API: `GET /api/audit-logs?actor=&target=&action=&from=&to=`（UI互換の `target_type` / `date_from` / `date_to` も受理）
  - [x] CSV/JSON エクスポート: ガイドライン監査対応（外部監査人への提出用）
  - [x] 保存期間: 5年（CloudWatch Logs → S3 Glacier アーカイブ）

**0-5a. 本番インフラ — パイロット前ブロッカー:**

- [x] I-01: AWS WAF 構成 `cc:完了` (2026-03-31)
  - SQL injection / XSS / レートリミット / geo-blocking ルール定義
  - ALB or CloudFront 前段に配置、ログを S3 へ出力
  - 日本リージョン限定アクセスの IP レピュテーションフィルタ
- [x] I-02: VPC / セキュリティグループ設計 `cc:完了` (2026-03-31)
  - パブリックサブネット（ALB/NAT）+ プライベートサブネット（RDS/Lambda）の2層構成
  - RDS はプライベートサブネット限定、Bastion or SSM Session Manager 経由のみ
  - セキュリティグループ定義: ALB→App（443）、App→RDS（5432）、App→S3（VPC Endpoint）
- [x] I-03: S3 暗号化を KMS に移行 `cc:完了` (2026-03-31)
  - 現在 AES256 → AWS KMS（CMK）に切替
  - 鍵ローテーションポリシー（年1回自動）
  - データ分類別の鍵分離: PHI用 / 監査ログ用 / 一般用
- [ ] I-04: バックアップ復旧試験の実施 `cc:TODO`
  - `docs/compliance/backup-recovery-drill.md` の手順に沿って初回実施
  - RDS ポイントインタイムリカバリ、S3 バージョニング復元、Cognito ユーザープールバックアップ
  - 実施記録を `docs/compliance/backup-recovery-drill.md` に追記
  - RTO 4h / RPO 24h の実測検証
  - 2026-03-31: `tools/scripts/backup-recovery-check.ts` と `pnpm backup:drill:check` を追加し、前提確認と試験記録追記を自動化
  - 2026-03-31: `corepack pnpm backup:drill:check --append ...` で机上訓練の前提確認記録を追記。実地復旧は AWS 接続情報未設定のため継続タスク
  - 2026-03-31: ローカル確認では必須ファイルは揃っており、`DATABASE_URL` / `AWS_REGION` 未設定のみが live drill の blocker。AWS 権限付与後に同手順で実地記録を追記する
  - 2026-04-01: `backup:drill:check --append --mode live|tabletop` で机上訓練と実地復旧を区別して記録できるようにし、 dossier/readiness でも live drill 未実施を別 blocker として検出する
- [x] I-05: RDS 構成の明文化 `cc:完了` (2026-03-31)
  - Multi-AZ 有効化確認、自動バックアップ保持期間（35日）、パラメータグループ定義
  - 削除保護 / 最終スナップショットポリシー
  - サブネットグループ定義（I-02 のプライベートサブネット）

**0-5b. セキュリティ強化:**

- [x] I-06: CSP の `unsafe-eval`/`unsafe-inline` 除去 `cc:完了` (2026-03-31)
  - ビルド時 nonce 生成方式に切替
  - `next.config.ts` の `Content-Security-Policy` を本番用に厳格化
  - 2026-03-31: `src/proxy.ts` を nonce ベースの本番 CSP に変更し、`style-src 'self' 'nonce-...'` へ移行。アプリ内の inline `style` / `<style>` を撤去した。開発環境のみ Next.js 16 の公式ガイドに従って `unsafe-eval` / `unsafe-inline` を維持
- [x] I-07: 分散レートリミット `cc:完了` (2026-03-31)
  - 現在の in-memory Map → Redis or DynamoDB ベースに移行
  - マルチインスタンス対応、再起動時のリセット防止
  - GET（情報取得）と POST（書込み）でリミット値を分離
  - SSE `/stream` エンドポイントのレートリミット除外を見直し
- [x] I-08: セキュリティイベントログ `cc:完了` (2026-03-31)
  - 認証失敗 / CSRF 拒否 / レートリミット超過 / RLS コンテキスト未設定を AuditLog に記録
  - `src/proxy.ts` と `src/lib/auth/middleware.ts` にセキュリティイベント記録を追加

**0-5c. コンプライアンス文書（3省2ガイドライン監査対応）:**

- [x] C-01: アクセス制御ポリシー文書 `cc:完了` (2026-03-31)
  - 7ロール × 権限マトリクスの正式文書化（`docs/compliance/access-control-policy.md`）
  - 物理アクセス制御 / 特権アクセス管理（PAM）手順
- [x] C-02: 変更管理・リリース手順書 `cc:完了` (2026-03-31)
  - コードレビュー / 承認 / デプロイ / ロールバック手順（`docs/compliance/change-management.md`）
  - 本番デプロイ前チェックリスト
- [x] C-03: データ分類基準 `cc:完了` (2026-03-31)
  - PHI / PII / 一般データの3段階分類定義（`docs/compliance/data-classification.md`）
  - テーブル / カラム単位の機密度ラベル
  - データ保持 vs 削除ポリシーの粒度定義（5年一律ではなくカテゴリ別）
- [x] C-04: 脆弱性管理 `cc:完了` (2026-03-31)
  - SAST / DAST / 依存関係スキャンの CI/CD 統合
  - パッチ適用 SLA（Critical: 48h, High: 7d, Medium: 30d）
  - 脆弱性開示ポリシー（`docs/compliance/vulnerability-management.md`）
- [x] C-05: 委託先リスク評価 `cc:完了` (2026-03-31)
  - AWS サービス別のセキュリティ契約整理（`docs/compliance/vendor-risk-assessment.md`）
  - サブプロセッサリスト（SES, Cognito, S3 等）
- [x] C-06: セキュリティ教育計画 `cc:完了` (2026-03-31)
  - 従業員向け年次セキュリティ研修カリキュラム
  - インシデント対応机上演習スケジュール
- [x] C-07: 3省2ガイドライン統制マッピング `cc:完了` (2026-03-31)
  - MHLW v6.0 の統制項目ごとの充足チェックリスト（`docs/compliance/mhlw-v6-mapping.md`）
  - METI/MIC v1.1 の統制項目ごとの充足チェックリスト（`docs/compliance/meti-mic-v1.1-mapping.md`）

### 0-6. バックグラウンドジョブ・定期タスク `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 0-4 | DoD: 全ジョブが CloudWatch Events (EventBridge) or cron で稼働

- [x] ジョブ実行基盤: Next.js Route Handler + EventBridge Scheduler（またはAmplify Functions scheduled trigger）
- [x] 日次ジョブ:
  - 服用最終日接近チェック → medication_end_date が3日以内で未訪問 → Notification生成 + ダッシュボード警告
  - リフィル処方箋の次回調剤日通知 → refill_next_dispense_date が7日以内 → 担当者通知
  - 処方箋有効期限切れ警告 → prescription_expiry_date が翌日 → 受付担当通知
  - 施設基準更新期限アラート → 期限60日/30日/7日前にステップ通知
  - 研修認定有効期限アラート → PharmacistCredential.expiry 90日/30日前
  - 管理指導計画書月次更新リマインド → ManagementPlan の前回更新から30日超
  - 同意書有効期限チェック → ConsentRecord.expiry が30日以内 → リマインド
- [x] 当日夕方ジョブ:
  - 薬歴未記入リマインド → 訪問完了(completed)だが VisitRecord 未作成 → 担当薬剤師通知
- [x] 翌営業日ジョブ:
  - 報告書未送付リマインド → VisitRecord 作成済みだが CareReport/DeliveryRecord 未送付 → 担当者通知
- [x] 月次ジョブ:
  - 月間訪問回数集計 → 上限未達/超過の患者一覧レポート生成
  - 経営指標集計 → 処方箋集中率、後発品割合、在宅訪問実績の月次スナップショット保存
- [x] ジョブ共通: 実行ログ（IntegrationJob）、失敗時リトライ（最大3回）、管理者通知

</details>

## Phase 1a: MVP — 患者・訪問・記録 `cc:blocked` <!-- 1a-6 ISMS認証（外部依存）でブロック -->

> depends: Phase 0a Core 完了
> 出口条件: 患者登録→処方差分確認→持参可否確認→訪問計画→訪問記録→報告書送付の基本サイクルが回る
> ※ MVP でも `MedicationCycle` を維持するため、①〜⑤の全量実装は後段でも「薄い upstream slice」は先に入れる

### 1a-1. 患者・案件管理 `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

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
  - 2026-03-31: 同意、管理計画書、配薬設定、薬剤課題、緊急連絡ドラフト更新後も patient detail だけでなく schedule / My Day / dashboard に反映されるよう invalidate を共通化した

</details>
### 1a-2. ⑥ 訪問計画・ルート最適化 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1a-1 | DoD: 訪問予定作成→定期スケジュール生成→準備チェック→当日表示→予定変更連絡が動作

**MVPで先に入れる upstream slice:**

- [x] 訪問予定ごとの処方差分サマリー（前回からの追加/中止/用量変更）
- [x] 持参可否フラグ（carry_items_ready / partial / blocked）
- [x] 未解決課題・疑義照会中・要確認事項の一覧表示
- [x] 持参薬未確定でも予定作成は可能だが、出発前に強い警告を表示
  - 2026-03-28: `day-view` の訪問開始を confirm 導線にし、`carry_items_status=blocked/partial` では destructive warning を出す。`visit-record-form` 上部にも同じ warning を表示

**訪問スケジュール (FR-101):**

- [x] カレンダー(日/週/月) + リスト: 担当者別/施設別/患者別ビュー
  - 2026-03-31: 月表示 `CalendarView` の 200 件固定取得をページネーション追従に変更し、日別パネルから患者詳細 / 訪問記録へ直接遷移できるようにした
  - 2026-03-31: `My Day` / `CalendarView` の visit type・status・時間帯表示を `day-view.shared` に揃え、訪問ボードと同じ語彙で見えるように統一した
- [x] 訪問タイプ7種: 初回/定期/臨時/再訪/配薬のみ/緊急/医師同行
- [x] 定期訪問の繰返しルール: RRULE形式（月2回第1・第3火曜等）→自動生成
  - 月間訪問回数の自動カウント（医療保険4回/介護保険2回の上限管理）
  - 週1回制限（2026年改定）の自動チェック
- [x] 服用期間ベースの訪問期限管理:
  - 処方内容から服用開始日・服用最終日を自動計算（処方日 + 投与日数）
  - 原則: 前回の服用最終日より前に次回訪問を実施
  - 服用最終日が近づく患者をダッシュボード/カレンダー上で警告表示
  - 複数薬剤がある場合は最も早い服用最終日を訪問期限として採用
- [x] 施設受入時間帯・患者在宅時間帯の制約設定
- [x] 緊急訪問の割込み: 既存スケジュールへの挿入、影響を受ける予定の自動リスケ提案
- [x] 予定変更時の連携ループ:
  - 理由コード、連絡先、連絡チャネル、送信/口頭結果を同時記録
  - 施設/家族/看護/ケアマネへの連絡タスク自動生成
- [x] 薬剤師シフト連動: PharmacistShift参照→当日訪問可能な薬剤師のみ担当候補に表示、かかりつけ薬剤師優先割当
- [x] シフト管理API:
  - CRUD: 日別/週間/月間パターンの一括登録・編集
  - 空き薬剤師検索: `GET /api/pharmacist-shifts/available?date=&timeFrom=&timeTo=` → 候補リスト（かかりつけ優先ソート）
  - シフト変更時: 当日の訪問予定との整合性チェック → 担当不在なら再割当アラート

**施設一括訪問 (FacilityVisitBatch) — Pilot条件付き:**

- [x] 同一施設の複数患者をグループ化して計画
- [x] 施設単位の訪問日管理（月次の定期訪問日を施設ごとに設定）
- [x] バッチ内の患者順序（部屋番号順等）の設定
- [x] バッチ単位の持参薬一括確認
  - ※ パイロットで施設患者が主要ユースケースでない場合は Phase 2 に移動

**ルート運用:**

- [x] MVPは手動並べ替えを優先（ドラッグ&ドロップ）
- [x] 薬局住所（PharmacySite.lat/lng）→ 各患者/施設住所（Residence.lat/lng）の地図表示
- [x] Google Routes API（Waypoint optimization）連携は P1:
  - 当日の訪問先リスト → 最適順序 + 推定移動時間 → route_order に反映
  - 交通手段: 車/自転車/徒歩の選択
  - 時間ウィンドウ対応は Phase 1b+ で Route Optimization API に切替え

**地図UIコンポーネント:**

- [x] ライブラリ: `@vis.gl/react-google-maps`（Google公式React wrapper）
- [x] 訪問先マーカー: 番号付きピン、色分け（未訪問=青、訪問中=緑、完了=灰、緊急=赤）
- [x] ルート線描画: Google Directions API で薬局→各訪問先の経路表示
- [x] マーカータップ → 患者名/住所/推定到着時刻のポップアップ
- [x] モバイル: 地図⇔リストのトグル切替（デフォルトはリスト）

**訪問前準備 (VisitPreparation):**

- [x] 当日朝の準備チェックリスト画面:
  - 処方変更の有無確認（前回訪問以降の変更をハイライト）
  - 前回の未解決課題一覧
  - 持参薬・セット品の確認チェック
  - ルート確認（地図表示 + 推定到着時刻）
  - オフライン同期済みかどうかの表示
- [x] チェック完了 → VisitPreparation レコード保存 → 「出発準備完了」ステータス
- [x] 未完了項目がある状態での出発に警告表示

**本日の訪問 (FR-102):**

- [x] モバイル最適化: 訪問順に患者カード表示
  - 2026-03-31: モバイル訪問カードの患者名を患者詳細リンク化し、訪問中でも患者情報へ 1 tap で戻れるようにした
- [x] 各カードに: 患者名/住所/推定到着時刻/前回課題数/持参物チェック/ナビ起動ボタン
- [x] 訪問開始ボタン → 位置情報記録（任意）→ 訪問記録画面へ遷移
  - 2026-03-31: 患者基本情報 / 連絡先 / 病名課題 / ケアチーム / 訪問条件 / ケース更新後に、患者詳細だけでなく schedule / My Day / dashboard まで org-aware に再取得するよう統一した

</details>
### 1a-3. ⑦ 訪問実施・記録 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1a-2 | DoD: SOAP記録→残薬入力→次回提案→当日参照オフラインが動作

**訪問記録入力 (FR-103):**

- [x] SOAP構造化入力（S:患者訴え/服薬状況, O:残薬/保管/副作用/介助者, A:薬学評価, P:介入/次回対応/連携要否）
- [x] 残薬入力: 薬剤別の残数・日数 → 余剰日数自動計算 → ResidualMedication保存
- [x] 受領記録（受領者名・続柄・日時）
- [x] 写真・添付 (FR-104): S3, 10MB/50MB, MIMEタイプ制限
  - 2026-03-28: 訪問記録フォームから JPEG/PNG/WEBP(10MB) と PDF(50MB) を presigned upload で保存し、`VisitRecord.attachments` に紐づけ、詳細画面から再ダウンロード可能にした
- [x] 訪問中止・再訪・延期 (FR-105): 理由コード必須
- [x] outcome_status に応じて `MedicationCycle` / `BillingEvidence` / 次回タスクへ自動反映
  - 2026-03-31: `visit-record-form` 保存後に patient / schedule / My Day / dashboard / task board をまとめて invalidate し、記録直後の stale 表示を解消した

**薬歴の法定保存・出力（P0: リリースブロッカー）:**

- [x] VisitRecord（薬歴）の保存期間管理: 5年保持、期限切れ予告アラート
  - 2026-03-28: `daily-visit-record-retention` を追加し、5年保存期限の30日/7日前に通知 + Task を自動生成
- [x] e文書法三原則: 真正性（修正時刻+修正者を薬歴UI上に直接表示）、見読性（即時PDF出力）、保存性（S3 Object Lock）
  - 2026-03-28: 訪問記録詳細 UI に最終更新者を直接表示し、`/api/visit-records/:id/pdf` で即時PDF出力、原本スキャン側は `prescription` upload に 5年 Object Lock header を付与
- [x] 薬歴印刷・PDF出力: 患者単位の一覧、期間指定、一括出力（個別指導時に数十〜数百件を提出）
  - 2026-03-28: 患者詳細の訪問記録タブに期間指定 + PDF/印刷導線を追加し、`/api/patients/:id/visit-records/pdf` と `/patients/:id/visit-records/print` を実装
- [x] 個別指導対応セットは Phase 2 へ移動（MVPでは患者単位PDF/一覧出力まで）
  - 2026-03-28: MVP は患者単位 PDF/印刷までで止め、個別指導の大量提出セットは Phase 2 扱いに固定
- [x] 処方箋保存期限管理: S3 Object Lock 5年設定、原本スキャンの保存期限アラート
  - 2026-03-28: `prescription` presigned upload に 5年 COMPLIANCE Object Lock を付与し、`daily-prescription-original-retention` で原本スキャンの期限前通知 + Task を追加

**訪問後→次回訪問:**

- [x] 訪問完了時に次回訪問日の自動提案（定期ルールから計算、前回からの間隔表示、服用最終日を超えない日付を優先提案）
  - 2026-03-28: `RRULE` から次回候補を自動計算し、`medication_end_date` / `visit_deadline_date` を超えない範囲で `next_visit_suggestion_date` に自動補完するようにした
- [x] 提案日の確認→VisitSchedule自動生成 or 手動調整
  - 2026-03-28: 訪問記録詳細の次回訪問カードから提案日で `VisitSchedule` を即時作成でき、手動調整は `/schedules` 導線に繋げた
- [x] 月間訪問回数のカウンター表示（上限に対する進捗）
  - 2026-03-28: 患者詳細の訪問タブで今月の予定回数を医療 4 回 / 介護 2 回基準の badge で表示するようにした
- [x] 訪問当日中の薬歴記入リマインド（未記録→ダッシュボードに警告）
  - 2026-03-28: `evening-unrecorded-visits` で当日完了済み訪問の未記録分を担当薬剤師へ通知
- [x] 報告書作成リマインド（訪問翌営業日までに送付が目安）
  - 2026-03-28: `next-day` で翌営業日基準の未送付報告書 reminder を通知

**オフライン (FR-106 Ph1):**

- [x] Serwist + Dexie 4, AES-GCM暗号化, TTL 24h
  - 2026-03-28: `@serwist/next` で service worker を有効化し、Dexie の軽量 brief / 同期 payload / SOAP 下書きを AES-GCM で暗号化、24h TTL cleanup を root bootstrap で実行するようにした
- [x] 朝の事前同期: 当日訪問予定、患者サマリー、前回課題、持参チェック対象
  - 2026-03-28: `/schedules` で当日 visit brief を端末へ事前同期し、最終同期時刻つきの read-only キャッシュとして再利用できるようにした
- [x] オフラインインジケータ: 読取専用キャッシュであることを明示
  - 2026-03-28: app shell のオフライン banner と schedule board のモバイル訪問モードに read-only / TTL 表記を追加した
- [x] 下書き同期は Phase 2（FR-106 Ph2）に後ろ倒し

</details>
### 1a-4. 薬学的課題 + QRコード `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1a-1 | DoD: 薬剤一覧、課題CRUD、QRスキャン→患者新規登録 or 既存選択→MedicationProfile保存が動作

- [x] 服薬中薬剤一覧(FR-201)、課題登録(FR-202)、照会管理(FR-203)
- [x] 未解決課題可視化(FR-204)、アレルギー・副作用歴(FR-205)
- [x] 残薬管理(ResidualMedication): 構造化 + 次回処方への反映提案
- [x] QR読取(FR-206): iOSスパイク→@zxing/browser→JAHISパーサー→保存
  - QR内の患者情報（氏名+生年月日）で既存Patient検索 → 候補一覧表示
  - 該当なし → **新規患者登録フローへ遷移**（QR由来の氏名・生年月日・性別を自動入力、不足項目のみ手入力）
  - 該当あり → 患者選択 → MedicationProfile へ薬剤情報を保存
- [x] お薬手帳QRコード生成（発行方向）: 調剤済み薬剤→JAHIS Ver.2.5形式QR生成（`qrcode` npm + Shift-JISエンコード）→印刷/画面表示

</details>
### 1a-5. ⑧ 報告・連携 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

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

</details>
### 1a-6. ダッシュボード + テスト `cc:blocked` <!-- ISMS認証（外部手続き）待ち -->

> depends: 1a-1〜1a-5 | DoD: E2E通過、パイロットデモ完了

- [x] ホーム: 本日訪問/未完了タスク/返信待ち/最近の案件/訪問前準備ステータス
- [x] 管理者: 未記録訪問/未送付報告/月間訪問回数進捗
- [x] ダッシュボード集計API（サーバーサイド）:
  - `GET /api/dashboard/today` — 本日訪問数・準備状況・未完了タスク・返信待ち件数
  - `GET /api/dashboard/overdue` — 薬歴未記入・報告書未送付・期限超過一覧
  - `GET /api/dashboard/monthly-stats?month=` — 患者別×保険種別の月間訪問回数進捗
  - `GET /api/dashboard/workflow` — MedicationCycle工程別停滞件数・WorkflowException未解消
  - `GET /api/dashboard/medication-deadlines` — 服用最終日接近患者一覧（3日/7日以内）
  - キャッシュ戦略: TanStack Query staleTime=60s、サーバー側は軽量集計ビュー or マテリアライズドビュー
- [x] E2E: 患者登録→予定作成→準備チェック→訪問→記録→報告書送付
  - 2026-03-28: `workflow-full-cycle.test.ts` に患者登録→ケース作成→予定生成→準備→訪問→報告書送付の統合ルートテストを追加した
- [x] RLSテスト + セッション管理UI + シードデータ

### 1a-7. モバイル/タブレットUI `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

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

</details>

## Phase 1b: ①処方箋応需→②調剤→③調剤鑑査→処方安全チェック `cc:blocked` <!-- 1b-6 ISMS + 1b-9 パイロットUAT（外部依存）でブロック -->

> depends: Phase 1a 完了
> 出口条件: 処方箋応需→疑義照会→調剤→鑑査→訪問→報告の完全サイクルが回る

### 1b-1. ① 処方箋応需（処方受付〜調剤開始前） `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

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

</details>
### 1b-2. ② 調剤 + ③ 調剤鑑査 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1b-1 | DoD: 調剤キュー→実績→鑑査→MedicationCycle状態遷移が動作

**② 調剤:**

- [x] 調剤作業キュー: 優先度順（緊急>臨時>定期）、期限表示、患者/施設別ビュー
- [x] PharmacyDrugStock 参照: 在庫薬のみフィルタ表示、欠品時→代替候補提示、一般名→採用後発品の自動選択
- [x] 明細別調剤実績入力(DispenseResult): 実績数量、差異/欠品/代替（理由コード必須）
- [x] 持参/施設預け/後送の区分 + 特記事項（冷所/麻薬/半割/粉砕不可/別包/一包化指示）
- [x] 調剤完了 → 鑑査キューへ通知、VisitSchedule.carry_items を自動更新

**③ 調剤鑑査:**

- [x] 鑑査待ち一覧（優先度順、期限超過ハイライト）
- [x] 3ペイン比較ビュー: 処方原本 / 構造化明細 / 調剤実績
- [x] 鑑査項目: 患者一致、薬剤名・規格・用量・日数、包装指示、高リスク薬フラグ、持参区分
- [x] 判定: 承認 / 差戻し（理由コード+補足必須）/ 保留 / 緊急例外承認（管理者権限+理由）
- [x] 承認 → MedicationCycle 状態自動更新 → セット対象 or 訪問持参候補へ
- [x] 差戻し → 調剤担当に即通知 + WorkflowException 自動起票

**キーボードショートカット（調剤・鑑査画面）:**

- [x] 調剤キュー: `↑/↓` 行移動、`Enter` 選択、`Cmd+Enter` 完了
- [x] 鑑査画面: `Tab` ペイン切替、`A` 承認、`R` 差戻し、`Space` チェック項目トグル
- [x] グローバル: `Cmd+K` 検索、`Cmd+N` 新規作成、`Esc` モーダル閉じ、`?` ショートカット一覧
- [x] ショートカットヘルプモーダル（`?`キーで表示）

</details>
### 1b-3. 処方安全チェック（臨床意思決定支援） `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1b-2, 0-2i（医薬品マスタ取込済み） | DoD: 調剤時・訪問記録時にアラート表示

- [x] 調剤時チェック（DrugMaster + DrugInteraction + DrugAlertRule 参照）:
  - 併用禁忌/注意アラート（処方内 + 服薬中薬剤との照合）
  - 重複投薬チェック（同一成分/同効薬）
  - アレルギー交差反応（患者アレルギー歴 × 薬効分類）
  - 投与日数制限超過チェック（DrugMaster.max_administration_days）
  - 麻薬/向精神薬の特別管理フラグ表示
- [x] 訪問記録時チェック:
  - 腎機能用量調整アラート（患者eGFR × DrugPackageInsert.dosage_adjustment_renal）
  - 高齢者PIMチェック（年齢 × DrugAlertRule.pim_elderly）
  - ハイリスク薬の服薬指導必須フラグ
- [x] 一般名処方時の後発品候補提示（GenericDrugMapping → 薬価比較表示）
- [x] 減数調剤WF: 残薬調整→処方医報告→禁止薬剤(麻薬/抗がん剤)ブロック
- [x] 初回訪問文書の自動生成+交付記録

</details>
### 1b-4. トレーシングレポート + 依頼/照会ワークフロー `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1a-5 | DoD: トレーシングレポート送付、依頼→返信→クローズが動作

- [x] TracingReport: 課題→起票→送付→受領確認
- [x] CommunicationRequest/Response: 状態遷移9段階
- [x] 返信待ち一覧 + エスカレーション

</details>
### 1b-5. 最小セット運用（Pilot前必須） `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1b-2 | DoD: セットが必要な患者に対して、最小限のセット→確認→持参反映が動作

- [x] セット対象患者のフラグ管理（pilot対象の明示）
- [x] 最小SetPlan: 対象期間、セット方式、注意事項
- [x] 最小SetAudit: 承認 / 差戻し / 部分承認
- [x] 部分承認時は carry_items_partial と再作業タスクを自動起票
- [x] 持参チェックリストへ確定反映

</details>
### 1b-6. ワークフローダッシュボード + テスト `cc:blocked` <!-- ISMS認証プロセス（外部依存）待ち -->

> depends: 1b-1〜1b-5 | DoD: E2Eで処方箋応需→調剤→鑑査→訪問→報告の完全サイクル通過

- [x] ワークフローダッシュボード: MedicationCycle工程別停滞 + WorkflowException未解消
- [x] 連携ダッシュボード: 送付失敗/期限超過/未返信
- [x] リフィル処方箋ダッシュボード: 次回調剤予定日一覧 + 期限切れアラート
- [x] billing evidence ダッシュボード: 算定不可理由 / 根拠不足 / 送付未完了
- [x] E2E: 処方箋応需→疑義照会→調剤→鑑査→訪問→報告の完全フロー
- [ ] ISMS認証プロセス開始
  - 2026-03-31: 技術側の prerequisite（アクセス制御、変更管理、データ分類、脆弱性管理、委託先評価、教育計画、3省2ガイドライン統制マッピング）は文書化済み。残作業は審査機関選定・見積取得・キックオフ日程確定
  - 2026-04-01: `pilot:dossier` / `/api/admin/pilot-launch-dossier` から comparison table / decision memo の未着手を継続検出できる状態を確認。残作業は外部見積取得と社内意思決定のみ

### 1b-7. テストカバレッジ強化 `cc:完了`

<details>
<summary>完了済み詳細 — クリックで展開</summary>

> depends: 1b-1〜1b-6 | DoD: 全 API ルートにユニットテスト、カバレッジ80%以上
> 2026-03-28 GAP分析: 157ルート中79ルート（50.4%）が未テスト

**T-01: 薬剤マスタ系（15ルート未テスト — 最優先）:**

- [x] `drug-masters/route.ts`, `drug-masters/[id]/route.ts`, `drug-masters/batch/route.ts` `cc:完了` (2026-03-30)
- [x] `drug-master-import-logs/route.ts` `cc:完了` (2026-03-30)
- [x] `drug-master-imports/ssk/route.ts`, `hot/route.ts`, `pmda/route.ts` `cc:完了` (2026-03-30)
- [x] `drug-master-imports/mhlw-price/route.ts`, `mhlw-generic/route.ts`, `manual-clinical/route.ts` `cc:完了` (2026-03-30)
- [x] `pharmacy-drug-stocks/route.ts` `cc:完了` (2026-03-30)

**T-02: 訪問管理系（6ルート未テスト）:**

- [x] `visit-schedules/route.ts`, `visit-schedules/today/route.ts` `cc:完了` (2026-03-30)
- [x] `visit-schedules/[id]/reschedule/approve/route.ts` `cc:完了` (2026-03-30)
- [x] `visit-schedule-proposals/route.ts` `cc:完了` (2026-03-30)
- [x] `care-reports/generate-from-visit/route.ts` `cc:完了` (2026-03-30)
- [x] `visit-brief-feedback/route.ts` `cc:完了` (2026-03-30)

**T-03: 患者管理系（4ルート未テスト）:**

- [x] `patients/route.ts`, `patients/check-duplicate/route.ts` `cc:完了` (2026-03-30)
- [x] `patients/[id]/prescriptions/route.ts`, `patients/[id]/visit-constraints/route.ts` `cc:完了` (2026-03-30)

**T-04: MedicationCycle / Issues（4ルート未テスト）:**

- [x] `medication-cycles/route.ts`, `medication-cycles/[id]/transition/route.ts` `cc:完了` (2026-03-30)
- [x] `medication-issues/route.ts`, `medication-issues/[id]/route.ts` `cc:完了` (2026-03-30)

**T-05: 認証・ユーザー設定系（6ルート未テスト） `cc:完了`:**

- [x] `auth/[...nextauth]/route.ts` `cc:完了` (2026-03-31)
- [x] `auth/password/reset/request/route.ts`, `auth/password/reset/confirm/route.ts` `cc:完了` (2026-03-31)
- [x] `auth/mfa/setup/route.ts`, `auth/mfa/disable/route.ts` `cc:完了` (2026-03-31)
- [x] `me/profile/route.ts` `cc:完了` (2026-03-31)

**T-06: PDF 生成系（7ルート — 共通テストで部分カバー） `cc:完了`:**

- [x] `care-reports/[id]/pdf/route.ts`, `management-plans/[id]/pdf/route.ts` `cc:完了` (2026-03-31)
- [x] `patients/[id]/medication-calendar/pdf/route.ts`, `patients/[id]/medications/pdf/route.ts` `cc:完了` (2026-03-31)
- [x] `patients/[id]/visit-records/pdf/route.ts`, `tracing-reports/[id]/pdf/route.ts` `cc:完了` (2026-03-31)
- [x] `visit-records/[id]/pdf/route.ts` `cc:完了` (2026-03-31)

**T-07: その他（37ルート未テスト） `cc:完了` (2026-03-31):**

- [x] 調剤系: `dispense-queue`, `dispense-results/[id]`, `dispense-tasks/[id]/verify-barcode`
- [x] ケース系: `cases/route.ts`, `cases/[id]/route.ts`, `cases/[id]/transition`
- [x] 通信系: `communication-requests/route.ts`, `[id]/responses`, `communication-events`
- [x] 管理系: `notification-rules`, `pharmacist-shifts`, `pharmacy-sites`, `consent-records` `cc:完了` (2026-03-30)
- [x] その他: `business-holidays`, `conference-notes`, `community-activities`, `external-access`, `templates`, `settings` `cc:完了` (2026-03-30)

</details>
### 1b-8. 機能的ギャップ修正 `cc:完了`
<details>
<summary>完了済み詳細 — クリックで展開</summary>

> 2026-03-28 GAP分析: ワークフロー横断で検出した機能的な隙間

- [x] F-01: 監査トリガーの対象拡大 `cc:完了` (2026-03-31)
  - `prisma/migrations/20260328223000_expand_audit_log_targets/migration.sql` で `DispenseResult` / `DispenseAudit` / `SetAudit` に DB 監査トリガーを追加済み
- [x] F-02: データエクスポート監査ログ `cc:完了` (2026-03-31)
  - 一括 PDF / CSV エクスポート時に「誰が何件を出力したか」を AuditLog に記録
  - `audit-logs/export`, `billing-candidates/export`, `visit-records/[id]/pdf` 等の全エクスポート系ルートに追加
- [x] F-03: フィールドレベル認可 `cc:完了` (2026-03-31)
  - `src/lib/patient/privacy.ts` を追加し、患者一覧 / 患者詳細 / 連絡先 API で PII・保険情報・住所詳細のロール別マスキングを共通化
  - `external_viewer` 想定では住所詳細と保険情報を非表示、`clerk` では電話・保険番号をマスクするレスポンス層へ統一
- [x] F-04: ユーザー別レートリミット `cc:完了` (2026-03-31)
  - `src/proxy.ts` で `next-auth/jwt` を用いて `userId:endpoint` 優先、未認証時のみ `IP:endpoint` へフォールバック
  - 共有 IP（施設 NAT）環境でもユーザー単位で独立したバケットを利用
- [x] F-05: セッション無効化（全デバイスログアウト） `cc:完了` (2026-03-31)
  - Cognito GlobalSignOut API の呼び出し
  - ユーザー設定画面に「全デバイスからログアウト」ボタン追加
- [x] F-06: RLS コンテキスト未設定時のフェイルセーフ `cc:完了` (2026-03-31)
  - `prisma/migrations/20260328234500_rls_context_failsafe/migration.sql` の `app_enforced_org_id()` で RLS コンテキスト未設定時を明示エラー化
  - `src/lib/db/rls.ts` で `app.rls_context_applied=true` を注入し、request context と orgId の不整合を transaction 開始前に拒否

</details>
### 1b-9. パイロット薬局 UAT + フィードバック反映 `cc:TODO`

> depends: 1b-6 | DoD: パイロット薬局で1週間の実運用テスト完了、フィードバック反映

- [ ] パイロット薬局での実運用テスト（1週間）
- [ ] フィードバック収集→優先度付け→Phase 2 開始前に修正適用
- [ ] 施設患者の有無を確認 → 施設なしなら FacilityVisitBatch と自動ルート最適化は Phase 2 に移動
- [ ] セット患者の有無を確認 → セット患者なしの場合は Pilot対象を明示し、セット本格機能は Phase 2 へ
  - 2026-03-31: `/api/admin/pilot-readiness`、UAT 画面の readiness 要約、`pnpm pilot:readiness -- --org <org_id>` を追加。施設患者数 / セット pilot 対象 / UAT blocker を即時確認可能にした
  - 2026-03-31: `pnpm pilot:org-audit -- --org <org_id>` と `docs/operations/target-pharmacy-onboarding-checklist.md` を追加。店舗構成 / facility linked case / set pilot / 16km圏外患者を一括確認できる
  - 2026-03-31: `UatFeedback` に status / owner / work item / due date / resolved_at を追加し、`/api/admin/uat-feedback/[id]` と `/admin/uat` で triage-to-closure 導線を実装した
  - 2026-03-31: `pnpm pilot:dossier -- --org <org_id>` を追加。pilot readiness / org audit / UAT summary / PMDA / backup / ISMS の外部前提を 1 つの Markdown dossier に束ねて Phase 2 判定共有を自動化した
  - 2026-03-31: `/api/admin/pilot-launch-dossier` と `/admin/uat` の dossier card を追加し、CLI を開かずに同じ統合判定を管理画面から確認できるようにした
  - 2026-04-01: `/api/pharmacists?include_collaborators=true` と `/admin/uat` の担当者候補を user 単位で重複排除し、triage owner 選択の曖昧さを解消。外部 readiness は PMDA URL 実値を返さず、backup は live/tabletop を区別して表示するよう修正
  - 2026-03-31: 現時点でローカル側の readiness 集計・フィードバック収集・triage 管理は実装済み。残作業は対象薬局 org を指定した 1 週間運用と、実地結果に基づく修正反映のみ

---

- Phase 2: セット・月次運用・連携強化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 2b: 実務機能強化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 2c: マスター機能整備 + データリンク強化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 3: 外部連携・最適化・通知高度化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 4: コードリファクタリング (2026-03-31) `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## 設計判断 → [docs/decisions.md](docs/decisions.md)

| ID   | 確定案                                                                            | 状態 |
| ---- | --------------------------------------------------------------------------------- | ---- |
| D-01 | **電子お薬手帳QRコード読取**（JAHIS Ver.2.5）                                     | 確定 |
| D-02 | **初日からマルチテナント**（Prisma + PostgreSQL RLS）                             | 確定 |
| D-03 | Ph1a: 連携ログ+文書送付 → Ph1b: 依頼/照会WF → Ph2: 外部共有                       | 確定 |
| D-04 | Ph1a: 読取専用キャッシュ → Ph2: 下書き+同期                                       | 確定 |
| D-05 | **候補表示+3層バリデーション**（自動算定しない）                                  | 確定 |
| D-06 | **データ移行なし**（新規構築）                                                    | 確定 |
| D-07 | **4層モデル**（標準化/法人/店舗/個人）                                            | 確定 |
| D-08 | **Prisma = メインORM + PostgreSQL RLS**（工程権限はフラグ制御）                   | 確定 |
| D-09 | **AWS 全面採用**（ISMAP準拠、3省2ガイドライン対応）                               | 確定 |
| D-10 | **Google Routes API** でルート最適化（住所→座標はジオコーディングAPI）            | 確定 |
| D-11 | **MVPは現場運用優先**（訪問記録/報告/持参判定を先行、最適化と高度請求は後段）     | 確定 |
| D-12 | **外部システム責任分界を先に固定**（SourceOfTruthMatrix を実装前に整備）          | 確定 |
| D-13 | **PDF生成: React-PDF サーバーサイド実行**（一括出力はキュー+ZIP+S3）              | 確定 |
| D-14 | **楽観的ロック**（version カラム + 409 Conflict）で同時編集競合を制御             | 確定 |
| D-15 | **バックグラウンドジョブ: EventBridge Scheduler**（日次/夕方/翌営業日/月次の4層） | 確定 |

### 残る確認事項

- [ ] 初期ターゲット薬局の店舗数・組織構成
  - 2026-03-31: システム側では `pilot:readiness` と管理画面で org 単位の readiness を確認可能。加えて `pilot:org-audit` で店舗数 / 役割別人数 / site ごとの service area を確認可能
  - 2026-03-31: `pilot:dossier` で店舗構成・role count・Phase 2 判定・外部 blocker を同時に共有できる
  - 2026-03-31: `/admin/uat` の dossier card から PMDA / backup / ISMS と同じ画面で確認できる
  - 2026-03-31: 確定値そのものは導入対象薬局へのヒアリング待ち
- [x] 患者同意書の文面・運用フロー
  - 2026-03-28: `docs/compliance/patient-consent-workflow.md`, `docs/compliance/data-usage-purpose.md`, `docs/compliance/privacy-policy.md` を SSOT として固定
- [ ] 薬局の16km圏内カバレッジ
  - 2026-03-31: `pilot:org-audit` が primary residence と pharmacy site の緯度経度から 16km 圏外患者と位置情報不足患者を抽出する
  - 2026-03-31: `pilot:dossier` が 16km 圏外患者プレビューと Phase 2 推奨を readiness/UAT と同じレポートにまとめる
  - 2026-03-31: 最終確認は対象薬局住所と訪問対象住所の実データ投入待ち
- [ ] ISMS認証の開始時期・予算
  - 2026-03-31: 技術 prerequisite は完了。`docs/compliance/isms-vendor-comparison-template.md` を追加し、見積比較 / 予算判断の記録様式を固定
  - 2026-03-31: `pilot:dossier` が ISMS comparison template / decision memo の未着手状態を検出し、external blocker として出力する
  - 2026-03-31: 開始時期 / 予算の最終確定は審査機関見積と経営判断待ち
- [x] Google Maps Platform の利用料金確認（Routes API: $5/1000リクエスト目安）
  - 2026-03-28: Google 公式 pricing overview / price list を確認。`Routes: Compute Routes Essentials` は 10,000 回/月まで free cap、その後は $5 / 1,000 events。`Route Optimization - Single Vehicle Routing` は 5,000 回/月まで free cap、その後は $10 / 1,000 events。必要なら subscription plan は Starter $100 / Essentials $275 / Pro $1,200。

---

## Phase 5-PRE: 患者モデル変更の前提基盤 `cc:TODO` <!-- 2026-06-11 監査: Phase 5 本体(5-0〜5-12)は実装済み。PRE の計画文書群は未作成だが対象マイグレーションは消化済みのため実質低優先。docs/phase5-p00-investigation.md が現況調査を兼ねる -->

> Phase 5 は Patient モデルを根本変更するため、安全な実行基盤が必須。
> 医療システムでデータ移行失敗 = 請求エラー・CDS 機能停止・患者安全リスク。

### PRE-01: 一括 cutover 戦略 `cc:TODO`

- [ ] Phase 5 は feature flag なしの同期リリース前提で実施する
- [ ] デプロイ順序を固定
  - schema migration
  - backfill
  - API / UI / jobs / PDF / shared の同時デプロイ
- [ ] 切替中に旧コードが新スキーマを読まない時間窓を最小化する手順を定義
- [ ] 切替失敗時は PRE-05 のロールバックへ即移行する判断基準を定義
- **受入条件**: feature flag なしで一括切替できるリリース手順が存在すること

### PRE-02: マイグレーション直列化戦略 `cc:TODO`

- [ ] Phase 5 の全スキーマ変更を単一ブランチで直列管理
- [ ] P-01/P-04/P-06/P-07/P-08 のマイグレーションタイムスタンプ順序を事前確定
- [ ] 並列開発時のマイグレーション競合防止ルール文書化
- **受入条件**: 全マイグレーションが競合なく順序適用可能

### PRE-03: データマイグレーション検証フレームワーク `cc:TODO`

- [ ] 各マイグレーションに: pre-count check / post-integrity check / rollback SQL
- [ ] テスト用本番相当データセットの準備
- [ ] 検証スクリプトテンプレート作成
- [ ] `VisitRecord.structured_soap.objective.lab_values` から `PatientLabObservation` への backfill 検証手順を追加
- [ ] allergy / insurance / packaging だけでなく、lab history 移行の検算項目を用意
- **受入条件**: 全データマイグレーションにロールバック手順が存在すること

### PRE-04: API / UI 同期切替戦略 `cc:TODO`

- [ ] Patient API レスポンス形式変更時の SW キャッシュ無効化戦略
- [ ] デプロイ時の SW バージョンバンプ自動化
- [ ] 破壊的変更を伴う対象を固定
  - patient detail
  - patient edit
  - external share
  - patient list
  - schedule / visit brief
- [ ] QR 取込の `gender='unknown'` を cutover 時点で正規化する方針を定義
- [ ] API snapshot / route contract / shared payload の更新順序と検証手順を定義
- [ ] 患者編集導線の再接続時データロスト対策を Phase 5 前提として扱う
  - `reloadOnOnline` の soft refetch 化、または patient edit 導線のみ先行保護
- **受入条件**: 旧契約を残さず、新契約へ同時切替できること

### PRE-05: Phase 5 ロールバックプレイブック `cc:TODO`

- [ ] 各スキーマ変更のロールバック SQL 作成
- [ ] データ復元手順（特に allergy_info の多形式→構造化の逆変換）
- [ ] 影響範囲別の判断基準（請求影響 = 即ロールバック等）
- **受入条件**: 各変更のロールバックが 30 分以内に実行可能なこと

### PRE-06: 患者 UI/UX 移行設計 `cc:TODO`

- [ ] `docs/ui-ux-design-guidelines.md` に基づき、Patient 詳細の情報アーキテクチャを先に設計
  - ヘッダー
  - サマリー帯
  - 主要作業
  - 補助情報/履歴
- [ ] 追加項目の優先順位を確定
  - 重症アレルギー
  - 最新検査値
  - 現在有効な保険
  - アーカイブ状態
- [ ] アーカイブ患者の UI 状態設計
  - 一覧
  - 詳細
  - スケジュール
  - 外部共有
- [ ] モバイルで順序を変えずに縦積みできる wireframe を作成
- [ ] 画面版 / 印刷版 / PDF / shared の患者要約表示ルールを統一
- **受入条件**: Phase 5 実装前に、Patient 詳細・共有・印刷の IA と状態表現が決まっていること

---

- Phase 5: 患者情報機能改善 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 6: 処方・調剤ワークフロー改善 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設
- Phase 7: 訪問・スケジュールワークフロー改善 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## Phase 8: 報告・連携・通知改善 `cc:TODO` <!-- 2026-06-11 コード監査: 6/7 実装済み(SES 未設定 throw、MCS 差分マージ upsert L951、web-push 実発送、SSE 再接続、OTP ヘッダ化+レート制限、tracing DELETE L15)。残は 8-2 の FAX 実送信方針のみ -->

> サイレント失敗の解消と通知チャネルの実効性確保

### 8-1. メール送信サイレントスタブの解消 ★Critical `cc:完了`

- [ ] `email.ts` L25-27: `SES_FROM_EMAIL` 未設定時に明示的エラーを throw
- [ ] 呼出元でエラーハンドリング + UI通知
- **受入条件**: メール設定不備が即座にユーザーに通知されること

### 8-2. FAX チャネルの実装 or 明示的無効化 ★Critical `cc:完了`

- [x] 方針決定: 明示的無効化を採用(wave-2 W-CB-FAX-CHANNEL-DECISION)。FAX gateway は未実装、ファントムの fax デフォルトを除去
- [x] `tracing-reports/[id]/route.ts` の `channel: 'fax'` ハードコードを撤廃 → チャネルセレクタで送信チャネルを明示、fax は record-only(記録のみ、実送信しない)
- **受入条件**: FAX は送信可能チャネルとして提示せず record-only として扱う(W-CB-FAX-CHANNEL-DECISION で「実装 or 明示的無効化」を解決)

### 8-3. MCS 同期のデータ保全修正 ★Critical `cc:完了`

- [ ] `patient-mcs.ts` L858-870: 既存メッセージの全削除を廃止 → 差分マージ（upsert のみ）
- [ ] `patient-mcs.ts` L422-446: 患者名マッチングの精度向上（部分一致→完全一致 or スコア閾値）
- [ ] AI サマリー生成失敗時に既存サマリーを保持（削除しない）
- **受入条件**: 同期で既存データが消失しないこと

### 8-4. Push 通知の実発送実装 `cc:完了`

- [ ] `PushSubscription` 登録は完了 → `web-push` による実発送ロジック追加
- [ ] `dispatchNotificationEvent` から push チャネル呼出し
- **受入条件**: 通知設定済みユーザーにブラウザ push が届くこと

### 8-5. SSE ストリームの自動再接続 `cc:完了`

- [ ] クライアント側で `EventSource` close 後の自動再接続ロジック追加
- [ ] 5分タイムアウト後にバックオフ付き再接続
- **受入条件**: 5分以上開いたタブでもリアルタイム通知が継続すること

### 8-6. 外部共有 OTP セキュリティ強化 `cc:完了`

- [ ] OTP を URL クエリパラメータからリクエストヘッダ or POST body に移行
- [ ] 検証エンドポイントにレート制限追加（IP あたり 5回/分）
- [ ] SMS 送信失敗時のエラー表示（現在は silent fallback to manual）
- **受入条件**: OTP がサーバーログ/ブラウザ履歴に露出しないこと

### 8-7. トレーシングレポート改善 `cc:完了`

- [ ] 一覧に患者名表示（現在 patient_id のみ）
- [ ] `DELETE /api/tracing-reports/[id]` 追加（draft のみ削除可）
- [ ] `channel` を実際の送信チャネルに基づき動的設定（fax ハードコード解消）
- **受入条件**: 一覧で患者名が表示、下書きの削除が可能

---

- Phase 9: 請求・管理機能改善 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## Phase 10: UX・パフォーマンス・オフライン改善 `cc:TODO` <!-- 2026-06-11 コード監査: 8/9 実装済み(sw.ts:40 NetworkFirst, prescription-intake-form:392 usePrescriptionDraft, error.tsx/loading.tsx 網羅, next.config.ts:22 reloadOnOnline:false, data-table.tsx:264 BOM, aria-invalid 1639/1706/1807, print 動的 org.name)。残は 10-6 のみ -->

> PWA 品質の底上げと訪問現場での操作性改善

### 10-1. SW に API ルートキャッシュ追加 ★Critical `cc:完了`

- [ ] `sw.ts`: `/api/**` に `NetworkFirst` (5s timeout) ルール追加
- [ ] オフライン時のデータ取得をSWキャッシュでカバー
- **受入条件**: オフライン遷移後もデータ表示が維持されること

### 10-2. 処方入力フォームの自動保存 ★Critical `cc:完了`

- [ ] `prescription-intake-form.tsx` に IndexedDB ドラフト保存追加（visit-record-form と同パターン）
- [ ] ページ離脱時の確認ダイアログ
- [ ] `reloadOnOnline` による全喪失を防止
- **受入条件**: QRスキャン後のデータがリロードでも復元されること

### 10-3. ダッシュボード error.tsx 追加 `cc:完了`

- [ ] `/(dashboard)/error.tsx` — ルートセグメントレベルのエラーバウンダリ
- [ ] 主要サブルート（patients, prescriptions, visits, dispensing）にも個別 error.tsx
- **受入条件**: 子ルートのクラッシュが全画面エラーにならないこと

### 10-4. loading.tsx の網羅 `cc:完了`

- [ ] `admin/*` 全サブルート + `patients/[id]/*` + `prescriptions/[id]` + `dispensing/[taskId]` に loading.tsx 追加
- **受入条件**: 全ナビゲーションでスケルトンが表示されること

### 10-5. reloadOnOnline の soft refetch 化 `cc:完了`

- [ ] `next.config.ts` L20: `reloadOnOnline: false` に変更
- [ ] オンライン復帰時に `queryClient.invalidateQueries()` で soft refetch
- [ ] フォーム入力中のデータ保護
- **受入条件**: オンライン復帰でフォーム入力が失われないこと

### 10-6. 訪問記録フォームのキーボードショートカット `cc:完了`

- [x] `Cmd+S` で保存、`Cmd+Enter` で完了保存(visit-record-form 実装済み)
- [x] SOAP ステップ間のキーボードナビゲーション(soap-step-wizard 実装済み)
- **受入条件**: 訪問中にキーボードのみで記録を完了できること(2026-06-11 監査で実装確認済み)

### 10-7. CSV エクスポートの UTF-8 BOM 追加 `cc:完了`

- [ ] `data-table.tsx` L267: CSV 先頭に `\uFEFF` (BOM) 追加
- [ ] Windows Excel での日本語文字化け解消
- **受入条件**: Excel (Windows) で文字化けなく開けること

### 10-8. 処方入力フォームのインラインエラー表示 `cc:完了`

- [ ] `prescription-intake-form.tsx`: フィールド単位の `aria-invalid` + エラーメッセージ表示
- [ ] `aria-describedby` をエラー ID に紐付け
- **受入条件**: WCAG AA 準拠のフォームバリデーション UX

### 10-9. 印刷ページの薬局名ハードコード解消 `cc:完了`

- [ ] `visit-records/print/page.tsx` L147, `medications/print/page.tsx` L117: org 設定から薬局名取得
- **受入条件**: マルチテナントで各薬局名が正しく印刷されること

---

- Phase 11: セキュリティ・コンプライアンス強化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## Phase 12: インフラ・運用基盤整備 `cc:TODO` <!-- 2026-06-11 コード監査: 12-1/2/3/6 実装済み。残は 12-4/5/7、12-8 は外部依存 -->

> 本番運用の信頼性確保。CI/CD・監視・シークレット管理

### 12-1. CI/CD パイプライン構築 ★Critical `cc:完了`

- [x] `.github/workflows/ci.yml` — lint → test → build → deploy、PR プレビュー(L256-294)、本番承認ゲート(L301-353)

### 12-2. エラートラッキング導入 ★Critical `cc:完了`

- [x] Sentry SDK(`src/instrumentation.ts` / `src/instrumentation-client.ts`)+ 構造化ログ(`src/lib/utils/logger.ts`)

### 12-3. CloudWatch アラームの通知先設定 ★Critical `cc:完了`

- [x] `tools/infra/cloudwatch-alarms.ts` で SNS トピック + alarmActions 設定スクリプト
- 注記: 実環境への適用と Slack/PagerDuty 接続は AWS 認証情報・運用契約に依存(適用時に再確認)

### 12-4. ステージング環境構築 `cc:TODO`

- [ ] `APP_ENV=staging` 環境変数 + 環境別設定(`.env.staging` 不在を 2026-06-11 確認)
- [ ] ステージング用 RDS + Cognito ユーザープール
- [x] `.env.example` は作成済み
- **受入条件**: staging 環境で本番同等のテストが可能なこと

### 12-5. シークレット管理の AWS Secrets Manager 移行 `cc:完了`

- [x] SecretsManagerClient 基盤(`src/phos/backend/phos-aws-clients.ts`、DynamoDB レート制限用)
- [x] 本体アプリの `DATABASE_URL`, `NEXTAUTH_SECRET`, `JOB_API_KEY` の env-first getSecrets 配線(wave-2: `src/lib/config/secrets.ts` — 環境変数優先、未設定時に Secrets Manager フォールバック)
- [x] `JOB_API_KEY` のローテーション Lambda スケルトン作成(wave-2)
- 注記: コード側完了。実 AWS Secrets Manager のプロビジョニング/ローテーションのデプロイは AWS 認証情報が必要なため deferred(認証情報入手後に適用)
- **受入条件**: 平文環境変数にシークレットが存在しないこと(本番デプロイ時に充足)

### 12-6. ジョブ実行の並行実行ガード `cc:完了`

- [x] `src/server/jobs/runner.ts:21-33` で isJobAlreadyRunning チェック、running 重複時スキップ(L42-45)

### 12-7. パフォーマンスメトリクスの CloudWatch 連携 `cc:完了`

- [x] `performance.ts` のインメモリストア → CloudWatch カスタムメトリクス送信(wave-2: `JOB_API_KEY` 認証付き `/api/jobs/flush-metrics` ルート + EventBridge スケジュール JSON)
- [x] p95 レイテンシ劣化アラート(flush-metrics 経由で CloudWatch メトリクス化、12-3 のアラーム設定と連動)
- [ ] RUM (Core Web Vitals) 導入(別タスクとして継続)
- 注記: コード側完了。EventBridge スケジュールの適用は AWS 認証情報が必要なため deferred。RUM/Core Web Vitals 部分は別途
- **受入条件**: p95 レイテンシが CloudWatch でモニタリング可能なこと(本番デプロイ時に充足)

### 12-8. バックアップ復旧実地訓練 `cc:blocked` <!-- I-04 と同一の AWS 認証情報・実環境依存 -->

- [ ] RDS スナップショットからの実際のリストア実行
- [ ] S3 バージョニングからのオブジェクト復元テスト
- [ ] RTO/RPO の実測値を `backup-recovery-drill.md` に記録
- **受入条件**: RTO 4時間以内が実証されること(0-5 の I-04 解消と同時に実施)

---

- Phase 13: テスト・品質基盤強化 `cc:完了` → 完了・[docs/plans-archive.md](docs/plans-archive.md) へ移設

## Phase 14: 外部連携・データパイプライン `cc:TODO` <!-- 2026-06-11 コード監査: 14-1/2/4/6 実装済み。残は 14-3(一部)と 14-5 -->

> レセコン連携・電子処方箋・OQC の実運用化

### 14-1. オンライン資格確認（OQC）の UI 統合 `cc:完了`

- [x] `POST /api/patients/[id]/qualification-check`(adapter 統合 + webhook 通知)
- [x] UI 接続: `patients/[id]/edit` の `PatientForm` に資格確認導線
- 注記: MHLW API 接続設定の専用管理画面は未確認(実接続は外部契約依存)

### 14-2. 電子処方箋の受付フロー統合 `cc:完了`

- [x] `POST /api/patients/[id]/prescriptions/e-prescription`(EPrescriptionAdapter、source_type: e_prescription)
- [x] UI 接続: prescription-intake-form / dispense-form / prescription-history-content
- [x] `confirmDispense` 実装(`src/server/adapters/e-prescription/index.ts:286,425`)
- 注記: HPKI 証明書の実運用ハンドリングは外部認証局手続き依存

### 14-3. レセコン連携の API 化 `cc:完了`

- [x] 請求データの CSV 構造化エクスポート(実装済み)
- [x] CLAIMS-XML 形式の出力(wave-2: `src/server/adapters/claims-export/` を billing close/export に配線。config ガード + 監査ログ付き、`billing-candidates/close`・`billing-candidates/export` ルート)
- [ ] Outbound webhook 基盤構築（イベント駆動の外部通知）(継続)
- 注記: コード側完了(CLAIMS-XML アダプタ統合)。実レセコンエンドポイントへの到達は外部接続設定(config)が必要なため deferred(config 投入で有効化)
- **受入条件**: 手動 CSV ハンドオフなしで請求データが レセコンに到達すること(外部接続設定の投入時に充足)

### 14-4. マルチテナントプロビジョニング API `cc:完了`

- [x] `POST /api/admin/organizations` — 組織 → サイト → Cognito → User → Membership を一括作成

### 14-5. API バージョニング戦略 `cc:TODO`

- [ ] バージョニング方式決定（URL prefix vs ヘッダー）
- [ ] 既存エンドポイントの v1 ラベリング
- [ ] 破壊的変更の deprecation ポリシー文書化
- **受入条件**: 外部連携先に影響なく API 変更が可能なこと

### 14-6. 患者データ構造化エクスポート `cc:完了`

- [x] `GET /api/patients/export` — 患者一覧 CSV(BOM 付き UTF-8、recordDataExportAudit 監査ログ)
- [x] `GET /api/patients/[id]/prescriptions/export` — 処方履歴 CSV
- 注記: FHIR Patient リソース出力は将来拡張(未実装のまま据え置き)
