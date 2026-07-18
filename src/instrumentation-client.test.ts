import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { captureRouterTransitionStartMock, initMock, replayIntegrationMock } = vi.hoisted(() => ({
  captureRouterTransitionStartMock: vi.fn(),
  initMock: vi.fn(),
  replayIntegrationMock: vi.fn(() => ({ name: 'replay' })),
}));

vi.mock('@sentry/nextjs', () => ({
  captureRouterTransitionStart: captureRouterTransitionStartMock,
  init: initMock,
  replayIntegration: replayIntegrationMock,
}));

describe('client instrumentation', () => {
  afterEach(() => {
    z.config({ jitless: undefined });
  });

  it('disables Zod JIT for strict CSP and preserves Sentry navigation instrumentation', async () => {
    z.config({ jitless: false });
    vi.resetModules();

    const instrumentation = await import('./instrumentation-client');

    expect(z.config().jitless).toBe(true);
    expect(instrumentation.onRouterTransitionStart).toBe(captureRouterTransitionStartMock);
    expect(replayIntegrationMock).toHaveBeenCalledWith({
      maskAllText: true,
      blockAllMedia: true,
    });
    expect(initMock).toHaveBeenCalledOnce();

    const options = initMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        replaysOnErrorSampleRate: 1,
        integrations: [{ name: 'replay' }],
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );
    expect(
      options.beforeSend({
        request: { url: 'https://ph-os.example/reports?patient_id=phi#detail' },
      }),
    ).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          url: 'https://ph-os.example/reports#detail',
        }),
      }),
    );
  });
});
