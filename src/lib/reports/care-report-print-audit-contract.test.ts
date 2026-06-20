import { describe, expect, it } from 'vitest';
import {
  CARE_REPORT_PRINT_AUDIT_INTENTS,
  careReportPrintAuditRequestSchema,
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
});
