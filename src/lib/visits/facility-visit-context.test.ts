import { describe, expect, it } from 'vitest';
import {
  createFacilityVisitRecordHref,
  decodeFacilityVisitContext,
  FACILITY_VISIT_CONTEXT_PARAM,
} from './facility-visit-context';

describe('facility visit context helpers', () => {
  it('round-trips facility visit context through a record URL', () => {
    const href = createFacilityVisitRecordHref('schedule_1', {
      label: '青空ホーム',
      siteName: '中央薬局',
      patients: [
        { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
        { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
      ],
    });

    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/visits/schedule_1/record');

    const decoded = decodeFacilityVisitContext(
      url.searchParams.get(FACILITY_VISIT_CONTEXT_PARAM) ?? undefined,
    );

    expect(decoded).toMatchObject({
      label: '青空ホーム',
      siteName: '中央薬局',
      patients: [
        { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
        { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
      ],
    });
  });
});
