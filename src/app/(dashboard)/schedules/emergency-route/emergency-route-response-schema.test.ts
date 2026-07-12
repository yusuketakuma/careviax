import { describe, expect, it } from 'vitest';
import { emergencyRouteResponseSchema } from './emergency-route-response-schema';

function buildPayload() {
  return {
    data: {
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.68, lng: 139.76, label: '薬局' },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1_000,
      totalDurationSeconds: 600,
      distanceSource: 'road',
      stopSummaries: [
        {
          scheduleId: 'schedule_1',
          optimizedOrder: 1,
          arrivalOffsetSeconds: 600,
          distanceFromPreviousMeters: 1_000,
          durationFromPreviousSeconds: 600,
          distanceSource: 'road',
          serviceDurationSeconds: 1_800,
          timeWindow: { from: '10:00', to: '11:00' },
        },
      ],
    },
  };
}

describe('emergencyRouteResponseSchema', () => {
  it('accepts the provider route plan contract', () => {
    expect(emergencyRouteResponseSchema.parse(buildPayload())).toEqual(buildPayload().data);
  });

  it.each([
    { route: buildPayload().data },
    { ...buildPayload(), debug: true },
    { data: { ...buildPayload().data, travelMode: 'FLY' } },
    { data: { ...buildPayload().data, totalDurationSeconds: -1 } },
    {
      data: {
        ...buildPayload().data,
        orderedScheduleIds: ['schedule_1', 'schedule_1'],
      },
    },
    {
      data: {
        ...buildPayload().data,
        stopSummaries: [{ ...buildPayload().data.stopSummaries[0], scheduleId: 'schedule_other' }],
      },
    },
  ])('rejects malformed route-plan payload %#', (payload) => {
    expect(emergencyRouteResponseSchema.safeParse(payload).success).toBe(false);
  });
});
