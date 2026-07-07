import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const authResult = await requireAuthContextMock(req);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
}));

import { GET } from './route';

const originalDisableLegacyFileApi = process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];

function createRequest(url = 'http://localhost/api/files/file_1/presigned-download') {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/files/[id]/presigned-download GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'TestBrowser/1.0',
      },
    });
  });

  afterEach(() => {
    if (originalDisableLegacyFileApi === undefined) {
      delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    } else {
      process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = originalDisableLegacyFileApi;
    }
  });

  it('disables the legacy route in PH-OS production before auth or presign', async () => {
    process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = '1';

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHOS_LEGACY_FILE_API_DISABLED',
    });
    expect(requireAuthContextMock).not.toHaveBeenCalled();
  });

  it('rejects JSON presigned URL issuance without returning a signed downloadUrl', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(410);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'FILE_PRESIGNED_DOWNLOAD_JSON_DISABLED',
    });
    const payload = JSON.stringify(body);
    expect(payload).not.toContain('downloadUrl');
    expect(payload).not.toContain('expiresIn');
    expect(payload).not.toContain('https://');
    expect(payload).not.toContain('X-Amz-Signature');
    expect(payload).not.toContain('response-content-disposition');
  });

  it('redirects legacy download=1 requests to the same-origin download route', async () => {
    const response = await GET(
      createRequest('http://localhost/api/files/file_1/presigned-download?download=%201%20'),
      {
        params: Promise.resolve({ id: 'file_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/api/files/file_1/download');
    expectSensitiveNoStore(response);
    expect(response.headers.get('location')).not.toContain('X-Amz-Signature');
    expect(response.headers.get('location')).not.toContain('downloadUrl');
  });

  it('normalizes padded file ids before redirecting to the same-origin download route', async () => {
    const response = await GET(
      createRequest('http://localhost/api/files/file_1/presigned-download?download=1'),
      {
        params: Promise.resolve({ id: '  file_1  ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/api/files/file_1/download');
  });

  it('rejects blank file ids before redirecting', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
  });

  it('encodes hostile file ids as a single same-origin path segment on legacy redirects', async () => {
    const response = await GET(
      createRequest('http://localhost/api/files/unused/presigned-download?download=1'),
      {
        params: Promise.resolve({ id: '../file?x=1#secret' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/api/files/..%2Ffile%3Fx%3D1%23secret/download',
    );
    expectSensitiveNoStore(response);
  });
});
