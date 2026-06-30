# 受付票（home_visit_intake）SSOT マッピング

> 作成日: 2026-03-29
> 対象タスク: HVI-01A

---

## 概要

訪問薬剤管理 新規依頼受付票（以下「受付票」）で収集する情報の全項目について、
「現在の保存先」「目標正規化先」「表示先UI」「利用先API/サービス」「活用状況」を固定したドキュメントです。

### 現状の保存構造

受付票データは患者登録時（`POST /api/patients`）に処理されます。

- **正規化済みフィールド**: `Patient`・`Residence`・`ContactParty`・`PatientCondition`・`PatientSchedulePreference`・`PatientPackagingProfile`・`CareCase`・`CareTeamLink` の各モデルに分散保存。
- **JSON保存フィールド**: 上記に正規化されなかった残余情報が `CareCase.required_visit_support` の JSON カラム内 `home_visit_intake` キーにまとめて格納。
- **活用状況**: `PatientIntakeSummaryCard` での表示には使われているが、スケジュール生成・訪問準備・visit-brief・報告書などの下流機能はほとんど読んでいない。

---

## セクション A: 依頼元情報（requester）

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `requester.organization_name` | `optionalTrimmedString`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.requester.organization_name` | `CareCase.referral_source`（既に流用） / `CareTeamLink`（依頼元が医師・CM の場合は正規化推奨） | PatientIntakeSummaryCard A | `POST /api/patients`（`referral_source` に設定） | 表示のみ（referral_source の複製） | HVI-01E で報告書宛先に正規化すべき |
| `requester.profession` | `z.enum(['physician','nursing','care'])`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.requester.profession` | home_visit_intake に残す（依頼元職種は受付時点のみ意味を持つ） | PatientIntakeSummaryCard A | なし | 表示のみ | 依頼元が医師の場合のみ `CareTeamLink(physician)` への変換対象（HVI-01E） |
| `requester.contact_name` | `optionalTrimmedString`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.requester.contact_name` | 依頼元が医師・CM の場合は `CareTeamLink.name` に正規化（HVI-01E） | PatientIntakeSummaryCard A | なし | 表示のみ | |
| `requester.contact_name_kana` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.requester.contact_name_kana` | home_visit_intake に残す | PatientIntakeSummaryCard A | なし | 表示のみ | |
| `requester.phone` | `optionalTrimmedString`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.requester.phone` | 依頼元が医師・CM の場合は `CareTeamLink.phone` に正規化（HVI-01E） | PatientIntakeSummaryCard A | なし | 表示のみ | HVI-01F で通知チャネル優先順位に使う予定 |
| `requester.fax` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.requester.fax` | 同上 `CareTeamLink.fax` | PatientIntakeSummaryCard A | なし | 表示のみ | |
| `requester.pharmacy_decision_due_date` | `optionalDateString` | `CareCase.required_visit_support.home_visit_intake.requester.pharmacy_decision_due_date` | `CareCase` に専用カラム追加推奨（HVI-01F） | PatientIntakeSummaryCard A | なし | 表示のみ | SLA 判定に使うには JSON 参照では不十分。インデックス対象外 |
| `requester.preferred_contact_method` | `z.enum(['phone','fax','mcs','email','other'])` | `CareCase.required_visit_support.home_visit_intake.requester.preferred_contact_method` | home_visit_intake に残す（連絡手段設定は将来 communication ターゲット選定へ HVI-01F） | PatientIntakeSummaryCard A | なし | 表示のみ | HVI-01F で通知ルール生成に使う予定 |
| `requester.preferred_contact_method_other` | `optionalTrimmedString` | 同上 `.preferred_contact_method_other` | home_visit_intake に残す | PatientIntakeSummaryCard A | なし | 表示のみ | |

---

## セクション B: 患者特定情報

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `name` | `z.string().min(1)`（必須） | `Patient.name` | 正規化済み | PatientForm / PatientIntakeSummaryCard B | すべての患者関連 API | アクティブ | |
| `name_kana` | `optionalTrimmedString` | `Patient.name_kana` | 正規化済み | PatientForm | `/api/patients`（name_kana ソート） | アクティブ | |
| `birth_date` | `optionalDateString` | `Patient.birth_date` | 正規化済み | PatientForm / PatientIntakeSummaryCard B | 患者 API 全般 | アクティブ | |
| `gender` | `z.enum(['male','female','other'])`（必須） | `Patient.gender` | 正規化済み | PatientForm | 患者 API 全般 | アクティブ | |
| `phone` | `optionalTrimmedString` | `Patient.phone`（`contact_phone`/`contact_mobile` 優先から自動導出） | 正規化済み | PatientForm | 患者 API 全般 | アクティブ | |
| `medical_insurance_number` | `optionalTrimmedString` | `Patient.medical_insurance_number` | 正規化済み | PatientForm | 患者 API（権限あり時のみ） | アクティブ | マスク制御あり |
| `care_insurance_number` | `optionalTrimmedString` | `Patient.care_insurance_number` | 正規化済み | PatientForm | 患者 API（権限あり時のみ） | アクティブ | マスク制御あり |
| `address` | `optionalTrimmedString`（登録時必須） | `Residence.address` | 正規化済み | PatientForm / 訪問準備 | `/api/visit-preparations/[scheduleId]`（patient.residences） | アクティブ | |
| `building_id` | `optionalTrimmedString` | `Residence.building_id` | 正規化済み | PatientForm | 施設モード判定、ルート計算 | アクティブ | |
| `unit_name` | `optionalTrimmedString` | `Residence.unit_name` | 正規化済み | PatientForm / PatientIntakeSummaryCard B | 同上 | アクティブ | |
| `intake.age`（reported_age） | `optionalNumberString`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.reported_age` | home_visit_intake に残す（生年月日不明時の代替値） | PatientIntakeSummaryCard B | `POST /api/patients`（`birth_date` 推定に使用） | 部分的アクティブ | 登録処理後は `Patient.birth_date` が SSOT |
| `intake.primary_disease` | `optionalTrimmedString`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.primary_disease` + `PatientCondition`（自動生成） | `PatientCondition`（既に正規化） | PatientIntakeSummaryCard B / 疾患タブ | 患者詳細 API（conditions） | アクティブ | 登録時に `PatientCondition` (is_primary=true) として複製保存済み |
| `intake.postal_code` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.postal_code` | `Residence` にカラム追加推奨（ジオコーディング改善） | PatientIntakeSummaryCard B | なし | 表示のみ | Residence はすでに geocode 機能を持つが郵便番号カラムなし |
| `intake.housing_type` | `z.enum(['apartment','detached','facility'])` | `CareCase.required_visit_support.home_visit_intake.housing_type` | home_visit_intake に残す（`Residence.building_id` の有無で代替可） | PatientIntakeSummaryCard B | なし | 表示のみ | |
| `intake.facility_name` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.facility_name` | `Residence.building_id` → 施設マスターに解決済みなら不要。未解決時の補助情報として残す | PatientIntakeSummaryCard B | なし | 表示のみ | |
| `intake.mcs_linked` | `optionalBoolean` | `CareCase.required_visit_support.home_visit_intake.mcs_linked` | `PatientSchedulePreference.notes` に現状テキストで落としているが、専用フラグ追加推奨（HVI-01F） | PatientIntakeSummaryCard B | なし | 表示のみ | MCS 連携フラグが communication ターゲット選定に使われていない |

---

## セクション C: 連絡・訪問条件

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `intake.primary_contact_preference` | `z.enum(['phone','mobile'])`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.primary_contact_preference` + `PatientSchedulePreference.preferred_contact_phone`（間接的に反映） | `PatientSchedulePreference` に `primary_contact_preference` 専用フラグ追加（HVI-01B） | PatientIntakeSummaryCard C | `POST /api/patients`（preferred_contact_phone 設定に使用） | 部分的アクティブ | 生成時のみ使用。事後の schedule では参照されない |
| `intake.contact_phone` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.contact_phone` + `PatientSchedulePreference.preferred_contact_phone`（条件付き） | `PatientSchedulePreference.preferred_contact_phone` （既に部分正規化済み） | PatientIntakeSummaryCard C | `POST /api/patients` | 部分的アクティブ | スケジューラが `PatientSchedulePreference.preferred_contact_phone` を読めば完全活用 |
| `intake.contact_mobile` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.contact_mobile` + `PatientSchedulePreference.preferred_contact_phone`（mobile 優先時） | 同上 | PatientIntakeSummaryCard C | `POST /api/patients` | 部分的アクティブ | |
| `intake.emergency_contact.name` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.emergency_contact.name` + `ContactParty`（自動生成） | `ContactParty`（既に正規化） | PatientIntakeSummaryCard C / 連絡先タブ | 患者詳細 API（contacts） | アクティブ | 登録時に `ContactParty`(is_emergency_contact=true) として複製保存済み |
| `intake.emergency_contact.relation` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.emergency_contact.relation` + `ContactParty.notes` | `ContactParty.relation`（ContactRelation enum として正規化推奨） | PatientIntakeSummaryCard C | 患者詳細 API（contacts.notes に格納） | 部分的アクティブ | `notes` 内テキストとして保存されており enum 解釈不可 |
| `intake.emergency_contact.phone` | `optionalTrimmedString` | 同上 + `ContactParty.phone`（自動生成）| `ContactParty`（既に正規化） | PatientIntakeSummaryCard C | 患者詳細 API | アクティブ | |
| `intake.visit_before_contact_required` | `optionalBoolean`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.visit_before_contact_required` + `PatientSchedulePreference.notes`（テキスト） | `PatientSchedulePreference` に `visit_before_contact_required` 専用ブール追加（HVI-01B） | PatientIntakeSummaryCard C | なし（notes テキストは機械読取不可） | 表示のみ | スケジューラが連絡要否を自動判断できない主因 |
| `intake.first_visit_date` | `optionalDateString` | `CareCase.required_visit_support.home_visit_intake.first_visit_date` + `PatientSchedulePreference.notes`（テキスト） | `PatientSchedulePreference` に `first_visit_preferred_date` 専用日付フィールド追加（HVI-01B） | PatientIntakeSummaryCard C | なし | 表示のみ | スケジューラが初回訪問日制約を読めない |
| `intake.first_visit_time_slot` | `z.enum(['morning','afternoon','specific'])` | 同上 + notes テキスト | `PatientSchedulePreference` に `first_visit_time_slot` enum 追加（HVI-01B） | PatientIntakeSummaryCard C | なし | 表示のみ | |
| `intake.first_visit_time_note` | `optionalTrimmedString` | 同上 + notes テキスト | `PatientSchedulePreference.notes` で代替可 | PatientIntakeSummaryCard C | なし | 表示のみ | |
| `intake.parking_available` | `z.boolean().optional()` | `CareCase.required_visit_support.home_visit_intake.parking_available` + `PatientSchedulePreference.notes`（テキスト） | `PatientSchedulePreference` に `parking_available` 専用ブール追加（HVI-01B） | PatientIntakeSummaryCard C | なし | 表示のみ | 訪問担当者が確認する情報だが notes から読んでいない |

---

## セクション D: 介護・生活背景

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `intake.money_management` | `z.enum(['self','family','unable','public'])` | `CareCase.required_visit_support.home_visit_intake.money_management` | home_visit_intake に残す（ただし visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard D | なし | 表示のみ | 訪問時の金銭授受判断に必要。visit-brief に渡されていない |
| `intake.family_key_person` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.family_key_person` | home_visit_intake に残す（visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard D | なし | 表示のみ | キーパーソンの連絡先は ContactParty で管理するが、「家族構成の説明文」はここに残す |
| `intake.care_level` | `z.enum(['not_applied','applying','not_eligible','support_1',..,'care_5'])`（登録時必須） | `CareCase.required_visit_support.home_visit_intake.care_level` | `PatientCondition` への保存推奨（disease/problem とは別の assessment カテゴリ）または `CareCase` に専用カラム追加（HVI-01D） | PatientIntakeSummaryCard D | なし（patient-risk は直接参照していない） | 表示のみ | リスクアセスメント・算定根拠判定に必要だが未接続 |
| `intake.adl_level` | `z.enum(['independent','a','b','c','unknown'])` | `CareCase.required_visit_support.home_visit_intake.adl_level` | home_visit_intake に残す（visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard D | なし | 表示のみ | 同上 |
| `intake.dementia_level` | `z.enum(['independent','i','ii','iii','iv','m','unknown'])` | `CareCase.required_visit_support.home_visit_intake.dementia_level` | home_visit_intake に残す（visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard D | なし | 表示のみ | 同上 |

---

## セクション E: 薬学的管理情報

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `intake.medication_support_methods` | `z.array(z.enum([...]))` | `CareCase.required_visit_support.home_visit_intake.medication_support_methods` + `PatientPackagingProfile.default_packaging_method` + `PatientPackagingProfile.notes` | `PatientPackagingProfile`（既に部分正規化） | PatientIntakeSummaryCard E | `POST /api/patients`（packaging profile 生成に使用） | 部分的アクティブ | packaging profile には `one of` の選択しか反映されない。visit-brief 未接続 |
| `intake.medication_support_other` | `optionalTrimmedString` | 同上 + `PatientPackagingProfile.notes` | `PatientPackagingProfile.notes` 内（既に部分正規化） | PatientIntakeSummaryCard E | `POST /api/patients` | 部分的アクティブ | |
| `intake.ent_prescription` | `optionalBoolean` | `CareCase.required_visit_support.home_visit_intake.ent_prescription` | home_visit_intake に残す（visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard E | なし | 表示のみ | ENT 処方有無は算定・報告書に影響。未接続 |
| `intake.ent_period_from` | `optionalDateString` | 同上 `.ent_period_from` | home_visit_intake に残す | PatientIntakeSummaryCard E | なし | 表示のみ | |
| `intake.ent_period_to` | `optionalDateString` | 同上 `.ent_period_to` | home_visit_intake に残す | PatientIntakeSummaryCard E | なし | 表示のみ | |
| `intake.initial_transition_management_expected` | `optionalBoolean` | `CareCase.required_visit_support.home_visit_intake.initial_transition_management_expected` | home_visit_intake に残す（billing 算定フラグとして HVI-01E 対象） | PatientIntakeSummaryCard E | なし | 表示のみ | 初期移行管理料の算定候補判定に使えるが BillingEvidence と未接続 |
| `intake.narcotics_base` | `optionalBoolean` | `CareCase.required_visit_support.home_visit_intake.narcotics_base` | home_visit_intake に残す（visit-brief・preparation pack へ注入 HVI-01C/D） | PatientIntakeSummaryCard E | なし | 表示のみ | 麻薬調剤・訪問前持参準備の判断材料。preparation pack 未接続 |
| `intake.narcotics_rescue` | `optionalBoolean` | 同上 `.narcotics_rescue` | 同上 | PatientIntakeSummaryCard E | なし | 表示のみ | 同上 |
| `intake.allergy_history` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.allergy_history` + `Patient.allergy_info`（自動反映） | `Patient.allergy_info`（既に正規化） | PatientIntakeSummaryCard E | 患者詳細 API（allergy_info） | アクティブ | 登録時に `Patient.allergy_info` に複製保存済み |
| `intake.infection_isolation` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.infection_isolation` | home_visit_intake に残す（preparation pack へ注入 HVI-01C） | PatientIntakeSummaryCard E | なし | 表示のみ | 感染症対策が必要な患者の訪問前準備情報。未接続 |
| `intake.swallowing_route` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.swallowing_route` + `PatientPackagingProfile.notes`（部分反映） | `PatientPackagingProfile.notes`（既に部分正規化） | PatientIntakeSummaryCard E | `POST /api/patients` | 部分的アクティブ | |
| `intake.residual_medication_status` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.residual_medication_status` | home_visit_intake に残す（visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard E | なし | 表示のみ | 残薬整理・持参薬確認の初期状況として訪問前準備に必要 |
| `intake.other_clinical_notes` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.other_clinical_notes` | home_visit_intake に残す | PatientIntakeSummaryCard E | なし | 表示のみ | |
| `intake.intake_note` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.intake_note` + `Patient.notes`（優先反映）+ `CareCase.notes` | `CareCase.notes`（既に部分正規化） | PatientIntakeSummaryCard E | なし | 部分的アクティブ | |

---

## セクション F: 多職種連携・特別医療処置

| フィールド | バリデーション定義 | 現在の保存先 | 目標正規化先 | 表示先 UI | 利用先 API / サービス | 活用状況 | 備考 |
|-----------|-----------------|-------------|-------------|----------|---------------------|---------|------|
| `intake.care_manager.name` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.care_manager.name` + `CareTeamLink`（自動生成） | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F / ケアチームパネル | 訪問準備 API（care_team_links）/ `/api/patients/[id]/care-team` | アクティブ | 登録時に `CareTeamLink(care_manager)` として複製保存済み |
| `intake.care_manager.name_kana` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.care_manager.name_kana` + `CareTeamLink.notes` | `CareTeamLink.notes`（既に部分正規化） | PatientIntakeSummaryCard F | なし | 表示のみ | `CareTeamLink` にフリガナカラムなし。notes に埋め込まれている |
| `intake.care_manager.organization_name` | `optionalTrimmedString` | 同上 + `CareTeamLink.organization_name` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | 訪問準備 API | アクティブ | |
| `intake.care_manager.phone` | `optionalTrimmedString` | 同上 + `CareTeamLink.phone` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | 訪問準備 API | アクティブ | |
| `intake.care_manager.fax` | `optionalTrimmedString` | 同上 + `CareTeamLink.fax` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | なし（preparation pack に fax なし） | 部分的アクティブ | |
| `intake.visiting_nurse.name` | `optionalTrimmedString` | `CareCase.required_visit_support.home_visit_intake.visiting_nurse.name` + `CareTeamLink(nurse)`（自動生成） | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F / ケアチームパネル | 訪問準備 API（care_team_links） | アクティブ | 同上 |
| `intake.visiting_nurse.name_kana` | `optionalTrimmedString` | 同上 + `CareTeamLink.notes` | `CareTeamLink.notes`（既に部分正規化） | PatientIntakeSummaryCard F | なし | 表示のみ | |
| `intake.visiting_nurse.organization_name` | `optionalTrimmedString` | 同上 + `CareTeamLink.organization_name` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | 訪問準備 API | アクティブ | |
| `intake.visiting_nurse.phone` | `optionalTrimmedString` | 同上 + `CareTeamLink.phone` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | 訪問準備 API | アクティブ | |
| `intake.visiting_nurse.fax` | `optionalTrimmedString` | 同上 + `CareTeamLink.fax` | `CareTeamLink`（既に正規化） | PatientIntakeSummaryCard F | なし | 部分的アクティブ | |
| `intake.special_medical_procedures` | `z.array(z.enum([...]))` | `CareCase.required_visit_support.home_visit_intake.special_medical_procedures` | home_visit_intake に残す（preparation pack へ注入 HVI-01C、visit-brief へ注入 HVI-01D） | PatientIntakeSummaryCard F | なし | 表示のみ | 無菌調剤・TPN・麻薬・在宅酸素等、訪問前持参準備の判断に直結。preparation pack 未接続 |
| `intake.special_medical_notes` | `optionalTrimmedString` | 同上 `.special_medical_notes` | home_visit_intake に残す | PatientIntakeSummaryCard F | なし | 表示のみ | |

---

## 正規化判断サマリー

### home_visit_intake に残すもの（JSON SSOT として維持）

以下のフィールドは「受付時点のスナップショット」または「下流モデルに適切な受け皿がないため当面保持」する理由で JSON に残します。

| フィールドグループ | 理由 |
|-----------------|------|
| `requester.*`（organization_name・profession・contact_name・phone・fax・pharmacy_decision_due_date・preferred_contact_method） | 依頼元情報は受付時点固有。`CareTeamLink` や `CareCase.referral_source` への変換はケース固有の判断が必要（HVI-01E でルール化） |
| `postal_code`・`housing_type`・`facility_name` | `Residence` に対応カラムなし。ジオコーディング品質改善時に `Residence` へ移行を検討 |
| `mcs_linked` | `PatientSchedulePreference` に専用フラグなし。HVI-01F で追加後に正規化 |
| `visit_before_contact_required`・`first_visit_date`・`first_visit_time_slot`・`parking_available` | `PatientSchedulePreference` に構造化フィールドなし。HVI-01B で追加後に正規化 |
| `care_level`・`adl_level`・`dementia_level`・`money_management`・`family_key_person` | `CareCase` / `PatientCondition` に assessment 系カラムなし。HVI-01D 対応後に評価 |
| `ent_prescription`・`ent_period_*`・`initial_transition_management_expected`・`narcotics_*`・`infection_isolation`・`residual_medication_status`・`special_medical_procedures`・`special_medical_notes` | 訪問前準備・visit-brief・billing に注入予定（HVI-01C/D/E）。専用テーブル不要でパック生成時に読み込む |
| `other_clinical_notes`・`intake_note` | 自由記述。`CareCase.notes` に集約済みだが intake 上の原文保持が望ましい |

### 正規化済みのもの（JSON からは参照値として残すが SSOT は別モデル）

| home_visit_intake 内フィールド | 正規化先 SSOT |
|------------------------------|-------------|
| `reported_age` | `Patient.birth_date` |
| `primary_disease` | `PatientCondition`（is_primary=true） |
| `emergency_contact.*` | `ContactParty`（is_emergency_contact=true） |
| `care_manager.*` | `CareTeamLink`（role=care_manager） |
| `visiting_nurse.*` | `CareTeamLink`（role=nurse） |
| `allergy_history` | `Patient.allergy_info` |
| `contact_phone`/`contact_mobile` | `PatientSchedulePreference.preferred_contact_phone`（部分） |
| `medication_support_methods`・`swallowing_route` | `PatientPackagingProfile` |

---

## 活用状況サマリー（タスク対応優先度順）

| 状況 | 件数 | 主なフィールド |
|------|------|-------------|
| アクティブ（下流で正常利用） | 13 | name, name_kana, birth_date, gender, phone, address, building_id, unit_name, medical/care_insurance_number, primary_disease（PatientCondition）, allergy_history（Patient.allergy_info）, care_manager/visiting_nurse（CareTeamLink） |
| 部分的アクティブ（登録時のみ使用・更新後未反映） | 8 | reported_age, primary_contact_preference, contact_phone, contact_mobile, medication_support_methods, medication_support_other, swallowing_route, intake_note |
| 表示のみ（PatientIntakeSummaryCard 以外で使われていない） | 30以上 | visit_before_contact_required, first_visit_date, first_visit_time_slot, parking_available, care_level, adl_level, dementia_level, narcotics_*, ent_*, special_medical_procedures, money_management 等 |
| 未活用の主因 | — | visit-brief・preparation pack・スケジューラは主要項目を参照済み。残課題は `PatientSchedulePreference` への未正規化項目と、一部 JSON 専用フィールドの下流利用不足 |

---

## マイグレーション戦略（段階的・無停止）

### 原則

1. **既存 JSON は保持する**: `CareCase.required_visit_support` の `home_visit_intake` は削除しない。正規化後も参照値として残す（バックアップ兼任）。
2. **新カラム追加は nullable**: 移行期間中は旧データが null になるため、下流ロジックは「新カラムが null なら JSON フォールバック」で読む。
3. **データ移行は DB マイグレーションスクリプトで実施**: 既存患者 N 件に対し JSON から抽出して新カラムに書き込む。RLS コンテキストが必要なため、org_id ごとのバッチ処理。

### ステップ別計画

#### HVI-01B 対応（PatientSchedulePreference への構造化移行）

```
1. PatientSchedulePreference に以下カラムを追加（nullable）:
   - visit_before_contact_required  Boolean?
   - first_visit_preferred_date     Date?
   - first_visit_time_slot          String?  (morning/afternoon/specific)
   - parking_available              Boolean?
   - primary_contact_preference     String?  (phone/mobile)
   - mcs_linked                     Boolean?

2. POST /api/patients 更新: 新規登録時は新カラムに書く（既存 notes テキストは互換維持）

3. 既存データ移行スクリプト:
   - CareCase.required_visit_support.home_visit_intake から上記フィールドを抽出
   - patient_id → PatientSchedulePreference を UPSERT
   - 注意: PatientSchedulePreference が存在しない患者は CREATE

4. スケジューラ・訪問準備 API を新カラム参照に切り替え（notes フォールバック削除は HVI-01H テスト後）
```

#### HVI-01C/D 対応（preparation pack・visit-brief への注入）

```
1. visit-preparations/[scheduleId] の GET に intake 読み込みロジック追加:
   - schedule → case_ → required_visit_support.home_visit_intake を読む
   - pack.intake_context として以下を追加:
     visit_before_contact_required, narcotics_*, ent_prescription, special_medical_procedures,
     infection_isolation, parking_available, emergency_contact, family_key_person

2. visit-brief サービスに getHomeVisitIntake() を使って intake_context を付与

3. 既存の pack/brief 利用側 UI は intake_context が null の場合を graceful に処理
```

#### HVI-01E 対応（依頼元の CareTeamLink 正規化）

```
1. requester.profession === 'physician' の場合:
   - CareTeamLink(role=physician) が未作成なら自動生成
   - POST /api/patients の既存 careTeamSeedLinks ロジックに physician を追加

2. 既存データ: Cases ごとに requester.profession=physician を持つものを検索し CareTeamLink を UPSERT
```

### 読み込み互換性

新旧データ混在期間中、`getHomeVisitIntake()` ヘルパーは引き続き JSON から読む。
新カラムを追加したモデルは「新カラム優先 / null なら JSON フォールバック」パターンを採用:

```typescript
// 例: visit_before_contact_required の読み取り
const visitBeforeContact =
  preference.visit_before_contact_required ??
  getHomeVisitIntake(case_.required_visit_support)?.visit_before_contact_required ??
  null;
```

このパターンを各サービス関数に実装し、マイグレーション完了後にフォールバックを除去する。

---

## 関連タスク参照

| タスク | 本ドキュメントとの関係 |
|--------|---------------------|
| HVI-01B | セクション C の visit_before_contact_required・first_visit_date・parking_available 等を PatientSchedulePreference に構造化 |
| HVI-01C | セクション C/E/F（narcotics・special_medical_procedures・infection_isolation 等）を preparation pack に注入 |
| HVI-01D | セクション D/E（care_level・adl_level・dementia_level・ent・money_management 等）を visit-brief/visit-records に配線 |
| HVI-01E | セクション A（requester.physician 正規化）と billing（ent・initial_transition_management）を報告書・算定に配線 |
| HVI-01F | セクション A（pharmacy_decision_due_date・preferred_contact_method）と B（mcs_linked）を通知・reschedule に反映 |
| HVI-01G | 全セクションの表示統一（PatientIntakeSummaryCard の subset を他画面に共通表示） |
| HVI-01H | 本ドキュメントで「表示のみ」と分類したフィールドが正規化後に下流で観測できることをテストで確認 |
