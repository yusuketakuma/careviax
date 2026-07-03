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
| テナントテーブル（org_id 列を持つモデル） | 126 |
| RLS 完全被覆（ENABLE+FORCE+POLICY） | 103 |
| RLS 完全欠落（ギャップ 1a） | 14 |
| ENABLE のみ/policy 不完全（即修正対象） | 0 |
| SSOT ドリフト（migration 済・rls-policies.sql 欠、ギャップ 1b） | 9 |

## 1a. RLS 完全欠落（DB 層 backstop 皆無）

org_id 列を持つが ENABLE ROW LEVEL SECURITY がどこにも無いテーブル。本番 DB でも org 分離の DB 層 backstop が欠如しており、
W1-7 で ENABLE+FORCE+tenant_isolation policy を追加する。

| テーブル | finding | 分類 | PHI | 理由 | 対応予定（W1-7） |
| --- | --- | --- | :---: | --- | --- |
| `PatientPackagingProfile` | N01 | PHI（最重大） | ⚠️ 有 | 患者一包化プロファイル（服薬・PHI）。RLS 皆無で DB 層テナント分離 backstop が完全欠如。 | W1-7 最優先。ENABLE+FORCE ROW LEVEL SECURITY + tenant_isolation policy を追加。 |
| `VisitScheduleContactLog` | N07 | PHI（最重大） | ⚠️ 有 | 訪問スケジュールの連絡記録（患者・関係者の連絡先/やり取り、PHI 相当）。RLS 皆無。 | W1-7 で org_id ベース tenant_isolation policy + FORCE を追加。 |
| `VisitScheduleOverride` | N06 | 運用データ | — | 訪問スケジュール上書き（visit スコープ運用データ）。org_id 列有だが DB backstop 欠如。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `BillingRule` | N14 | org 設定/マスタ | — | 請求ルール設定（org billing config）。org_id 列有だが RLS 皆無。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `BusinessHoliday` | N29 | org 設定/マスタ | — | 営業日/休業日設定（org config）。RLS 皆無。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `FacilityUnit` | N12 | org 設定/マスタ | — | 施設ユニットマスタ（tenant master）。親 Facility は RLS 有で被覆が非対称。 | W1-7 で親 Facility と同じ tenant_isolation policy を追加し被覆を対称化。 |
| `FormularyChangeRequest` | F79 | org 設定/マスタ | — | 採用薬変更申請（org business config）。全 consumer が app 層で org_id filter 済で latent backstop 欠如。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `FormularyTemplate` | F79/N11 | org 設定/マスタ | — | フォーミュラリテンプレート（org business config）。F79 に内包、app 層 filter 済の latent backstop 欠如。 | W1-7 で FormularyChangeRequest と同時に policy を追加。 |
| `IntegrationJob` | machine-derived | org 設定/マスタ | — | 外部連携ジョブ（org スコープ）。org_id 列有だが RLS 皆無。手動 finding 一覧から漏れており、schema 機械導出で新規に捕捉。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。ペイロードの PHI 有無も要確認。 |
| `NotificationRule` | N33 | org 設定/マスタ | — | 通知ルール設定（org config）。RLS 皆無。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `PackagingMethodMaster` | N28 | org 設定/マスタ | — | 一包化方法マスタ（tenant master）。RLS 皆無。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `PharmacySiteInsuranceConfig` | N17 | org 設定/マスタ | — | 拠点別保険設定（org 保険 config）。RLS 皆無。 | W1-7 で ENABLE+FORCE+tenant_isolation policy を追加。 |
| `PrescriberInstitution` | CXR2-RLS01 | design 判定要 | — | 処方元医療機関。org-scoped（拠点別ディレクトリ）か global master かで RLS 適用要否が変わる。要 design 判定。 | W1-7 前に design 判定。org-scoped なら tenant_isolation、global master なら org_id 列自体の撤去/意図明示。 |
| `User` | CXR2-RLS02 | design 判定要 | — | 認証/identity テーブル。org_id 列有だが RLS 適用は auth 境界に触れるため慎重。cross-org ユーザー参照の要件を含め design review が必要。 | auth 境界レーンで human 承認のもと design review。RLS 適用可否・cross-org 参照要件を確定してから migration。 |

## 1b. SSOT ドリフト（migration 済・rls-policies.sql 未反映）

migration で ENABLE+FORCE+POLICY 済のため本番 DB は保護されているが、SSOT ファイル prisma/rls-policies.sql に該当行が無いテーブル。
再provision / 監査 / contract-of-record のドリフト源。W1-7 で SSOT ファイルへ追記する。

| テーブル | finding | PHI | 理由 |
| --- | --- | :---: | --- |
| `JahisSupplementalRecord` | N03 | ⚠️ 有 | 処方 PHI（JAHIS 補足レコード）。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `PatientCondition` | N08 | ⚠️ 有 | 患者病態（医療 PHI）。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `ExternalProfessional` | N02/N13/N15 | — | 外部専門職ディレクトリ。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `Facility` | N02/N13/N15 | — | 施設マスタ。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `FacilityContact` | N02/N13/N15 | — | 施設連絡先。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `PharmacyCooperationMessage` | N04/N09 | — | 薬局連携メッセージ。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `PharmacyCooperationMessageThread` | N04/N09 | — | 薬局連携メッセージスレッド。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `SavedView` | N05 | — | 保存ビュー。migration で RLS 済だが SSOT ファイルに 0 行。 |
| `UatFeedback` | N31 | — | UAT フィードバック。migration で RLS 済だが SSOT ファイルに 0 行。 |

## 参考: RLS 完全被覆テーブル一覧

以下 103 テーブルは ENABLE+FORCE+POLICY が揃い、SSOT にも反映済み（contract テストで機械検証）。

<details><summary>展開</summary>

- `AuditLog`
- `BillingCandidate`
- `BillingEvidence`
- `CareCase`
- `CareReport`
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
- `FacilityStandardRegistration`
- `FacilityVisitBatch`
- `FileAsset`
- `FirstVisitDocument`
- `HandoffBoard`
- `IncidentReport`
- `InquiryRecord`
- `Intervention`
- `ManagementPlan`
- `MedicationCycle`
- `MedicationIssue`
- `MedicationProfile`
- `Membership`
- `Notification`
- `PackagingGroup`
- `PartnerPharmacy`
- `PartnerVisitRecord`
- `Patient`
- `PatientFieldRevision`
- `PatientInsurance`
- `PatientLabObservation`
- `PatientLink`
- `PatientMcsLink`
- `PatientMcsMessage`
- `PatientMcsSummary`
- `PatientMedicalProcedure`
- `PatientNarcoticUse`
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
- `PharmacyDrugStock`
- `PharmacyInvoice`
- `PharmacyInvoiceItem`
- `PharmacyOperatingHours`
- `PharmacyPartnership`
- `PharmacySite`
- `PharmacyVisitRequest`
- `PrescriptionIntake`
- `PrescriptionLine`
- `PushSubscription`
- `QrScanDraft`
- `Residence`
- `ResidualMedication`
- `ServiceArea`
- `SetAudit`
- `SetBatch`
- `SetBatchChangeLog`
- `SetPlan`
- `SourceOfTruthMatrix`
- `Task`
- `TaskComment`
- `Template`
- `TracingReport`
- `VisitBillingCandidate`
- `VisitHandoffExtraction`
- `VisitPreparation`
- `VisitRecord`
- `VisitSchedule`
- `VisitScheduleProposal`
- `VisitScheduleProposalBatch`
- `VisitVehicleResource`
- `WebhookDelivery`
- `WebhookRegistration`
- `WorkflowException`

</details>
