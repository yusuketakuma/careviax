import { describe, expect, it } from 'vitest';
import { isShareableCareReportStatus, SHAREABLE_CARE_REPORT_STATUSES } from './shareability';

describe('care report shareability', () => {
  it('uses one lifecycle rule for finalized and delivery-failed reports', () => {
    expect(SHAREABLE_CARE_REPORT_STATUSES).toEqual([
      'confirmed',
      'sent',
      'failed',
      'response_waiting',
    ]);
    expect(
      Object.fromEntries(
        ['draft', 'confirmed', 'sent', 'failed', 'response_waiting', 'unknown'].map((status) => [
          status,
          isShareableCareReportStatus(status),
        ]),
      ),
    ).toEqual({
      draft: false,
      confirmed: true,
      sent: true,
      failed: true,
      response_waiting: true,
      unknown: false,
    });
  });
});
