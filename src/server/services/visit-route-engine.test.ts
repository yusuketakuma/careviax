import { describe, expect, it, vi } from 'vitest';

const { createRoadTravelEstimatorMock } = vi.hoisted(() => ({
  createRoadTravelEstimatorMock: vi.fn(),
}));

vi.mock('./road-routing', () => ({
  createRoadTravelEstimator: createRoadTravelEstimatorMock,
}));

import { computeOptimizedVisitRoute } from './visit-route-engine';

describe('computeOptimizedVisitRoute (heuristic path)', () => {
  const origin = { lat: 35.0, lng: 139.0, label: '本店' };
  const travelMode = 'DRIVE' as const;

  // Helper: estimator that always returns null (forces haversine fallback)
  function nullEstimator() {
    return async () => null;
  }

  it('returns unavailable with note=missing_geocode when any waypoint lacks finite lat/lng', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(nullEstimator());

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'sched_1', patientName: '患者A', address: '住所A', lat: 35.1, lng: 139.1 },
        { scheduleId: 'sched_2', patientName: '患者B', address: '住所B', lat: NaN, lng: 139.2 },
        { scheduleId: 'sched_3', patientName: '患者C', address: '住所C', lat: 35.3, lng: 139.3 },
      ],
    });

    expect(result.status).toBe('unavailable');
    expect(result.note).toBe('missing_geocode');
    expect(
      (result as unknown as { missingGeocodeWaypointIds: string[] }).missingGeocodeWaypointIds,
    ).toEqual(['sched_2']);
    expect(result.stopSummaries).toHaveLength(0);
  });

  it('returns unavailable with note=missing_geocode when ALL waypoints lack geocodes', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(nullEstimator());

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'sched_a', patientName: '患者A', address: '', lat: NaN, lng: NaN },
        { scheduleId: 'sched_b', patientName: '患者B', address: '', lat: NaN, lng: NaN },
      ],
    });

    expect(result.status).toBe('unavailable');
    expect(result.note).toBe('missing_geocode');
    const diag = result as unknown as { missingGeocodeWaypointIds: string[] };
    expect(diag.missingGeocodeWaypointIds).toContain('sched_a');
    expect(diag.missingGeocodeWaypointIds).toContain('sched_b');
  });

  it('handles empty waypoints array without crashing and returns sane values', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(nullEstimator());

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [],
    });

    // Empty waypoints hit the guard at the top of computeOptimizedVisitRoute
    expect(result.status).toBe('unavailable');
    expect(result.orderedScheduleIds).toHaveLength(0);
    expect(result.stopSummaries).toHaveLength(0);
  });

  it('handles a single waypoint without crashing', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(nullEstimator());

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'sched_1', patientName: '患者A', address: '住所A', lat: 35.1, lng: 139.1 },
      ],
    });

    expect(result.status).toBe('ok');
    expect(result.orderedScheduleIds).toEqual(['sched_1']);
    expect(result.stopSummaries).toHaveLength(1);
    expect(result.stopSummaries[0].scheduleId).toBe('sched_1');
    expect(result.stopSummaries[0].optimizedOrder).toBe(1);
  });

  it('orders multiple waypoints and returns correct stop summaries', async () => {
    // Estimator returns road distances that make sched_2 closer than sched_1 from origin
    createRoadTravelEstimatorMock.mockReturnValue(
      async (_from: unknown, to: { lat: number; lng: number }) => {
        // sched_1 is at lat 35.5 (far), sched_2 is at lat 35.05 (close)
        const durationMinutes = Math.abs(to.lat - 35.0) * 600;
        return { durationMinutes, distanceKm: durationMinutes / 60 };
      },
    );

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'sched_1', patientName: '患者A', address: '住所A', lat: 35.5, lng: 139.0 },
        { scheduleId: 'sched_2', patientName: '患者B', address: '住所B', lat: 35.05, lng: 139.0 },
      ],
    });

    expect(result.status).toBe('ok');
    // sched_2 is closer so it should come first
    expect(result.orderedScheduleIds[0]).toBe('sched_2');
    expect(result.orderedScheduleIds[1]).toBe('sched_1');
    expect(result.stopSummaries).toHaveLength(2);
  });

  it('uses patient address travel time with visit priority correction', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(
      async (_from: unknown, to: { lat: number; lng: number }) => {
        if (to.lat === 35.04) {
          return { durationMinutes: 5, distanceKm: 1 };
        }
        return { durationMinutes: 35, distanceKm: 7 };
      },
    );

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        {
          scheduleId: 'normal_near',
          patientName: '近い通常患者',
          address: '住所A',
          lat: 35.04,
          lng: 139.0,
          priority: 'normal',
        },
        {
          scheduleId: 'emergency_far',
          patientName: '遠い緊急患者',
          address: '住所B',
          lat: 35.5,
          lng: 139.0,
          priority: 'emergency',
        },
      ],
    });

    expect(result.status).toBe('ok');
    expect(result.note).toBe('優先度補正を含むヒューリスティック順序を表示しています');
    expect(result.orderedScheduleIds).toEqual(['emergency_far', 'normal_near']);
  });
});
