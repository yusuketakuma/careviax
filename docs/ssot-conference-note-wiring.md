# ConferenceNote 運用ハブ設計 — SSOT ワイヤリング仕様

> **文書の目的**
> ConferenceNote の `structured_content` は「保存用JSONに過ぎない」実装から脱却し、
> 会議記録を起点にしたワークフロー自動生成の運用ハブとして機能させる。
> 本文書は「どの会議種別のどのフィールドが、どのエンティティにいつ流れるか」を
> **一意の真実源 (SSOT)** として定義する。

---

## 1. 対象会議種別

| note_type (DB enum) | 日本語名 | 主な場面 |
|---|---|---|
| `pre_discharge` | 退院前カンファ | 病院退院前の多職種連携会議 |
| `service_manager` | サービス担当者会議 | 介護保険ケアプラン見直し会議 |
| `death_conference` | デスカンファレンス | ターミナルケア・看取り後振り返り |
| `care_team` | 薬剤師間カンファ / 多職種カンファ | 院内・多職種定期カンファ |
| `emergency` | 緊急カンファ | 急変・インシデント対応カンファ |
| `regular` | その他 | 定例記録・不定形会議 |

---

## 2. structured_content の標準スキーマ

```typescript
// ConferenceNote.structured_content (JSON)
{
  template: ConferenceNoteType,   // 会議種別（= note_type）
  sections: Array<{
    key: string,     // セクション識別子（英小文字スネーク）
    label: string,   // 表示ラベル（日本語）
    body?: string    // 記述内容
  }>
}
```

### 2-1. 会議種別ごとの標準セクション定義

#### pre_discharge（退院前カンファ）

| key | label | 説明 |
|---|---|---|
| `discharge_plan` | 退院計画 | 退院日・行き先・在宅環境の確認 |
| `medication_summary` | 持参薬・院内処方整理 | 薬剤リスト・変更点 |
| `risk_assessment` | リスクアセスメント | 転倒リスク・認知機能・重症度 |
| `care_needs` | 介護ニーズ確認 | 生活支援・訪問頻度の合意 |
| `next_visit_plan` | 初回訪問予定 | 退院後最初の薬剤師訪問計画 |
| `consent_status` | 同意取得状況 | 在宅療養管理・情報共有同意 |
| `action_summary` | アクション整理 | 各担当者の持ち帰り事項 |

#### service_manager（サービス担当者会議）

| key | label | 説明 |
|---|---|---|
| `care_plan_update` | ケアプラン変更点 | サービス種別・頻度の変更 |
| `medication_review` | 薬剤管理状況 | 服薬アドヒアランス・問題薬 |
| `patient_condition` | 患者状態 | ADL・認知・QOL変化 |
| `coordination_items` | 多職種連携事項 | 他職種への依頼・情報提供 |
| `visit_schedule_adjustment` | 訪問スケジュール調整 | 頻度・曜日・担当薬剤師変更要否 |
| `action_summary` | アクション整理 | 各担当者の持ち帰り事項 |

#### death_conference（デスカンファレンス）

| key | label | 説明 |
|---|---|---|
| `terminal_process` | ターミナル経過 | 病状推移・対応の振り返り |
| `medication_at_end` | 終末期薬剤管理 | 疼痛管理・緩和薬の評価 |
| `family_feedback` | 家族フィードバック | 家族の満足度・要望 |
| `care_team_reflection` | ケアチーム振り返り | 多職種の改善点・感謝事項 |
| `billing_confirmation` | 請求根拠確認 | ターミナルケア管理料の算定根拠 |
| `action_summary` | アクション整理 | 継続ケースがある場合の引継ぎ |

#### care_team（薬剤師間カンファ / 多職種カンファ）

| key | label | 説明 |
|---|---|---|
| `case_review` | 症例レビュー | 対象患者の状態共有 |
| `medication_issues` | 薬剤問題リスト | 新規・継続中の薬剤問題 |
| `intervention_outcomes` | 介入結果 | 前回アクションの成否 |
| `knowledge_sharing` | 情報共有・勉強事項 | 新規ガイドライン・院内情報 |
| `action_summary` | アクション整理 | 担当者別アクション |

#### emergency（緊急カンファ）

| key | label | 説明 |
|---|---|---|
| `incident_summary` | インシデント概要 | 何が起きたか・いつ・誰に |
| `immediate_actions` | 即時対応内容 | 実施済みアクション |
| `root_cause` | 原因分析 | 推定原因・背景要因 |
| `risk_mitigation` | 再発防止策 | 具体的な対策 |
| `escalation_status` | エスカレーション状況 | 報告先・対応状況 |
| `action_summary` | アクション整理 | 担当者別フォローアップ |

#### regular（その他）

| key | label | 説明 |
|---|---|---|
| `summary` | 概要 | 会議の目的・議題 |
| `discussion` | 議論内容 | 主要な討議事項 |
| `decisions` | 決定事項 | 合意された内容 |
| `action_summary` | アクション整理 | 持ち帰り事項 |

---

## 3. section → エンティティ マッピングテーブル

### 3-1. pre_discharge（退院前カンファ）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item` | on_create（手動確認後） | implemented | required |
| `next_visit_plan.body` | **VisitScheduleProposal** | proposed_date / note | manual | not-implemented | required |
| `medication_summary.body` | **MedicationIssue**（新規検出時） | title / description / category | manual | not-implemented | recommended |
| `metadata.billing` (pre_discharge) | **BillingCandidate** | billing_code=B011-6, billing_name=退院時共同指導料（薬局）, points=600, source_snapshot={note_id,participants,date}, calculation_breakdown={claimable_hint,missing_conditions} | on_create（候補自動登録） | **implemented (CWI-01D)** | required |
| `consent_status.body` | CareCase / Patient（同意記録参照） | 同意フラグ確認のみ | manual | not-implemented | recommended |
| `risk_assessment.body` | **CareReport** (physician_report) | content.risks | manual | not-implemented | optional |

### 3-2. service_manager（サービス担当者会議）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item` | on_create（手動確認後） | implemented | required |
| `visit_schedule_adjustment.body` | **VisitScheduleProposal** | visit_type / time_window / proposed_date | manual | not-implemented | required |
| `medication_review.body` | **MedicationIssue** | title / category=`adherence` | manual | not-implemented | recommended |
| `coordination_items.body` | **CareReport** (care_manager_report) | content.coordination | manual | not-implemented | recommended |
| `care_plan_update.body` | CareCase.metadata（情報参照） | サービス変更メモ | manual | not-implemented | optional |

### 3-3. death_conference（デスカンファレンス）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item` | on_create（手動確認後） | implemented | required |
| `billing_confirmation.body` | **BillingCandidate** | billing_code=C013, billing_name=ターミナルケア管理料（在宅ターミナルケア加算）, points=2500, calculation_breakdown.evidence_notes={billing_confirmation,terminal_process} | on_create（候補自動登録） | **implemented (CWI-01D)** | required |
| `terminal_process.body` | **CareReport** (internal_record) | content.terminal_summary | manual | not-implemented | recommended |
| `medication_at_end.body` | **MedicationIssue** | resolution / category=`other` | manual | not-implemented | optional |
| `metadata.billing` (death_conference) | **BillingCandidate** | status=`candidate` → 確認後 `confirmed`; source_snapshot={note_id,participants,date,ssot_ref} | on_create（候補自動登録） | **implemented (CWI-01D)** | required |

### 3-4. care_team（薬剤師間カンファ / 多職種カンファ）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item` | on_create（手動確認後） | implemented | required |
| `medication_issues.body` | **MedicationIssue** | title / description / priority | manual | not-implemented | required |
| `case_review.body` | VisitBrief (visit_brief metadata) | highlighted_risks / summary | on_update | not-implemented | recommended |
| `intervention_outcomes.body` | MedicationIssue.interventions | outcome 更新 | manual | not-implemented | optional |

### 3-5. emergency（緊急カンファ）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item`, priority=`high` | on_create（自動変換） | implemented | required |
| `immediate_actions.body` | **Task** | 即時対応タスク（priority=`urgent`） | on_create | not-implemented | required |
| `risk_mitigation.body` | **Task** | 再発防止フォローアップタスク | manual | not-implemented | recommended |
| `incident_summary.body` + `root_cause.body` | **CareReport** (internal_record) | content.incident_report | manual | not-implemented | recommended |

### 3-6. regular（その他）

| structured_content section/field | 変換先エンティティ | 具体的なフィールド | sync トリガー | 実装状況 | 優先度 |
|---|---|---|---|---|---|
| `action_items[*]` | **Task** | task_type=`conference_action_item` | on_create（手動確認後） | implemented | required |
| `decisions.body` | （なし、記録のみ） | — | — | — | optional |

---

## 4. action_items → Task 変換ルール

### 4-1. 変換の基本ルール

```
action_items[i].title  → Task.title
action_items[i].assignee → Task.metadata.assignee_label（担当者名テキスト、User IDへの解決はUI層）
ConferenceNote.note_type → Task.metadata.note_type（コンテキスト保持用）
ConferenceNote.case_id  → Task.metadata.case_id
ConferenceNote.id       → Task.related_entity_id
"conference_note"       → Task.related_entity_type
```

### 4-2. dedupe_key

```
conference-action-item:{note_id}:{action_item_index}
```

同一アクションアイテムの二重変換を upsert で防ぐ（実装済み）。

### 4-3. 変換後の状態追跡

```
action_items[i].converted_task_id  → 変換済みTask ID（バックフィル）
action_items[i].converted_at       → 変換日時 ISO 8601
```

### 4-4. 会議種別ごとの priority デフォルト

| note_type | Task.priority デフォルト |
|---|---|
| `pre_discharge` | `high` |
| `service_manager` | `normal` |
| `death_conference` | `normal` |
| `care_team` | `normal` |
| `emergency` | `urgent` |
| `regular` | `normal` |

---

## 5. 請求根拠 (BillingEvidence / BillingCandidate) の生成ルール

### 5-1. 算定区分と自動候補生成

| note_type | 算定区分 | 診療報酬コード（レセ電） | 点数 | 自動候補生成条件 |
|---|---|---|---|---|
| `pre_discharge` | 退院時共同指導料（薬局） | 15-C型 / B011-6 | **600点** | note_type=`pre_discharge` で保存時。metadata.billing.link_status を `candidate` にセット |
| `death_conference` | 在宅ターミナルケア加算（管理料内） | C013 / C012 関連 | **2500点** | note_type=`death_conference` で保存時。metadata.billing.link_status を `candidate` にセット |
| `care_team` (多職種カンファ) | 薬剤総合評価調整加算 / 連携指導料 | 特定薬剤管理指導 関連 | 条件付き | medication_issues セクションに記載があり、患者に対象薬剤がある場合 |
| `service_manager` | 居宅療養管理指導（ケアプラン起点） | C023 | 条件付き | サービス変更が訪問指示書に連動する場合 |

### 5-2. BillingCandidate への流れ

```
ConferenceNote (note_type=pre_discharge, on_create)
  └── metadata.billing = { link_status: "candidate", label: "退院時共同指導", points: 600 }
          ↓ [未実装: SyncService.fromConferenceNote]
  BillingCandidate.create({
    patient_id: note.case.patient_id,
    billing_code: "退院時共同指導",
    billing_name: "退院時共同指導料（薬局）",
    points: 600,
    source_snapshot: { conference_note_id: note.id },
    status: "candidate"
  })
```

### 5-3. BillingEvidence の充足条件（退院前カンファの場合）

BillingEvidence.claimable = true となるには以下を全て満たす必要がある：

| 条件 | 参照フィールド | 充足方法 |
|---|---|---|
| 同意記録あり | `consent_ref` | ConsentRecord に visit_medication_management の active 記録 |
| 服薬管理計画書あり | `management_plan_ref` | ManagementPlan.status=`approved` |
| 報告書配信あり | `report_delivery_ref` | CareReport → DeliveryRecord.status=`confirmed` |
| 訪問記録あり | `visit_record_ref` | VisitRecord への参照 |

---

## 6. VisitScheduleProposal への流れ

### 6-1. 退院前カンファ → 初回訪問候補生成

```
ConferenceNote (pre_discharge)
  └── sections[key="next_visit_plan"].body
          ↓ [未実装: manual → UI上の「訪問候補を作成」ボタン]
  VisitScheduleProposal.create({
    case_id: note.case_id,
    visit_type: "home_care",
    priority: "high",
    source_note: { conference_note_id: note.id },
    proposal_status: "proposed"
  })
```

### 6-2. サービス担当者会議 → スケジュール調整

```
ConferenceNote (service_manager)
  └── sections[key="visit_schedule_adjustment"].body
          ↓ [未実装: manual]
  VisitScheduleProposal.create または VisitSchedule の修正提案
```

---

## 7. CareReport への流れ

### 7-1. 会議種別 → 推奨 report_type マッピング

| note_type | 推奨 CareReport.report_type | 送付先 |
|---|---|---|
| `pre_discharge` | `physician_report` | 病院主治医 |
| `service_manager` | `care_manager_report` | ケアマネジャー |
| `death_conference` | `internal_record` | 内部記録 |
| `care_team` | `internal_record` | 内部記録 |
| `emergency` | `physician_report` + `internal_record` | 主治医・内部 |
| `regular` | `internal_record` | 内部記録 |

### 7-2. 生成トリガー（全種別共通）

- **現状**: CareReport は独立した POST /api/care-reports で手動作成
- **目標**: ConferenceNote 保存後 UI 上に「報告書を作成」ボタンを表示し、
  `conference_note_id` をメタデータに付与したドラフトを自動生成する

---

## 8. MedicationIssue への流れ

### 8-1. 変換条件

| note_type | トリガーセクション | 生成条件 |
|---|---|---|
| `care_team` | `medication_issues` | body に「問題」「疑義」「副作用」「相互作用」等のキーワード or 担当者が手動選択 |
| `pre_discharge` | `medication_summary` | 院内処方変更・新規追加薬剤がある場合 |
| `emergency` | `incident_summary` | インシデントが薬剤起因の場合 |

### 8-2. 変換後フィールドマッピング

```
section.body → MedicationIssue.description
（タイトルは UI 上で入力または本文先頭から自動抽出）
ConferenceNote.case_id → MedicationIssue.case_id
"conference_note" → 由来メタデータ（MedicationIssue.metadata 拡張時）
```

---

## 9. metadata.visit_brief の連携

ConferenceNote の `metadata.visit_brief` は訪問サマリー（VisitBrief）への連携に使用する。

```json
{
  "visit_brief": {
    "patient_id": "xxx",
    "schedule_id": "yyy",
    "highlighted_risks": ["服薬アドヒアランス低下", "転倒リスク"],
    "summary": "退院後初回訪問。持参薬の確認と生活指導が優先。"
  }
}
```

- `highlighted_risks`: VisitBrief のリスクセクションに反映（未実装）
- `summary`: VisitBrief の会議要約セクションに反映（未実装）
- トリガー: `care_team` / `pre_discharge` の保存時または更新時

---

## 10. 同期サービス設計

### 10-1. 現状のアーキテクチャ

```
POST /api/conference-notes
  └── ConferenceNote.create (DB保存のみ)
      metadata.billing = candidate に自動セット（pre_discharge, death_conference のみ）

POST /api/conference-notes/{id}/tasks
  └── ConferenceNote.action_items[i] → Task.upsert（1件ずつ手動変換）
```

### 10-2. 目標アーキテクチャ（イベント駆動型）

```
POST /api/conference-notes
  └── ConferenceNote.create
        ↓
  ConferenceSyncService.onNoteCreated(note)
    ├── [billing]  pre_discharge → BillingCandidate.create (candidate)
    ├── [billing]  death_conference → BillingCandidate.create (candidate)
    ├── [task]     action_items → Task.upsertMany（バッチ変換）
    └── [visit]    next_visit_plan → VisitScheduleProposal.create（候補）
```

### 10-3. 設計方針の選択肢

| 方式 | メリット | デメリット |
|---|---|---|
| **同期呼び出し（推奨・短期）** | シンプル、トランザクション保証 | API レスポンスタイム増加 |
| **非同期キュー（長期）** | レスポンス高速、スケーラブル | インフラ複雑化（SQS 等） |
| **UI 駆動（現状）** | 確認ステップを挟める | 手動ミス・漏れリスク |

**短期推奨**: 同期呼び出しで `ConferenceSyncService` クラスを実装し、
`POST /api/conference-notes` の保存後に within-transaction で実行する。
将来的には SQS/EventBridge への移行を検討する。

### 10-4. ConferenceSyncService インタフェース（設計案）

```typescript
// src/server/services/conference-sync.ts (未実装)
interface ConferenceSyncOptions {
  tx: PrismaClient;
  orgId: string;
  userId: string;
  note: ConferenceNote;
}

class ConferenceSyncService {
  // 保存直後の自動変換（必須項目のみ）
  static async onNoteCreated(opts: ConferenceSyncOptions): Promise<void>
  // 手動変換（UI起点）
  static async convertActionItems(opts: ConferenceSyncOptions): Promise<Task[]>
  // 請求候補の生成
  static async registerBillingCandidate(opts: ConferenceSyncOptions): Promise<BillingCandidate | null>
  // 訪問候補の提案
  static async proposeVisitSchedule(opts: ConferenceSyncOptions): Promise<VisitScheduleProposal | null>
}
```

---

## 11. 実装ロードマップ

### Phase 1: 基盤整備（優先度: required 項目）

| タスク | 対象 | 工数目安 |
|---|---|---|
| `ConferenceSyncService.registerBillingCandidate` 実装 | BillingCandidate 自動候補化 | 0.5日 |
| `POST /api/conference-notes` に BillingCandidate 連携組み込み | pre_discharge / death_conference | 0.5日 |
| `action_items` 全件一括変換 API 追加 | Task バッチ変換 | 0.5日 |
| UI: 「訪問候補を作成」ボタン（pre_discharge） | VisitScheduleProposal 手動生成 | 1日 |

### Phase 2: 推奨項目

| タスク | 対象 | 工数目安 |
|---|---|---|
| care_team → MedicationIssue 変換 UI | MedicationIssue | 1日 |
| 会議記録 → CareReport ドラフト自動生成 | CareReport | 1日 |
| visit_brief metadata の VisitBrief 反映 | VisitBrief | 0.5日 |

### Phase 3: 将来対応（optional）

| タスク | 対象 | 工数目安 |
|---|---|---|
| 非同期イベントキュー化 | アーキテクチャ | 2日〜 |
| 算定ルールエンジンとの統合（service_manager → care_team 連動） | BillingRule | 2日〜 |

---

## 12. 実装ステータス一覧（サマリー）

| 変換フロー | 実装状況 | 注記 |
|---|---|---|
| action_items → Task（1件ずつ） | **implemented** | `POST /api/conference-notes/{id}/tasks` |
| metadata.billing 候補セット（pre_discharge, death_conference） | **implemented** | `buildConferenceMetadata()` で自動セット |
| pre_discharge → BillingCandidate 自動生成 | **implemented (CWI-01D)** | billing_code=B011-6, claimable_hint付き |
| death_conference → BillingCandidate 自動生成 | **implemented (CWI-01D)** | billing_code=C013, billing_confirmation evidence付き |
| next_visit_plan → VisitScheduleProposal | not-implemented | Phase 1（UI駆動）〜 Phase 2（自動） |
| care_team → MedicationIssue | not-implemented | Phase 2 対応 |
| conference → CareReport ドラフト | not-implemented | Phase 2 対応 |
| visit_brief metadata → VisitBrief 反映 | not-implemented | Phase 2 対応 |
| action_items 全件バッチ変換 | not-implemented | Phase 1 対応必要 |

---

*最終更新: 2026-03-29*
*関連ファイル: `prisma/schema/communication.prisma`, `src/app/api/conference-notes/`, `src/app/api/conference-notes/[id]/tasks/route.ts`*
