// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postPresenceUpdate } from '@/lib/collaboration/presence-api-client';
import { usePresenceHeartbeat } from './use-presence-heartbeat';

const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('./use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

describe('postPresenceUpdate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useOrgIdMock.mockReturnValue('org_1');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('posts a presence update with the shared request shape', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    await postPresenceUpdate({
      orgId: 'org_1',
      entityType: 'patient',
      entityId: 'patient_1',
      activeField: 'card',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({
        entity_type: 'patient',
        entity_id: 'patient_1',
        active_field: 'card',
      }),
    });
  });

  it('keeps presence updates best-effort on network failure', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;

    await expect(
      postPresenceUpdate({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('posts immediately, repeats on the heartbeat interval, and clears timers on unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    const { unmount } = renderHook(() =>
      usePresenceHeartbeat({
        entityType: 'patient',
        entityId: 'patient_1',
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not post when disabled or when org/entity identity is missing', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    renderHook(() =>
      usePresenceHeartbeat({
        entityType: 'patient',
        entityId: 'patient_1',
        enabled: false,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    useOrgIdMock.mockReturnValue('');
    renderHook(() =>
      usePresenceHeartbeat({
        entityType: 'patient',
        entityId: 'patient_1',
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    useOrgIdMock.mockReturnValue('org_1');
    renderHook(() =>
      usePresenceHeartbeat({
        entityType: 'patient',
        entityId: '',
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects a delayed initial heartbeat without adding a duplicate immediate post', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    renderHook(() =>
      usePresenceHeartbeat({
        entityType: 'patient',
        entityId: 'patient_1',
        initialDelayMs: 5_000,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
