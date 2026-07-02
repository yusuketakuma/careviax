import { runJob } from '../runner';
import { checkDrugMasterFreshness } from '../drug-master';
import { checkPrescriptionOriginalRetention } from '../daily-prescription-original-retention';
import {
  getSafeDailyOperationErrorMessage,
  resolveDailyOperationConcurrency,
  runDailyOperationTasks,
} from './shared';
import {
  checkMedicationDeadlines,
  checkRefillPrescriptions,
  checkIntakeToVisitLinkage,
  checkPrescriptionExpiry,
} from './prescriptions';
import { checkPcaPumpRentalOverdues, checkPcaPumpReturnInspectionPending } from './pca-pumps';
import { checkVisitRecordRetention, generateVisitDemands } from './visits';
import {
  checkManagementPlanReviews,
  checkCallbackFollowups,
  checkResidenceGeocodeQuality,
  checkSelfReportFollowups,
  checkCommunityFollowups,
} from './followups';
import {
  checkPreparationBacklog,
  checkInitialHomeVisitAssessmentBacklog,
  checkCarryItemReadiness,
} from './preparation';
import { generateBillingEvidenceDaily } from './billing';
import { checkConferenceMeetingReminders } from './conferences';
import { checkReportDeliveryBacklog } from './reports';
import { checkEmergencyCoverageGaps } from './emergency';
import { syncVisitSupportFeatureTasks } from './visit-support';
import {
  checkFacilityStandardExpiry,
  checkCredentialExpiry,
  checkConsentExpiry,
  checkPublicSubsidyExpiry,
} from './compliance-expiry';
import { trackAllOrgPatientStatuses } from './patient-status';
import { cleanupAbandonedQrDrafts, cleanupTerminalQrDraftPayloads } from './cleanup';

export async function runDailyOperations() {
  return runJob('daily', async () => {
    const settled = await runDailyOperationTasks(
      [
        checkMedicationDeadlines,
        checkRefillPrescriptions,
        checkPcaPumpRentalOverdues,
        checkPcaPumpReturnInspectionPending,
        checkIntakeToVisitLinkage,
        checkPrescriptionExpiry,
        checkVisitRecordRetention,
        checkPrescriptionOriginalRetention,
        generateVisitDemands,
        checkManagementPlanReviews,
        checkCallbackFollowups,
        checkResidenceGeocodeQuality,
        checkPreparationBacklog,
        checkInitialHomeVisitAssessmentBacklog,
        generateBillingEvidenceDaily,
        checkSelfReportFollowups,
        checkCommunityFollowups,
        checkConferenceMeetingReminders,
        checkReportDeliveryBacklog,
        checkCarryItemReadiness,
        checkEmergencyCoverageGaps,
        syncVisitSupportFeatureTasks,
        checkFacilityStandardExpiry,
        checkCredentialExpiry,
        checkConsentExpiry,
        checkPublicSubsidyExpiry,
        trackAllOrgPatientStatuses,
        cleanupAbandonedQrDrafts,
        cleanupTerminalQrDraftPayloads,
        checkDrugMasterFreshness,
      ],
      resolveDailyOperationConcurrency(process.env.DAILY_OPERATION_CONCURRENCY),
    );

    let processedCount = 0;
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        processedCount += result.value.processedCount;
        if ('errors' in result.value && result.value.errors) {
          errors.push(...result.value.errors.map(() => getSafeDailyOperationErrorMessage()));
        }
      } else {
        errors.push(getSafeDailyOperationErrorMessage());
      }
    }

    return { processedCount, errors };
  });
}
