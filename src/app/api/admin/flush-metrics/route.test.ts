import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, flushMetricsMock } = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(),
  flushMetricsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>, options: unknown) => {
    withAuthContextMock(handler, options);
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'admin_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  flushPerformanceMetricsToCloudWatch: flushMetricsMock,
}));

import { POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest() {
  return new NextRequest('http://localhost/api/admin/flush-metrics', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/admin/flush-metrics POST', () => {
  beforeEach(() => {
    flushMetricsMock.mockClear();
    flushMetricsMock.mockResolvedValue(undefined);
  });

  it('registers the admin permission contract and flushes metrics', async () => {
    const response = await POST(createRequest(), emptyRouteContext);

    expect(withAuthContextMock).toHaveBeenCalledWith(expect.any(Function), {
      permission: 'canAdmin',
      message: 'メトリクスのフラッシュ権限がありません',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(flushMetricsMock).toHaveBeenCalledTimes(1);
  });

  it('returns a generic 500 response without provider details when flushing fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      flushMetricsMock.mockRejectedValueOnce(new Error('cloudwatch provider secret detail'));

      const response = await POST(createRequest(), emptyRouteContext);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'EXTERNAL_JOB_FAILED',
        message: 'メトリクスのフラッシュに失敗しました',
      });
      expect(JSON.stringify(body)).not.toContain('cloudwatch provider secret detail');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]).toHaveLength(1);
      const logEntry = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(logEntry).toMatchObject({
        level: 'error',
        message: 'admin.flush_metrics_failed',
        event: 'admin.flush_metrics_failed',
        jobType: 'flush-metrics',
        operation: 'flush_metrics',
        code: 'EXTERNAL_JOB_FAILED',
        error_name: 'Error',
      });
      expect(JSON.stringify(logEntry)).not.toContain('cloudwatch provider secret detail');
      expect(logEntry).not.toHaveProperty('stack');
      expect(logEntry).not.toHaveProperty('error_message');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
