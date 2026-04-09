# SSOT: FirstVisitDocument / 初回訪問関連エンティティの境界定義

作成日: 2026-03-29
対象スキーマバージョン: prisma/schema (2026-03-25 時点)

---

## 1. エンティティ境界テーブル

### 1.1 FirstVisitDocument

**定義ファイル**: `prisma/schema/medication.prisma`
**所有責任**: 初回訪問時に患者・家族へ交付した書類の記録（交付事実の証跡）

| フィールド | 内容 | 備考 |
|---|---|---|
| `id` | ドキュメントID | |
| `org_id` | 薬局組織ID | RLSキー |
| `patient_id` | 患者ID | |
| `case_id` | ケースID | ケースに紐付く（Patient直下ではない） |
| `emergency_contacts` | 緊急連絡先スナップショット (Json) | **複製データ**。交付時点の緊急連絡先を凍結保存 |
| `document_url` | 交付文書S3 URL | スキャン/PDF |
| `delivered_at` | 交付日時 | |
| `delivered_to` | 受取人氏名 | |

**FirstVisitDocument が独占的に所有するもの**:
- 交付事実（delivered_at / delivered_to）
- 交付時点の緊急連絡先スナップショット（`emergency_contacts` Json）
- 交付文書ファイル参照（document_url）

**FirstVisitDocument が所有しないもの**（他エンティティが SSOT）:
- 現在有効な緊急連絡先 → `ContactParty.is_emergency_contact = true` が SSOT
- 同意取得の事実 → `ConsentRecord` が SSOT
- インテーク（処方内容） → `PrescriptionIntake` が SSOT
- ケア・チーム構成 → `CareTeamLink` が SSOT

---

### 1.2 ConsentRecord

**定義ファイル**: `prisma/schema/patient.prisma`
**所有責任**: 患者から取得した同意の事実と有効期間

| フィールド | 内容 | 備考 |
|---|---|---|
| `id` | 同意レコードID | |
| `org_id` | 薬局組織ID | RLSキー |
| `patient_id` | 患者ID | Patient 直下（case に依存しない） |
| `case_id` | ケースID (nullable) | ケース特定の同意の場合のみセット |
| `consent_type` | 同意種別 | `visit_medication_management` / `personal_info_handling` / `external_sharing` / `photo_capture` |
| `method` | 取得方式 | `paper_scan` / `digital` |
| `obtained_date` | 同意取得日 | |
| `expiry_date` | 有効期限 (nullable) | |
| `revoked_date` | 撤回日 (nullable) | |
| `document_url` | スキャン文書 URL | |
| `is_active` | 有効フラグ | |
| `access_restricted` | 撤回後閲覧制限フラグ | |

**ConsentRecord が独占的に所有するもの**:
- 同意の有効/失効の真実（is_active / revoked_date / expiry_date）
- 同意種別ごとの取得日・文書
- 撤回後の閲覧制限状態（access_restricted）

**設計上の注意**:
- 1 患者につき consent_type ごとに複数レコードが存在しうる（再取得）
- 有効な同意の判定は `is_active = true AND revoked_date IS NULL AND (expiry_date IS NULL OR expiry_date >= TODAY)` で行う
- `ConsentType.visit_medication_management` が初回訪問の前提条件となる主要同意

---

### 1.3 PrescriptionIntake（home_visit_intake の代替実装）

**定義ファイル**: `prisma/schema/prescription.prisma`
**所有責任**: 処方箋の受付・構造化データ（初回・継続を問わず）

| フィールド | 内容 | 備考 |
|---|---|---|
| `id` | インテークID | |
| `org_id` | 薬局組織ID | RLSキー |
| `cycle_id` | 薬歴サイクルID | MedicationCycle → CareCase → Patient の経路 |
| `source_type` | 処方源種別 | `paper` / `fax` / `e_prescription` / `facility_batch` / `refill` |
| `prescribed_date` | 処方日 | |
| `prescriber_name` | 処方医氏名 | |
| `prescriber_institution` | 処方医療機関 | |
| `original_document_url` | 原本S3 URL | |
| `lines` (PrescriptionLine) | 処方明細行 | drug_name / dose / frequency / days |

**PrescriptionIntake が独占的に所有するもの**:
- 処方の受付日・源泉情報・期限
- 処方明細の構造化データ（薬品名・用量・用法・日数）
- 分割調剤・リフィル管理状態

**設計上の注意**:
- `home_visit_intake` という独立モデルは現在存在しない。PrescriptionIntake が訪問薬剤管理の処方インテークも兼ねる
- MedicationCycle → CareCase の経路でのみ Patient に到達できる（PrescriptionIntake は Patient ID を直接持たない）
- 訪問準備画面 (`visit-preparations`) での処方変更サマリーは PrescriptionIntake を2件比較して生成

---

### 1.4 ContactParty（緊急連絡先）

**定義ファイル**: `prisma/schema/patient.prisma`
**所有責任**: 患者に関するすべての連絡先（緊急連絡先を含む）の現在有効な情報

| フィールド | 内容 | 備考 |
|---|---|---|
| `id` | 連絡先ID | |
| `org_id` | 薬局組織ID | RLSキー |
| `patient_id` | 患者ID | Patient 直下 |
| `name` | 氏名 | |
| `relation` | 続柄 | `ContactRelation` enum |
| `phone` / `email` / `fax` | 連絡先 | |
| `organization_name` / `department` | 所属 | 医師・ケアマネ等の場合 |
| `address` | 住所 | |
| `is_primary` | 主連絡先フラグ | |
| `is_emergency_contact` | **緊急連絡先フラグ** | これが SSOT |

**ContactParty の所有関係**:
- Patient 直下（CareCase に依存しない）
- `is_emergency_contact = true` のレコードが現時点の緊急連絡先 SSOT
- FirstVisitDocument.emergency_contacts (Json) は交付時点のスナップショット（凍結コピー）であり、更新されない

**更新フロー（現在の実装）**:
- `PATCH /api/patients/[id]` → contacts を一括 deleteMany + createMany で更新
- `PUT /api/patients/[id]/contacts` → 同上（contacts 専用エンドポイント）
- FirstVisitDocument の emergency_contacts は患者連絡先更新時に自動同期されない（スナップショットとして意図的に凍結）

---

### 1.5 CareTeamLink（初回訪問との関係）

**定義ファイル**: `prisma/schema/patient.prisma`
**所有責任**: ケースに紐付く他職種連携メンバーの現在情報

| フィールド | 内容 | 備考 |
|---|---|---|
| `id` | リンクID | |
| `org_id` | 薬局組織ID | RLSキー |
| `case_id` | ケースID | CareCase に依存 |
| `external_professional_id` | 外部専門職マスターID (nullable) | ExternalProfessional への参照 |
| `role` | 職種 | physician / nurse / care_manager 等 |
| `name` / `organization_name` / `phone` 等 | 連絡先情報 | |
| `is_primary` | 主担当フラグ | |

**初回訪問との関係**:
- CareTeamLink は初回訪問前に登録が完了している必要があるが、FirstVisitDocument には含まれない
- 訪問準備画面では `schedule.case_.care_team_links` として読み込まれ、緊急連絡や引き継ぎに使用される
- ケアマネ・主治医の連絡先は CareTeamLink が SSOT（ContactParty ではない）

---

## 2. コンシューマーマッピングテーブル

| コンシューマー | 読むエンティティ | 読まないエンティティ | 読むべきだが読んでいない |
|---|---|---|---|
| **`GET /api/patients/[id]`** | Patient, Residence, CareCase, ContactParty, ConsentRecord, CareTeamLink, FirstVisitDocument | PrescriptionIntake（直接） | ― |
| **`GET /api/patients/[id]/contacts`** | ContactParty | FirstVisitDocument | ― |
| **`GET /api/patients/[id]/care-team`** | CareTeamLink (via CareCase) | ContactParty, FirstVisitDocument | ― |
| **`GET /api/patients/[id]/visit-brief`** | getPatientVisitBrief サービス（内部実装）| FirstVisitDocument, ConsentRecord | onboarding 完了状態 |
| **`GET /api/visit-preparations/[scheduleId]`** | VisitSchedule, CareTeamLink, VisitRecord, Task, ContactLog, PrescriptionIntake, BillingEvidence | FirstVisitDocument, ConsentRecord, ContactParty | **FirstVisitDocument**（緊急連絡先スナップショット）、**ConsentRecord**（同意有効確認）、**ContactParty**（is_emergency_contact） |
| **`GET /api/dashboard/workflow`** | ConsentRecord（visit_medication_management のみ）, ManagementPlan | FirstVisitDocument, ContactParty（emergency）| **FirstVisitDocument** 交付漏れ検出、緊急連絡先未登録患者の検出 |
| **患者詳細画面 `patient-detail-tabs.tsx`** | Patient, ContactParty, CareTeamLink, ConsentRecord, FirstVisitDocument（`patient-detail-tabs` 経由） | PrescriptionIntake（タブ別に読む） | ― |
| **`patient-master-card.tsx`** | Patient, Residence | ContactParty, ConsentRecord, FirstVisitDocument | ― |
| **スケジュール日次ビュー `day-view.tsx`** | VisitSchedule, VisitPreparation, PrescriptionIntake | ConsentRecord, FirstVisitDocument, ContactParty | **ConsentRecord** 有効期限アラート、**FirstVisitDocument** 交付未了フラグ |

---

## 3. オンボーディング完了チェックリスト

「初回訪問準備完了（初回訪問実施可能）」の定義と現在の確認状況：

| 確認項目 | 判定条件 | 現在の確認場所 | 現在のステータス |
|---|---|---|---|
| **同意取得済み** | `ConsentRecord.consent_type = visit_medication_management AND is_active = true AND revoked_date IS NULL AND (expiry_date IS NULL OR expiry_date >= TODAY)` | `GET /api/dashboard/workflow` の missing_visit_consent | 実装済み（ワークフローダッシュボードのみ） |
| **緊急連絡先登録済み** | `ContactParty.is_emergency_contact = true` が 1 件以上存在 | 患者詳細の readiness / Workflow Dashboard の欠落検知 | 実装済み |
| **ケアチーム登録済み（主治医）** | `CareTeamLink.role = 'physician'` が 1 件以上存在 | 患者詳細の readiness / Workflow Dashboard の欠落検知 | 実装済み |
| **管理計画書承認済み** | `ManagementPlan.status = approved AND (next_review_date IS NULL OR next_review_date >= TODAY)` | `GET /api/dashboard/workflow` の missing_management_plan | 実装済み（ワークフローダッシュボードのみ） |
| **処方インテーク受付済み** | `MedicationCycle` に紐付く `PrescriptionIntake` が 1 件以上 | 訪問準備画面の prescription_changes | 部分実装（null チェックのみ） |
| **初回訪問文書交付済み** | `FirstVisitDocument.delivered_at IS NOT NULL` | 患者詳細画面の first_visit_documents | 表示のみ実装。ワークフロー未統合 |

---

## 4. ギャップ分析

### 4.1 訪問準備画面（`visit-preparations`）のギャップ

| ギャップ | 現状 | 期待動作 |
|---|---|---|
| 緊急連絡先スナップショット未表示 | care_team_links のみ表示。ContactParty / FirstVisitDocument の emergency_contacts は不参照 | 訪問当日の緊急連絡先を1クリックで確認できる |
| 同意有効確認なし | billing_blockers は確認するが ConsentRecord は未照会 | 同意切れ・未取得の場合は readiness_blockers に追加する |
| オンボーディング完了フラグなし | VisitPreparation チェックリスト（5項目）のみ | 初回訪問の場合は FirstVisitDocument.delivered_at の有無も readiness_blockers に追加する |

### 4.2 日次ビュー / ワークフローダッシュボードのギャップ

| ギャップ | 現状 | 期待動作 |
|---|---|---|
| FirstVisitDocument 交付漏れの検出なし | ワークフローに first_visit_document に関するカウントなし | 今後14日間の訪問予定のうち FirstVisitDocument 未交付の件数を表示する |
| 緊急連絡先未登録患者の検出なし | 以前は ContactParty の直接検出がなかった | Workflow Dashboard / 患者詳細 readiness で検出済み |
| 同意確認の粒度 | `visit_medication_management` のみ。`personal_info_handling` の確認なし | 個人情報同意の有効確認も onboarding 条件に含めるべき |

### 4.3 リスケジュール / 緊急連絡フローのギャップ

| ギャップ | 現状 | 期待動作 |
|---|---|---|
| リスケジュール時の緊急連絡先引き回し | `VisitScheduleContactLog` にコンタクト先情報あり、だが患者の is_emergency_contact との連動なし | リスケジュール承認フローで患者の緊急連絡先を自動候補表示する |
| 緊急時の連絡先優先順位 | ContactParty.is_primary と is_emergency_contact の2フラグが独立しており優先順位が不明確 | `is_emergency_contact = true` かつ `is_primary = true` の1件を「第一緊急連絡先」と定義する規約が必要 |
| 初回訪問文書の再交付フロー | FirstVisitDocument の PATCH/更新 API が存在しない（GET のみ）| 文書の再交付・差替えを記録する更新エンドポイントが必要 |

---

## 5. 用語・記法の統一

| 日本語 | 英語（コード内）| SSOT エンティティ |
|---|---|---|
| 初回訪問文書交付記録 | FirstVisitDocument | `FirstVisitDocument` |
| 緊急連絡先（現在有効） | emergency_contact | `ContactParty.is_emergency_contact = true` |
| 緊急連絡先スナップショット | emergency_contacts (Json) | `FirstVisitDocument.emergency_contacts` |
| 同意記録 | ConsentRecord | `ConsentRecord` |
| 処方インテーク | PrescriptionIntake | `PrescriptionIntake` |
| ケアチーム | care_team_links | `CareTeamLink` |
| オンボーディング完了 | onboarding_ready | 上記3.の全項目を満たす状態 |

---

## 6. 参照先ファイル一覧

| ファイル | 役割 |
|---|---|
| `prisma/schema/patient.prisma` | Patient, ContactParty, ConsentRecord, CareTeamLink, PatientCondition |
| `prisma/schema/medication.prisma` | FirstVisitDocument, Task, MedicationCycle |
| `prisma/schema/prescription.prisma` | PrescriptionIntake, PrescriptionLine |
| `prisma/schema/organization.prisma` | CareCase 経由でつながる外部エンティティ（ExternalProfessional 等）|
| `src/app/api/patients/[id]/route.ts` | 患者詳細 API（全エンティティを統合）|
| `src/app/api/patients/[id]/contacts/route.ts` | ContactParty 専用 CRUD |
| `src/app/api/patients/[id]/care-team/route.ts` | CareTeamLink 専用 CRUD |
| `src/app/api/patients/[id]/visit-brief/route.ts` | 患者サマリー（getPatientVisitBrief サービス）|
| `src/app/api/visit-preparations/[scheduleId]/route.ts` | 訪問準備情報（PrescriptionIntake 比較含む）|
| `src/app/api/dashboard/workflow/route.ts` | ワークフロー全体集計（missing_visit_consent 等）|
| `src/app/(dashboard)/patients/[id]/patient-detail-tabs.tsx` | 患者詳細タブ UI |
| `src/app/(dashboard)/patients/[id]/patient-master-card.tsx` | 患者基本情報カード |
| `src/app/(dashboard)/schedules/day-view.tsx` | 訪問日次ビュー |
