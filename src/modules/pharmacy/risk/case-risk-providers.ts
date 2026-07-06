import type { RiskFindingProvider } from '@/core/risk/provider-registry';
import { describeBillingEvidenceBlockers } from '@/server/services/billing-evidence/core';
import {
  adaptBillingEvidenceBlockerToRiskFinding,
  adaptDispenseTaskToRiskFinding,
  adaptPrescriptionLineReconciliationToRiskFinding,
  adaptUpcomingVisitPreparationToRiskFindings,
} from '@/server/services/risk-finding-registry';
import type { CaseRiskProviderInput } from '@/server/risk/case-risk-provider-types';

export type PharmacyCaseRiskProvider = RiskFindingProvider<CaseRiskProviderInput>;

const visitPreparationRiskProvider: PharmacyCaseRiskProvider = {
  module: 'pharmacy',
  providerId: 'pharmacy.visit_preparation',
  domains: ['visit_preparation'],
  collect(input) {
    const schedule = input.schedules[0] ?? null;
    return adaptUpcomingVisitPreparationToRiskFindings(schedule, {
      patientId: input.patientId,
      caseId: input.caseId,
      patientHref: input.patientHref,
    });
  },
};

const dispensingRiskProvider: PharmacyCaseRiskProvider = {
  module: 'pharmacy',
  providerId: 'pharmacy.dispensing',
  domains: ['dispensing'],
  collect(input) {
    return input.dispenseTasks.map((task) =>
      adaptDispenseTaskToRiskFinding(task, {
        patientId: input.patientId,
        caseId: input.caseId,
        now: input.now,
      }),
    );
  },
};

const medicationReconciliationRiskProvider: PharmacyCaseRiskProvider = {
  module: 'pharmacy',
  providerId: 'pharmacy.medication_reconciliation',
  domains: ['medication'],
  collect(input) {
    return input.prescriptionLines.map((line) =>
      adaptPrescriptionLineReconciliationToRiskFinding(line, {
        patientId: input.patientId,
        caseId: input.caseId,
      }),
    );
  },
};

const billingEvidenceRiskProvider: PharmacyCaseRiskProvider = {
  module: 'pharmacy',
  providerId: 'pharmacy.billing_evidence',
  domains: ['billing'],
  collect(input) {
    const findings = [];

    for (const evidence of input.billingEvidence) {
      if (!evidence.visit_record_id || !input.visitRecordIds.has(evidence.visit_record_id)) {
        continue;
      }
      if (evidence.patient_id && evidence.patient_id !== input.patientId) continue;

      const blockers = describeBillingEvidenceBlockers({
        claimable: evidence.claimable,
        exclusionReason: evidence.exclusion_reason,
        sameMonthExclusionFlags: evidence.same_month_exclusion_flags,
        patientId: input.patientId,
        visitRecordId: evidence.visit_record_id,
      });

      for (const blocker of blockers) {
        findings.push(
          adaptBillingEvidenceBlockerToRiskFinding(blocker, {
            patientId: input.patientId,
            caseId: input.caseId,
            visitRecordId: evidence.visit_record_id,
            billingEvidenceId: evidence.id,
          }),
        );
      }
    }

    return findings;
  },
};

export function createPharmacyCaseRiskProviders() {
  return [
    visitPreparationRiskProvider,
    dispensingRiskProvider,
    medicationReconciliationRiskProvider,
    billingEvidenceRiskProvider,
  ] as const;
}
