import { describe, expect, it } from 'vitest';
import {
  createFacilityVisitRecordHref,
  decodeFacilityVisitContext,
  FACILITY_VISIT_CONTEXT_PARAM,
  getNextGroupedVisitScheduleId,
} from './facility-visit-context';

describe('facility visit context helpers', () => {
  it('round-trips facility visit context through a record URL', () => {
    const href = createFacilityVisitRecordHref('schedule_1', {
      label: '青空ホーム',
      siteName: '中央薬局',
      placeKind: 'facility',
      commonNotes: '受付で入館証を受け取る',
      patients: [
        { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
        { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
      ],
    });

    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/visits/schedule_1/record');
    expect(url.search).toBe('');
  });

  it('keeps legacy facility visit context decoding for existing shared URLs only', () => {
    const legacyContext = encodeURIComponent(
      JSON.stringify({
        label: '青空ホーム',
        siteName: '中央薬局',
        placeKind: 'facility',
        commonNotes: '受付で入館証を受け取る',
        patients: [
          { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
          { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
        ],
      }),
    );
    const decoded = decodeFacilityVisitContext(
      new URLSearchParams([[FACILITY_VISIT_CONTEXT_PARAM, legacyContext]]).get(
        FACILITY_VISIT_CONTEXT_PARAM,
      ) ?? undefined,
    );

    expect(decoded).toMatchObject({
      label: '青空ホーム',
      siteName: '中央薬局',
      placeKind: 'facility',
      commonNotes: '受付で入館証を受け取る',
      patients: [
        { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
        { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
      ],
    });
  });

  it('finds the next unrecorded patient for facility or home grouped visits', () => {
    expect(
      getNextGroupedVisitScheduleId('schedule_1', {
        label: '山田宅',
        siteName: null,
        placeKind: 'home_group',
        patients: [
          {
            scheduleId: 'schedule_1',
            patientName: '山田太郎',
            unitName: null,
            routeOrder: 1,
            visitRecordId: null,
          },
          {
            scheduleId: 'schedule_2',
            patientName: '山田花子',
            unitName: null,
            routeOrder: 2,
            visitRecordId: null,
          },
        ],
      }),
    ).toBe('schedule_2');
  });

  it('wraps to an earlier unrecorded patient when later grouped visits are already recorded', () => {
    expect(
      getNextGroupedVisitScheduleId('schedule_3', {
        label: '青空ホーム',
        siteName: '中央薬局',
        placeKind: 'facility',
        patients: [
          {
            scheduleId: 'schedule_1',
            patientName: '田中太郎',
            unitName: '201',
            routeOrder: 1,
            visitRecordId: null,
          },
          {
            scheduleId: 'schedule_2',
            patientName: '佐藤花子',
            unitName: '203',
            routeOrder: 2,
            visitRecordId: 'record_2',
          },
          {
            scheduleId: 'schedule_3',
            patientName: '鈴木一郎',
            unitName: '205',
            routeOrder: 3,
            visitRecordId: null,
          },
        ],
      }),
    ).toBe('schedule_1');
  });

  it('returns null when all grouped visits are recorded or current schedule is outside context', () => {
    const context = {
      label: '山田宅',
      siteName: null,
      placeKind: 'home_group' as const,
      patients: [
        {
          scheduleId: 'schedule_1',
          patientName: '山田太郎',
          unitName: null,
          routeOrder: 1,
          visitRecordId: 'record_1',
        },
        {
          scheduleId: 'schedule_2',
          patientName: '山田花子',
          unitName: null,
          routeOrder: null,
          visitRecordId: 'record_2',
        },
      ],
    };

    expect(getNextGroupedVisitScheduleId('schedule_1', context)).toBeNull();
    expect(getNextGroupedVisitScheduleId('missing_schedule', context)).toBeNull();
  });
});
