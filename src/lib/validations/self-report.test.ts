import { describe, expect, it } from 'vitest';
import { SELF_REPORT_REPORTER_NAME_MAX_LENGTH, selfReportReporterNameSchema } from './self-report';

describe('self-report validation', () => {
  it('normalizes and trims reporter names before persistence', () => {
    expect(selfReportReporterNameSchema.parse('  か\u3099そ\u3099くA  ')).toBe('がぞくA');
  });

  it('accepts the exact reporter-name length boundary', () => {
    expect(
      selfReportReporterNameSchema.parse('名'.repeat(SELF_REPORT_REPORTER_NAME_MAX_LENGTH)),
    ).toHaveLength(SELF_REPORT_REPORTER_NAME_MAX_LENGTH);
  });

  it('rejects oversized and control-bearing reporter names', () => {
    expect(
      selfReportReporterNameSchema.safeParse('名'.repeat(SELF_REPORT_REPORTER_NAME_MAX_LENGTH + 1))
        .success,
    ).toBe(false);
    expect(selfReportReporterNameSchema.safeParse('家族\u0000A').success).toBe(false);
    expect(selfReportReporterNameSchema.safeParse('家族\u200bA').success).toBe(false);
  });
});
