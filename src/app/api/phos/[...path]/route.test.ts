import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthAccessTokenMock } = vi.hoisted(() => ({
  getAuthAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  getAuthAccessToken: getAuthAccessTokenMock,
}));

import { GET, POST } from './route';

const originalPhosApiBaseUrl = process.env.PHOS_API_BASE_URL;
const originalPublicPhosApiBaseUrl = process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function request(url: string, init: NextRequestInit = {}) {
  return new NextRequest(url, init);
}

describe('/api/phos proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PHOS_API_BASE_URL = 'https://api.example.com/prod';
    delete process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
  });

  afterEach(() => {
    if (originalPhosApiBaseUrl === undefined) delete process.env.PHOS_API_BASE_URL;
    else process.env.PHOS_API_BASE_URL = originalPhosApiBaseUrl;
    if (originalPublicPhosApiBaseUrl === undefined)
      delete process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
    else process.env.NEXT_PUBLIC_PHOS_API_BASE_URL = originalPublicPhosApiBaseUrl;
    vi.unstubAllGlobals();
  });

  it('forwards catalog requests with a server-side bearer token', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { side_effects: [], server_version: 2 },
        { headers: { 'x-request-id': 'upstream_req_1' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      request('http://localhost/api/phos/cards/card_1/actions?trace=1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem_1',
          'x-correlation-id': 'corr_1',
        },
        body: JSON.stringify({ action_code: 'CONFIRM_PRESCRIPTION_DIFF' }),
      }),
      { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('x-request-id')).toBe('upstream_req_1');
    expect(await response.json()).toEqual({ side_effects: [], server_version: 2 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    if (!init) throw new Error('expected fetch init');
    expect(String(url)).toBe('https://api.example.com/prod/cards/card_1/actions?trace=1');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer server-access-token');
    expect(headers.get('idempotency-key')).toBe('idem_1');
    expect(headers.get('x-correlation-id')).toBe('corr_1');
    expect(headers.get('cookie')).toBeNull();
  });

  it('rejects unauthenticated requests before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects paths outside the PH-OS route catalog', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/admin/secrets'), {
      params: Promise.resolve({ path: ['admin', 'secrets'] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'PHOS_ROUTE_NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
