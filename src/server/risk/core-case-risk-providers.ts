import type { RiskFindingProvider } from '@/core/risk/provider-registry';
import {
  adaptCareReportToRiskFinding,
  adaptConsentPlanLifecycleToRiskFindings,
  adaptInboundInterprofessionalCommunicationToRiskFindings,
  adaptNotificationToRiskFinding,
  adaptOperationalTaskToRiskFinding,
  adaptPatientMcsIntegrationToRiskFinding,
  adaptPatientSharePrivacyToRiskFindings,
  adaptResidenceGeocodeToRiskFinding,
} from '@/server/services/risk-finding-registry';
import type { CaseRiskProviderInput } from './case-risk-provider-types';

export type CoreCaseRiskProvider = RiskFindingProvider<CaseRiskProviderInput>;

const consentPlanRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.consent_plan_lifecycle',
  domains: ['consent_plan', 'patient_foundation'],
  collect(input) {
    return adaptConsentPlanLifecycleToRiskFindings(
      {
        consent: input.consent,
        managementPlan: input.managementPlan,
        firstVisitDocument: input.firstVisitDocument,
        now: input.now,
      },
      {
        patientId: input.patientId,
        caseId: input.caseId,
        patientHref: input.patientHref,
      },
    );
  },
};

const reportDeliveryRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.report_delivery',
  domains: ['report_delivery'],
  collect(input) {
    return input.reports.flatMap((report) => {
      const finding = adaptCareReportToRiskFinding(report, {
        patientId: input.patientId,
        caseId: input.caseId,
      });
      return finding ? [finding] : [];
    });
  },
};

const notificationRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.notification',
  domains: ['notification'],
  collect(input) {
    return input.notifications.map((notification) =>
      adaptNotificationToRiskFinding(notification, {
        patientId: input.patientId,
        caseId: input.caseId,
      }),
    );
  },
};

const dataQualityRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.data_quality',
  domains: ['data_quality'],
  collect(input) {
    return input.residences.flatMap((residence) => {
      const finding = adaptResidenceGeocodeToRiskFinding(residence, {
        patientId: input.patientId,
        caseId: input.caseId,
      });
      return finding ? [finding] : [];
    });
  },
};

const integrationRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.integration',
  domains: ['integration'],
  collect(input) {
    return input.patientMcsLinks.flatMap((link) => {
      const finding = adaptPatientMcsIntegrationToRiskFinding(link, {
        patientId: input.patientId,
        caseId: input.caseId,
      });
      return finding ? [finding] : [];
    });
  },
};

const inboundInterprofessionalRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.inbound_interprofessional',
  domains: ['integration', 'medication', 'visit_preparation'],
  collect(input) {
    return adaptInboundInterprofessionalCommunicationToRiskFindings(
      input.inboundInterprofessionalCommunication,
      {
        patientId: input.patientId,
        caseId: input.caseId,
      },
    );
  },
};

const privacySecurityRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.privacy_security',
  domains: ['privacy_security'],
  collect(input) {
    return input.patientShareCases.flatMap((shareCase) =>
      adaptPatientSharePrivacyToRiskFindings(shareCase, {
        patientId: input.patientId,
        caseId: input.caseId,
        now: input.now,
      }),
    );
  },
};

const taskSlaRiskProvider: CoreCaseRiskProvider = {
  module: 'core',
  providerId: 'core.task_sla',
  domains: ['task_sla'],
  collect(input) {
    return input.tasks.map((task) =>
      adaptOperationalTaskToRiskFinding(task, {
        patientId: input.patientId,
        caseId: input.caseId,
        now: input.now,
      }),
    );
  },
};

export function createCoreCaseRiskProviders() {
  return [
    consentPlanRiskProvider,
    reportDeliveryRiskProvider,
    notificationRiskProvider,
    dataQualityRiskProvider,
    integrationRiskProvider,
    inboundInterprofessionalRiskProvider,
    privacySecurityRiskProvider,
    taskSlaRiskProvider,
  ] as const;
}
