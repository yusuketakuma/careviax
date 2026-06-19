import { describe, expect, it } from 'vitest';
import { inferCareReportTargetRole } from './care-report-target-role';

describe('inferCareReportTargetRole', () => {
  it.each([
    ['physician_report', 'physician'],
    ['care_manager_report', 'care_manager'],
    ['facility_handoff', 'facility_staff'],
    ['nurse_share', 'nurse'],
    ['family_share', 'family'],
    ['internal_record', 'other'],
    ['', 'other'],
  ])('maps %s to %s', (reportType, targetRole) => {
    expect(inferCareReportTargetRole(reportType)).toBe(targetRole);
  });
});
