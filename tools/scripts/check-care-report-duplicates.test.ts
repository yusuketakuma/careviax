import { describe, expect, it, vi } from 'vitest';
import {
  CARE_REPORT_DUPLICATE_SQL,
  checkCareReportDuplicates,
} from './check-care-report-duplicates';

describe('checkCareReportDuplicates', () => {
  it('checks the care report partial unique-index key', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(checkCareReportDuplicates({ query })).resolves.toEqual({
      ok: true,
      duplicate_groups: 0,
      checked: ['care-report-org-visit-record-report-type-unique'],
      duplicates: [],
      message: 'No duplicate CareReport rows found for org_id + visit_record_id + report_type',
    });

    expect(query).toHaveBeenCalledWith(CARE_REPORT_DUPLICATE_SQL);
    expect(CARE_REPORT_DUPLICATE_SQL).toContain('FROM "CareReport"');
    expect(CARE_REPORT_DUPLICATE_SQL).toContain('WHERE visit_record_id IS NOT NULL');
    expect(CARE_REPORT_DUPLICATE_SQL).toContain('GROUP BY org_id, visit_record_id, report_type');
    expect(CARE_REPORT_DUPLICATE_SQL).toContain('HAVING COUNT(*) > 1');
  });

  it('returns duplicate groups with stable report id ordering', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          org_id: 'org_1',
          visit_record_id: 'visit_record_1',
          report_type: 'regular',
          duplicate_count: '2',
          report_ids: ['report_1', 'report_2'],
        },
      ],
    });

    await expect(checkCareReportDuplicates({ query })).resolves.toEqual({
      ok: false,
      duplicate_groups: 1,
      checked: ['care-report-org-visit-record-report-type-unique'],
      duplicates: [
        {
          org_id: 'org_1',
          visit_record_id: 'visit_record_1',
          report_type: 'regular',
          duplicate_count: 2,
          report_ids: ['report_1', 'report_2'],
        },
      ],
      message:
        'Duplicate CareReport rows would block CareReport_org_visit_record_report_type_unique_idx',
    });

    expect(CARE_REPORT_DUPLICATE_SQL).toContain('ARRAY_AGG(id ORDER BY created_at ASC, id ASC)');
  });
});
