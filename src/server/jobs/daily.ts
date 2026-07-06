// Barrel for the daily operation cron jobs.
//
// The implementation was split out of this single file into the `./daily/`
// directory (one module per cohesive job domain). This barrel preserves the
// original public export surface of `@/server/jobs/daily` so every existing
// consumer keeps importing the same symbols unchanged.

export { runDailyOperationTasks } from './daily/shared';

export { checkPrescriptionOriginalRetention } from './daily-prescription-original-retention';

export {
  checkMedicationDeadlines,
  checkRefillPrescriptions,
  checkIntakeToVisitLinkage,
  checkPrescriptionExpiry,
} from './daily/prescriptions';

export { checkPcaPumpRentalOverdues, checkPcaPumpReturnInspectionPending } from './daily/pca-pumps';

export { checkVisitRecordRetention, generateVisitDemands } from './daily/visits';

export {
  checkManagementPlanReviews,
  checkCallbackFollowups,
  checkResidenceGeocodeQuality,
  checkSelfReportFollowups,
  checkCommunityFollowups,
} from './daily/followups';

export {
  checkPreparationBacklog,
  checkInitialHomeVisitAssessmentBacklog,
  checkCarryItemReadiness,
} from './daily/preparation';

export { generateBillingEvidenceDaily } from './daily/billing';

export { checkConferenceMeetingReminders } from './daily/conferences';

export { checkReportDeliveryBacklog } from './daily/reports';

export { checkEmergencyCoverageGaps } from './daily/emergency';

export { syncVisitSupportFeatureTasks } from './daily/visit-support';

export {
  DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE,
  syncCaseRiskCockpitRiskTasks,
} from './daily/case-risk-tasks';

export {
  checkFacilityStandardExpiry,
  checkCredentialExpiry,
  checkConsentExpiry,
  checkPublicSubsidyExpiry,
} from './daily/compliance-expiry';

export { trackAllOrgPatientStatuses } from './daily/patient-status';

export { cleanupAbandonedQrDrafts, cleanupTerminalQrDraftPayloads } from './daily/cleanup';

export { runDailyOperations } from './daily/orchestrator';
