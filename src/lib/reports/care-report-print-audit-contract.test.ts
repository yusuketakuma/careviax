import { describe, expect, it } from 'vitest';
import {
  CARE_REPORT_PRINT_AUDIT_INTENTS,
  careReportPrintAuditRequestSchema,
  careReportPrintAuditResponseSchema,
} from './care-report-print-audit-contract';

describe('care report print audit contract', () => {
  it('accepts the shared print audit intents', () => {
    for (const intent of CARE_REPORT_PRINT_AUDIT_INTENTS) {
      expect(careReportPrintAuditRequestSchema.safeParse({ intent }).success).toBe(true);
    }
  });

  it('rejects unknown print audit intents', () => {
    expect(careReportPrintAuditRequestSchema.safeParse({ intent: 'downloaded' }).success).toBe(
      false,
    );
  });

  it('accepts audited printable report responses', () => {
    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'physician_report',
            content: { summary: '印刷本文' },
          },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects incomplete printable report responses', () => {
    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'physician_report',
          },
        },
      }).success,
    ).toBe(false);
  });
});
