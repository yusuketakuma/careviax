import { describe, expect, it } from 'vitest';
import type { ReportTemplateType } from '@/core/report/template-registry';
import { inferCareReportTargetRole } from '@/lib/reports/care-report-target-role';
import { activeReportTemplateRegistry } from './active-template-registry';

const activeTemplateTypes: readonly ReportTemplateType[] = [
  'physician_report',
  'care_manager_report',
  'nurse_share',
  'facility_handoff',
];

describe('activeReportTemplateRegistry', () => {
  it('registers the current pharmacy care report templates', () => {
    expect(activeReportTemplateRegistry.listTemplateTypes()).toEqual(activeTemplateTypes);
  });

  it('requires output policy metadata for every active template', () => {
    for (const templateType of activeTemplateTypes) {
      const provider = activeReportTemplateRegistry.getProvider(templateType);

      expect(provider).toMatchObject({
        module: 'pharmacy',
        templateType,
        policy: {
          targetRole: inferCareReportTargetRole(templateType),
          requiredPermission: 'canSendCareReport',
          maskingProfile: 'care_report_template_draft',
          auditSurface: 'care_report_generation',
          printable: true,
        },
      });
    }
  });

  it('fails closed for unregistered report template types', () => {
    expect(
      activeReportTemplateRegistry.getProvider('family_share' as ReportTemplateType),
    ).toBeNull();
  });
});
