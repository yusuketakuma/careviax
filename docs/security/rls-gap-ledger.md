<!-- 自動生成: src/tools/rls-gap-ledger.ts。直接編集しないこと。 -->
<!-- 更新: `UPDATE_RLS_LEDGER=1 pnpm exec vitest run src/tools/rls-policy-contract.test.ts` -->

# RLS ギャップ台帳（W1-7 承認入力資料）

prisma/schema の全モデルから `org_id` 列を持つ = テナントスコープであるべきテーブルを機械導出し、
prisma/migrations と prisma/rls-policies.sql の RLS 有効化実態（ENABLE / FORCE ROW LEVEL SECURITY / POLICY）と
突き合わせた結果。「実体が無い」テーブルを構造化して可視化する。

**この台帳は 3省2ガイドライン準拠のテナント分離監査資料であり、RLS 有効化 migration（W1-7、別承認レーン）の入力。**

## サマリ

| 指標 | 件数 |
| --- | ---: |
| テナントテーブル（org_id 列を持つモデル） | 130 |
| RLS 完全被覆（ENABLE+FORCE+POLICY） | 127 |
| RLS 完全欠落（ギャップ 1a） | 3 |
| ENABLE のみ/policy 不完全（即修正対象） | 0 |
| SSOT ドリフト（migration 済・rls-policies.sql 欠、ギャップ 1b） | 0 |

## 1a. RLS 完全欠落（DB 層 backstop 皆無）

org_id 列を持つが ENABLE ROW LEVEL SECURITY がどこにも無いテーブル。本番 DB でも org 分離の DB 層 backstop が欠如しており、
W1-7 で ENABLE+FORCE+tenant_isolation policy を追加する。

| テーブル | finding | 分類 | PHI | 理由 | 対応予定（W1-7） |
| --- | --- | --- | :---: | --- | --- |
| `IntegrationJob` | machine-derived | 運用データ | ⚠️ 有 | ジョブ実行台帳。org_id は nullable。runner.ts が withOrgContext の外で base prisma を使い create/update する。/api/jobs 管理者経路（refreshMedicalInstitutionMaster/refreshCareServiceOfficeMaster が targetOrgIds:[ctx.orgId] → runJob(..., orgId)）は非 NULL org_id を書き込むため、fail-close の FORCE RLS を張ると当該 INSERT が RLS context missing で throw → master-refresh が 500。input/output(Json?) は job_type 次第で PHI を保持しうるため DB backstop は望ましいが、runner が RLS 対応するまで fail-close RLS は unsafe。 | runner.ts の runJobOnce で orgId が非 NULL のとき create/update を withOrgContext(orgId, tx=>…) に包む（NULL の system 行は base prisma のまま）改修を先行。その後に ENABLE+FORCE+tenant_isolation を追加。 |
| `PrescriberInstitution` | CXR2-RLS01 | design 判定要 | — | 処方元医療機関。org-scoped（拠点別ディレクトリ）か global master かで RLS 適用要否が変わる。要 design 判定。 | W1-7 前に design 判定。org-scoped なら tenant_isolation、global master なら org_id 列自体の撤去/意図明示。 |
| `User` | CXR2-RLS02 | design 判定要 | — | 認証/identity テーブル。org_id 列有だが RLS 適用は auth 境界に触れるため慎重。cross-org ユーザー参照の要件を含め design review が必要。 | auth 境界レーンで human 承認のもと design review。RLS 適用可否・cross-org 参照要件を確定してから migration。 |

## 1b. SSOT ドリフト（migration 済・rls-policies.sql 未反映）

migration で ENABLE+FORCE+POLICY 済のため本番 DB は保護されているが、SSOT ファイル prisma/rls-policies.sql に該当行が無いテーブル。
再provision / 監査 / contract-of-record のドリフト源。W1-7 で SSOT ファイルへ追記する。

| テーブル | finding | PHI | 理由 |
| --- | --- | :---: | --- |

## 参考: RLS 完全被覆テーブル一覧

以下 127 テーブルは ENABLE+FORCE+POLICY が揃い、SSOT にも反映済み（contract テストで機械検証）。

<details><summary>展開</summary>

- `AuditLog`
- `AuditLogReview`
- `BillingCandidate`
- `BillingEvidence`
- `BillingRule`
- `BusinessHoliday`
- `CareCase`
- `CareReport`
- `CareReportRevision`
- `CareReportSendRequest`
- `CareTeamLink`
- `ClaimCooperationNote`
- `CommunicationEvent`
- `CommunicationRequest`
- `CommunicationResponse`
- `CommunityActivity`
- `ConferenceNote`
- `ConsentRecord`
- `ContactParty`
- `ContractDocument`
- `CycleHold`
- `CycleTransitionLog`
- `DeliveryRecord`
- `DispenseAudit`
- `DispenseResult`
- `DispenseTask`
- `DispensingDecision`
- `DocumentDeliveryRule`
- `DrugAlertRule`
- `EscalationRule`
- `ExternalAccessGrant`
- `ExternalProfessional`
- `Facility`
- `FacilityContact`
- `FacilityStandardRegistration`
- `FacilityUnit`
- `FacilityVisitBatch`
- `FileAsset`
- `FirstVisitDocument`
- `FormularyChangeRequest`
- `FormularyTemplate`
- `HandoffBoard`
- `IncidentReport`
- `InquiryRecord`
- `Intervention`
- `JahisSupplementalRecord`
- `ManagementPlan`
- `MedicationCycle`
- `MedicationIssue`
- `MedicationProfile`
- `Membership`
- `Notification`
- `NotificationRule`
- `PackagingGroup`
- `PackagingMethodMaster`
- `PartnerPharmacy`
- `PartnerVisitRecord`
- `Patient`
- `PatientCondition`
- `PatientFieldRevision`
- `PatientInsurance`
- `PatientLabObservation`
- `PatientLink`
- `PatientMcsLink`
- `PatientMcsMessage`
- `PatientMcsSummary`
- `PatientMedicalProcedure`
- `PatientNarcoticUse`
- `PatientPackagingProfile`
- `PatientSchedulePreference`
- `PatientSelfReport`
- `PatientShareCase`
- `PatientShareConsent`
- `PatientShareCorrectionRequest`
- `PcaPump`
- `PcaPumpMaintenanceEvent`
- `PcaPumpRental`
- `PcaPumpRentalAccessory`
- `PharmacistCredential`
- `PharmacistShift`
- `PharmacistShiftTemplate`
- `PharmacyContract`
- `PharmacyContractFeeRule`
- `PharmacyContractVersion`
- `PharmacyCooperationMessage`
- `PharmacyCooperationMessageThread`
- `PharmacyDrugStock`
- `PharmacyInvoice`
- `PharmacyInvoiceItem`
- `PharmacyOperatingHours`
- `PharmacyPartnership`
- `PharmacySite`
- `PharmacySiteInsuranceConfig`
- `PharmacyVisitRequest`
- `PrescriptionIntake`
- `PrescriptionLine`
- `PushSubscription`
- `QrScanDraft`
- `Residence`
- `ResidualMedication`
- `SavedView`
- `ServiceArea`
- `SetAudit`
- `SetBatch`
- `SetBatchChangeLog`
- `SetPlan`
- `SourceOfTruthMatrix`
- `SpecialPatientStatus`
- `Task`
- `TaskComment`
- `Template`
- `TracingReport`
- `UatFeedback`
- `VisitBillingCandidate`
- `VisitHandoffExtraction`
- `VisitInstruction`
- `VisitPreparation`
- `VisitRecord`
- `VisitSchedule`
- `VisitScheduleContactLog`
- `VisitScheduleOverride`
- `VisitScheduleProposal`
- `VisitScheduleProposalBatch`
- `VisitVehicleResource`
- `WebhookDelivery`
- `WebhookRegistration`
- `WorkflowException`

</details>
