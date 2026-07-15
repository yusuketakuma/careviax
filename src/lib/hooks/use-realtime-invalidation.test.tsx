/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useQueryClientMock, useRealtimeEventsMock, invalidateQueriesMock, refetchQueriesMock } =
  vi.hoisted(() => ({
    useQueryClientMock: vi.fn(),
    useRealtimeEventsMock: vi.fn(),
    invalidateQueriesMock: vi.fn(),
    refetchQueriesMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: useQueryClientMock };
});

vi.mock('./use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { useRealtimeInvalidation } from './use-realtime-invalidation';

describe('useRealtimeInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({
      invalidateQueries: invalidateQueriesMock,
      refetchQueries: refetchQueriesMock,
    });
    useRealtimeEventsMock.mockReturnValue({ connected: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invalidates the query for matching realtime events', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['prescription-intakes', 'org_1'],
        invalidateOn: ['prescription_intake_created'],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      realtimeOptions.onEvent({ type: 'workflow_refresh' });
      realtimeOptions.onEvent({ type: 'prescription_intake_created' });
      vi.advanceTimersByTime(150);
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.receivesRealtimeUpdates).toBe(true);
    expect(realtimeOptions.requiredChannels).toEqual(['org']);
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['prescription-intakes', 'org_1'],
    });
  });

  it('does not invalidate by default when no invalidation policy is supplied', () => {
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['workflow'],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];

    expect(realtimeOptions.enabled).toBe(false);
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('requires an explicit all policy for all-event invalidation', () => {
    vi.useFakeTimers();
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['workflow'],
        invalidateOn: 'all',
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      realtimeOptions.onEvent({ type: 'unrelated' });
      vi.advanceTimersByTime(150);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workflow'] });
  });

  it('debounces realtime invalidation bursts into one query invalidation', () => {
    vi.useFakeTimers();
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['workflow'],
        invalidateOn: ['workflow_refresh'],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      realtimeOptions.onEvent({ type: 'workflow_refresh' });
      realtimeOptions.onEvent({ type: 'workflow_refresh' });
      realtimeOptions.onEvent({ type: 'workflow_refresh' });
      vi.advanceTimersByTime(149);
    });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workflow'] });
  });

  it('invalidates old and new query keys when the key and policy change during debounce', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ orgId, source }) =>
        useRealtimeInvalidation({
          queryKey: ['workflow', orgId],
          invalidateOn: [{ type: 'workflow_refresh', source }],
        }),
      { initialProps: { orgId: 'org_1', source: 'dashboard_org_1' } },
    );

    const orgOneRealtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      orgOneRealtimeOptions.onEvent({
        type: 'workflow_refresh',
        source: 'dashboard_org_1',
      });
    });

    rerender({ orgId: 'org_2', source: 'dashboard_org_2' });
    const latestCallIndex = useRealtimeEventsMock.mock.calls.length - 1;
    const orgTwoRealtimeOptions = useRealtimeEventsMock.mock.calls[latestCallIndex]?.[0];
    act(() => {
      orgTwoRealtimeOptions.onEvent({
        type: 'workflow_refresh',
        source: 'dashboard_org_1',
      });
      orgTwoRealtimeOptions.onEvent({
        type: 'workflow_refresh',
        source: 'dashboard_org_2',
      });
      vi.advanceTimersByTime(150);
    });

    expect(invalidateQueriesMock.mock.calls).toEqual([
      [{ queryKey: ['workflow', 'org_1'] }],
      [{ queryKey: ['workflow', 'org_2'] }],
    ]);
  });

  it('deduplicates equivalent object query keys regardless of property insertion order', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ filters }) =>
        useRealtimeInvalidation({
          queryKey: ['workflow', filters],
          invalidateOn: ['workflow_refresh'],
        }),
      { initialProps: { filters: { orgId: 'org_1', status: 'open' } } },
    );

    const firstRealtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      firstRealtimeOptions.onEvent({ type: 'workflow_refresh' });
    });

    rerender({ filters: { status: 'open', orgId: 'org_1' } });
    const latestCallIndex = useRealtimeEventsMock.mock.calls.length - 1;
    const latestRealtimeOptions = useRealtimeEventsMock.mock.calls[latestCallIndex]?.[0];
    act(() => {
      latestRealtimeOptions.onEvent({ type: 'workflow_refresh' });
      vi.advanceTimersByTime(150);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['workflow', { orgId: 'org_1', status: 'open' }],
    });
  });

  it('clears pending invalidations when the hook unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['workflow'],
        invalidateOn: ['workflow_refresh'],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      realtimeOptions.onEvent({ type: 'workflow_refresh' });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('can scope invalidation by event source', () => {
    vi.useFakeTimers();
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['dashboard-summary'],
        invalidateOn: [{ type: 'workflow_refresh', source: ['dashboard', 'reports'] }],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    act(() => {
      realtimeOptions.onEvent({ type: 'workflow_refresh', source: 'patients_board' });
      realtimeOptions.onEvent({ type: 'workflow_refresh', source: 'dashboard' });
      vi.advanceTimersByTime(150);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['dashboard-summary'] });
  });

  it('can receive realtime events without invalidating the query', () => {
    const onRealtimeEvent = vi.fn();

    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['notifications', 'inbox', 'org_1'],
        invalidateOn: false,
        onRealtimeEvent,
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    realtimeOptions.onEvent({ type: 'notification', id: 'notification_1' });

    expect(onRealtimeEvent).toHaveBeenCalledWith({
      type: 'notification',
      id: 'notification_1',
    });
    expect(realtimeOptions.requiredChannels).toEqual(['user']);
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('forwards presence targets to the shared realtime stream', () => {
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
      }),
    );

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
        requiredChannels: ['presence'],
      }),
    );
  });

  it('requires org and presence readiness when both invalidation and presence are active', () => {
    renderHook(() =>
      useRealtimeInvalidation({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        invalidateOn: ['presence_update'],
        onRealtimeEvent: vi.fn(),
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
      }),
    );

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ requiredChannels: ['org', 'presence'] }),
    );
  });

  it('refetches an active query once when readiness recovers after being ready', () => {
    let connected = false;
    useRealtimeEventsMock.mockImplementation(() => ({ connected }));
    const { rerender } = renderHook(
      ({ revision }) => {
        void revision;
        return useRealtimeInvalidation({
          queryKey: ['workflow', 'org_1'],
          invalidateOn: ['workflow_refresh'],
        });
      },
      { initialProps: { revision: 0 } },
    );

    act(() => {
      connected = true;
      rerender({ revision: 1 });
    });
    expect(refetchQueriesMock).not.toHaveBeenCalled();

    act(() => {
      connected = false;
      rerender({ revision: 2 });
    });
    act(() => {
      connected = true;
      rerender({ revision: 3 });
    });

    expect(refetchQueriesMock).toHaveBeenCalledTimes(1);
    expect(refetchQueriesMock).toHaveBeenCalledWith({
      queryKey: ['workflow', 'org_1'],
      type: 'active',
    });
  });

  it('does not carry readiness history across query keys', () => {
    let connected = true;
    useRealtimeEventsMock.mockImplementation(() => ({ connected }));
    const { rerender } = renderHook(
      ({ orgId }) =>
        useRealtimeInvalidation({
          queryKey: ['workflow', orgId],
          invalidateOn: ['workflow_refresh'],
        }),
      { initialProps: { orgId: 'org_1' } },
    );

    act(() => {
      connected = false;
      rerender({ orgId: 'org_1' });
    });
    rerender({ orgId: 'org_2' });
    act(() => {
      connected = true;
      rerender({ orgId: 'org_2' });
    });

    expect(refetchQueriesMock).not.toHaveBeenCalled();
  });
});
