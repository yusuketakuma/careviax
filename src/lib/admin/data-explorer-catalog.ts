export const COVERAGE_CATEGORY_LABELS = {
  frontend_api: '画面 + API',
  partial: '画面あり / 間接',
  api_only: 'API中心',
  backend_only: 'backend only',
} as const;

export type CoverageCategory = keyof typeof COVERAGE_CATEGORY_LABELS;

const COVERAGE_CATEGORY_ENTRIES = {
  frontend_api: [
    'BillingRule',
    'Notification',
    'AuditLog',
    'Template',
    'DocumentDeliveryRule',
    'Setting',
    'DrugMaster',
    'PackagingMethodMaster',
    'Task',
    'TaskComment',
    'Facility',
    'ServiceArea',
    'ExternalProfessional',
    'PrescriberInstitution',
    'PharmacistCredential',
    'Patient',
    'PatientMcsLink',
    'PatientMcsSummary',
    'PatientMcsMessage',
    'ManagementPlan',
    'VisitRecord',
  ],
  partial: [
    'BillingCandidate',
    'PatientCondition',
    'ConsentRecord',
    'PrescriptionIntake',
    'SetPlan',
    'SetBatchChangeLog',
    'SetAudit',
  ],
  api_only: [
    'NotificationRule',
    'BillingEvidence',
    'CommunicationEvent',
    'CommunicationRequest',
    'CareReport',
    'ConferenceNote',
    'EscalationRule',
    'TracingReport',
    'PatientSelfReport',
    'CommunityActivity',
    'UatFeedback',
    'PharmacyDrugStock',
    'DrugMasterImportLog',
    'MedicationProfile',
    'ResidualMedication',
    'MedicationIssue',
    'PharmacySite',
    'PharmacistShift',
    'PharmacistShiftTemplate',
    'BusinessHoliday',
    'MedicationCycle',
    'CycleTransitionLog',
    'InquiryRecord',
    'DispenseTask',
    'DispenseResult',
    'DispenseAudit',
    'DispensingDecision',
    'SetBatch',
    'WorkflowException',
    'VisitSchedule',
    'FacilityVisitBatch',
    'VisitPreparation',
    'VisitScheduleProposal',
    'QrScanDraft',
    'JahisSupplementalRecord',
  ],
  backend_only: [
    'IntegrationJob',
    'LabelDictionary',
    'SourceOfTruthMatrix',
    'CommunicationResponse',
    'DeliveryRecord',
    'ExternalAccessGrant',
    'DrugPackageInsert',
    'DrugInteraction',
    'DrugAlertRule',
    'GenericDrugMapping',
    'Intervention',
    'FirstVisitDocument',
    'Organization',
    'FacilityContact',
    'FacilityUnit',
    'HandoffBoard',
    'HandoffItem',
    'PushSubscription',
    'WebhookRegistration',
    'User',
    'Membership',
    'FacilityStandardRegistration',
    'PharmacySiteInsuranceConfig',
    'PatientPackagingProfile',
    'Residence',
    'CareCase',
    'ContactParty',
    'CareTeamLink',
    'PatientSchedulePreference',
    'PatientInsurance',
    'PatientLabObservation',
    'PrescriptionLine',
    'VisitScheduleContactLog',
    'VisitScheduleOverride',
  ],
} as const satisfies Record<CoverageCategory, readonly string[]>;

const coverageCategoryByModel = new Map<string, CoverageCategory>();

for (const [category, models] of Object.entries(COVERAGE_CATEGORY_ENTRIES) as Array<
  [CoverageCategory, readonly string[]]
>) {
  for (const model of models) {
    coverageCategoryByModel.set(model, category);
  }
}

export const COVERAGE_CATALOG = COVERAGE_CATEGORY_ENTRIES;

export function getCoverageCategory(modelName: string): CoverageCategory {
  return coverageCategoryByModel.get(modelName) ?? 'backend_only';
}

export function getCoverageLabel(modelName: string): string {
  return COVERAGE_CATEGORY_LABELS[getCoverageCategory(modelName)];
}
