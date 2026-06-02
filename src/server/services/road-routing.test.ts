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
