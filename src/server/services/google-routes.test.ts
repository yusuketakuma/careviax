import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeOptimizedVisitRoute } from './google-routes';

const originalEnv = { ...process.env };

describe('google-routes', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns unavailable when the API key is not configured', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    await expect(
      computeOptimizedVisitRoute({
        origin: { lat: 35.0, lng: 139.0, label: '拠点A' },
        travelMode: 'DRIVE',
        waypoints: [
          {
            scheduleId: 'schedule_1',
            patientName: '山田 太郎',
            address: '東京都港区1-1-1',
            lat: 35.1,
            lng: 139.1,
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      note: 'Google Maps API key が未設定のためルート最適化を計算できません',
      orderedScheduleIds: ['schedule_1'],
    });
  });

  it('maps optimized waypoint order and leg durations from Google Routes API', async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              duration: '1800s',
              distanceMeters: 7200,
              optimizedIntermediateWaypointIndex: [1, 0],
              polyline: { encodedPolyline: 'encoded-path' },
              legs: [
                { duration: '600s', distanceMeters: 2400 },
                { duration: '300s', distanceMeters: 1200 },
                { duration: '900s', distanceMeters: 3600 },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await computeOptimizedVisitRoute({
      origin: { lat: 35.0, lng: 139.0, label: '拠点A' },
      travelMode: 'DRIVE',
      waypoints: [
        {
          scheduleId: 'schedule_1',
          patientName: '山田 太郎',
          address: '東京都港区1-1-1',
          lat: 35.1,
          lng: 139.1,
        },
        {
          scheduleId: 'schedule_2',
          patientName: '佐藤 花子',
          address: '東京都港区1-1-2',
          lat: 35.2,
          lng: 139.2,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'test-key',
        }),
      }),
    );
    expect(result).toMatchObject({
      status: 'ok',
      encodedPath: 'encoded-path',
      orderedScheduleIds: ['schedule_2', 'schedule_1'],
      totalDistanceMeters: 7200,
      totalDurationSeconds: 1800,
      stopSummaries: [
        {
          scheduleId: 'schedule_2',
          optimizedOrder: 1,
          arrivalOffsetSeconds: 600,
          distanceFromPreviousMeters: 2400,
          durationFromPreviousSeconds: 600,
        },
        {
          scheduleId: 'schedule_1',
          optimizedOrder: 2,
          arrivalOffsetSeconds: 900,
          distanceFromPreviousMeters: 1200,
          durationFromPreviousSeconds: 300,
        },
      ],
    });
  });
});
