import type {
  ReportTemplatePolicy,
  ReportTemplateProvider,
  ReportTemplateType,
} from '@/core/report/template-registry';
import {
  buildCareManagerReport,
  buildFacilityReport,
  buildPhysicianReport,
  buildVisitingNurseReport,
  type AudienceReportContext,
  type CareManagerReportContext,
  type PhysicianReportContext,
} from './report-templates';

const TEMPLATE_POLICY_BY_TYPE: Record<ReportTemplateType, ReportTemplatePolicy> = {
  physician_report: {
    targetRole: 'physician',
    requiredPermission: 'canSendCareReport',
    maskingProfile: 'care_report_template_draft',
    auditSurface: 'care_report_generation',
    printable: true,
  },
  care_manager_report: {
    targetRole: 'care_manager',
    requiredPermission: 'canSendCareReport',
    maskingProfile: 'care_report_template_draft',
    auditSurface: 'care_report_generation',
    printable: true,
  },
  nurse_share: {
    targetRole: 'nurse',
    requiredPermission: 'canSendCareReport',
    maskingProfile: 'care_report_template_draft',
    auditSurface: 'care_report_generation',
    printable: true,
  },
  facility_handoff: {
    targetRole: 'facility_staff',
    requiredPermission: 'canSendCareReport',
    maskingProfile: 'care_report_template_draft',
    auditSurface: 'care_report_generation',
    printable: true,
  },
};

export function createPharmacyReportTemplateProviders(): readonly ReportTemplateProvider[] {
  return [
    {
      module: 'pharmacy',
      templateType: 'physician_report',
      policy: TEMPLATE_POLICY_BY_TYPE.physician_report,
      renderDraft: (context) => buildPhysicianReport(context as PhysicianReportContext),
    },
    {
      module: 'pharmacy',
      templateType: 'care_manager_report',
      policy: TEMPLATE_POLICY_BY_TYPE.care_manager_report,
      renderDraft: (context) => buildCareManagerReport(context as CareManagerReportContext),
    },
    {
      module: 'pharmacy',
      templateType: 'nurse_share',
      policy: TEMPLATE_POLICY_BY_TYPE.nurse_share,
      renderDraft: (context) => buildVisitingNurseReport(context as AudienceReportContext),
    },
    {
      module: 'pharmacy',
      templateType: 'facility_handoff',
      policy: TEMPLATE_POLICY_BY_TYPE.facility_handoff,
      renderDraft: (context) => buildFacilityReport(context as AudienceReportContext),
    },
  ];
}
