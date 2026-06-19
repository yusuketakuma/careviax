import { describe, expect, it } from 'vitest';
import {
  canUseAutomaticReportGeneration,
  findDraftReportForType,
} from './visit-record-report-generation';

describe('visit record report generation helpers', () => {
  it('finds the draft version token for an explicit report type', () => {
    expect(
      findDraftReportForType(
        [
          {
            report_type: 'physician_report',
            status: 'sent',
            updated_at: '2026-03-29T00:00:00.000Z',
          },
          {
            report_type: 'care_manager_report',
            status: 'draft',
            updated_at: '2026-03-30T00:00:00.000Z',
          },
        ],
        'care_manager_report',
      ),
    ).toMatchObject({
      report_type: 'care_manager_report',
      updated_at: '2026-03-30T00:00:00.000Z',
    });
  });

  it('hides automatic generation when any existing draft would require a per-type version token', () => {
    expect(
      canUseAutomaticReportGeneration([
        {
          report_type: 'physician_report',
          status: 'draft',
          updated_at: '2026-03-30T00:00:00.000Z',
        },
        {
          report_type: 'nurse_share',
          status: 'sent',
          updated_at: '2026-03-30T00:05:00.000Z',
        },
      ]),
    ).toBe(false);

    expect(
      canUseAutomaticReportGeneration([
        {
          report_type: 'physician_report',
          status: 'sent',
          updated_at: '2026-03-30T00:00:00.000Z',
        },
      ]),
    ).toBe(true);
  });
});
