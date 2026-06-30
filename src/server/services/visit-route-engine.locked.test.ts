import { afterEach, describe, expect, it, vi } from 'vitest';

const { createRoadTravelEstimatorMock } = vi.hoisted(() => ({
  createRoadTravelEstimatorMock: vi.fn(),
}));

vi.mock('./road-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./road-routing')>();
  return {
    ...actual,
    createRoadTravelEstimator: createRoadTravelEstimatorMock,
  };
});

import { computeOptimizedVisitRoute } from './visit-route-engine';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  createRoadTravelEstimatorMock.mockReset();
});

/**
 * p0_20「緊急処方の割込・ルート再計算」用の lockedScheduleIds 振る舞いを検証する。
 * 確定済み訪問は入力順のまま先頭に固定され、未固定(緊急など)だけが並べ替えられる。
 */
describe('computeOptimizedVisitRoute (lockedScheduleIds)', () => {
  const origin = { lat: 35.0, lng: 139.0, label: '本店' };
  const travelMode = 'DRIVE' as const;

  function nullEstimator() {
    return async () => null;
  }

  it('keeps locked waypoints at the front in input order and only reorders the rest', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(nullEstimator());

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      // emergency_near は最も近い(先頭に来たがる)が、ロック2件が優先固定される
      waypoints: [
        { scheduleId: 'locked_a', patientName: '確定A', address: '', lat: 35.5, lng: 139.0 },
        { scheduleId: 'locked_b', patientName: '確定B', address: '', lat: 35.4, lng: 139.0 },
        {
          scheduleId: 'emergency_near',
          patientName: '緊急',
          address: '',
          lat: 35.01,
          lng: 139.0,
          priority: 'emergency',
        },
      ],
      lockedScheduleIds: ['locked_a', 'locked_b'],
    });

    expect(result.status).toBe('ok');
    // 確定2件が入力順で先頭固定 → 緊急は末尾
    expect(result.orderedScheduleIds).toEqual(['locked_a', 'locked_b', 'emergency_near']);
    expect(result.note).toContain('確定済み訪問を固定');
    expect(result.stopSummaries.map((stop) => stop.optimizedOrder)).toEqual([1, 2, 3]);
  });

  it('reorders the unlocked tail by proximity while locks stay pinned', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(
      async (_from: unknown, to: { lat: number; lng: number }) => {
        const durationMinutes = Math.abs(to.lat - 35.0) * 600;
        return { durationMinutes, distanceKm: durationMinutes / 60 };
      },
    );

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'locked_x', patientName: '確定X', address: '', lat: 35.9, lng: 139.0 },
        { scheduleId: 'free_far', patientName: '通常遠', address: '', lat: 35.6, lng: 139.0 },
        { scheduleId: 'free_near', patientName: '通常近', address: '', lat: 35.05, lng: 139.0 },
      ],
      lockedScheduleIds: ['locked_x'],
    });

    expect(result.status).toBe('ok');
    // ロックが先頭固定、残り2件は近い順(free_near → free_far)
    expect(result.orderedScheduleIds).toEqual(['locked_x', 'free_near', 'free_far']);
  });

  it('behaves like the default heuristic when lockedScheduleIds is empty', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(
      async (_from: unknown, to: { lat: number; lng: number }) => {
        const durationMinutes = Math.abs(to.lat - 35.0) * 600;
        return { durationMinutes, distanceKm: durationMinutes / 60 };
      },
    );

    const result = await computeOptimizedVisitRoute({
      origin,
      travelMode,
      waypoints: [
        { scheduleId: 'a', patientName: 'A', address: '', lat: 35.5, lng: 139.0 },
        { scheduleId: 'b', patientName: 'B', address: '', lat: 35.05, lng: 139.0 },
      ],
      lockedScheduleIds: [],
    });

    expect(result.status).toBe('ok');
    // 近い順最適化(b → a)。固定の note は付かない
    expect(result.orderedScheduleIds).toEqual(['b', 'a']);
    expect(result.note).not.toContain('確定済み訪問を固定');
  });
});
