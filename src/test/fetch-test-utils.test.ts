import { describe, expect, it, vi } from 'vitest';
import { createJsonFetchMock, jsonResponse, stubJsonFetch } from './fetch-test-utils';

describe('fetch-test-utils', () => {
  it('creates JSON responses with the default JSON content type', async () => {
    const response = jsonResponse({ data: ['row_1'] });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ data: ['row_1'] });
  });

  it('accepts a numeric status shorthand', async () => {
    const response = jsonResponse({ message: 'not found' }, 404);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: 'not found' });
  });

  it('preserves explicit response init fields and headers', () => {
    const response = jsonResponse(
      { ok: true },
      {
        status: 201,
        headers: {
          'x-test': 'kept',
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('x-test')).toBe('kept');
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('creates and stubs fetch mocks that resolve to JSON responses', async () => {
    const fetchMock = createJsonFetchMock({ data: [] });

    await expect(fetchMock('/api/example')).resolves.toBeInstanceOf(Response);

    const globalFetchMock = stubJsonFetch({ ok: true });
    expect(globalThis.fetch).toBe(globalFetchMock);
    await expect(globalFetchMock('/api/example')).resolves.toBeInstanceOf(Response);
    vi.unstubAllGlobals();
  });
});
