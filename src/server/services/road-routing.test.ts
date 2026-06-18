import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoadTravelEstimator } from './road-routing';

const originalEnv = { ...process.env };

describe('createRoadTravelEstimator', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('normalizes OSRM table estimates from numeric matrix cells', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          durations: [[600]],
          distances: [[2500]],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toEqual({
      durationMinutes: 10,
      distanceKm: 2.5,
    });
  });

  it('uses a single OSRM table request for matrix estimates', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          durations: [
            [0, 600, 900],
            [610, 0, 300],
            [920, 310, 0],
          ],
          distances: [
            [0, 2500, 4000],
            [2550, 0, 1200],
            [4050, 1250, 0],
          ],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel.estimateMatrix([
        { lat: 35.0, lng: 139.0 },
        { lat: 35.1, lng: 139.1 },
        { lat: 35.2, lng: 139.2 },
      ]),
    ).resolves.toEqual([
      [
        { durationMinutes: 0, distanceKm: 0 },
        { durationMinutes: 10, distanceKm: 2.5 },
        { durationMinutes: 15, distanceKm: 4 },
      ],
      [
        { durationMinutes: 610 / 60, distanceKm: 2.55 },
        { durationMinutes: 0, distanceKm: 0 },
        { durationMinutes: 5, distanceKm: 1.2 },
      ],
      [
        { durationMinutes: 920 / 60, distanceKm: 4.05 },
        { durationMinutes: 310 / 60, distanceKm: 1.25 },
        { durationMinutes: 0, distanceKm: 0 },
      ],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe('/table/v1/driving/139,35;139.1,35.1;139.2,35.2');
    expect(requestUrl.searchParams.get('annotations')).toBe('distance,duration');
    expect(requestUrl.searchParams.has('sources')).toBe(false);
    expect(requestUrl.searchParams.has('destinations')).toBe(false);
  });

  it('bounds Google matrix fallback calls instead of exploding into pairwise API requests', async () => {
    process.env.ROUTING_API_PROVIDER = 'google';
    process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [{ duration: '450s', distanceMeters: 1200 }],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');
    const points = Array.from({ length: 9 }, (_, index) => ({
      lat: 35 + index * 0.01,
      lng: 139 + index * 0.01,
    }));

    const matrix = await estimateTravel.estimateMatrix(points);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(matrix).toHaveLength(9);
    expect(matrix?.flat().every((cell) => cell === null)).toBe(true);
  });

  it('uses the default OSRM timeout when the configured timeout is invalid', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    process.env.ROUTING_API_TIMEOUT_MS = 'NaN';
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          durations: [[600]],
          distances: [[2500]],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toEqual({
      durationMinutes: 10,
      distanceKm: 2.5,
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1500);
  });

  it('unrefs OSRM timeout timers and passes an abort signal to fetch', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    process.env.ROUTING_API_TIMEOUT_MS = '2500';
    const unrefMock = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        void handler;
        void timeout;
        void args;
        return { unref: unrefMock } as unknown as ReturnType<typeof setTimeout>;
      },
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          durations: [[600]],
          distances: [[2500]],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toMatchObject({
      durationMinutes: 10,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed OSRM duration matrices', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          durations: [['600']],
          distances: [[2500]],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toBeNull();
  });

  it('rejects invalid OSRM JSON responses', async () => {
    process.env.ROUTING_API_PROVIDER = 'osrm';
    process.env.ROUTING_API_BASE_URL = 'https://osrm.example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toBeNull();
  });

  it('normalizes Google route estimates with strict duration parsing', async () => {
    process.env.ROUTING_API_PROVIDER = 'google';
    process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [{ duration: '450s', distanceMeters: 1200 }],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toEqual({
      durationMinutes: 7.5,
      distanceKm: 1.2,
    });
  });

  it('unrefs Google Routes timeout timers and passes an abort signal to fetch', async () => {
    process.env.ROUTING_API_PROVIDER = 'google';
    process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
    process.env.ROUTING_API_TIMEOUT_MS = '2500';
    const unrefMock = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        void handler;
        void timeout;
        void args;
        return { unref: unrefMock } as unknown as ReturnType<typeof setTimeout>;
      },
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [{ duration: '450s', distanceMeters: 1200 }],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toMatchObject({
      durationMinutes: 7.5,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed Google duration strings instead of partially parsing them', async () => {
    process.env.ROUTING_API_PROVIDER = 'google';
    process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [{ duration: '450abc', distanceMeters: 1200 }],
        }),
        { status: 200 },
      ),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toBeNull();
  });

  it('rejects invalid Google route JSON responses', async () => {
    process.env.ROUTING_API_PROVIDER = 'google';
    process.env.GOOGLE_ROUTES_API_KEY = 'routes-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const estimateTravel = createRoadTravelEstimator('DRIVE');

    await expect(
      estimateTravel({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }),
    ).resolves.toBeNull();
  });
});
