import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireApiKeyOrAuthContextMock, flushMetricsMock } = vi.hoisted(() => ({
  requireApiKeyOrAuthContextMock: vi.fn(),
  flushMetricsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireApiKeyOrAuthContext: requireApiKeyOrAuthContextMock,
}));

vi.mock('@/lib/utils/performance', () => ({
  flushPerformanceMetricsToCloudWatch: flushMetricsMock,
}));

import { POST } from './route';

const originalJobApiKey = process.env.JOB_API_KEY;

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/jobs/flush-metrics', {
    method: 'POST',
    headers,
  });
}

describe('/api/jobs/flush-metrics POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOB_API_KEY = 'job-secret';
    flushMetricsMock.mockResolvedValue(undefined);
    requireApiKeyOrAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'admin_1', role: 'admin' },
    });
  });

  afterEach(() => {
    process.env.JOB_API_KEY = originalJobApiKey;
  });

  it('registers the api-key-or-admin auth contract and flushes metrics', async () => {
    const response = await POST(createRequest({ authorization: 'Bearer job-secret' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'flush-metrics',
    });
    expect(requireApiKeyOrAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      apiKey: 'job-secret',
      permission: 'canAdmin',
      message: 'ジョブ実行には管理者権限またはAPIキーが必要です',
    });
    expect(flushMetricsMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the side effect when auth fails', async () => {
    requireApiKeyOrAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'FORBIDDEN', message: 'forbidden' }, { status: 403 }),
    });

    const response = await POST(createRequest({ authorization: 'Bearer wrong' }));

    expect(response.status).toBe(403);
    expect(flushMetricsMock).not.toHaveBeenCalled();
  });

  it('returns a generic 500 response without provider details when flushing fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    flushMetricsMock.mockRejectedValueOnce(new Error('cloudwatch provider secret detail'));

    const response = await POST(createRequest({ authorization: 'Bearer job-secret' }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'EXTERNAL_JOB_FAILED',
      message: 'ジョブの実行に失敗しました',
    });
    expect(JSON.stringify(body)).not.toContain('cloudwatch provider secret detail');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[job:flush-metrics]', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});
