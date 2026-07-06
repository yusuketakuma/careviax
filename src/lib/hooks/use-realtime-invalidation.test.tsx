/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useQueryClientMock, useRealtimeEventsMock, invalidateQueriesMock } = vi.hoisted(() => ({
  useQueryClientMock: vi.fn(),
  useRealtimeEventsMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: useQueryClientMock,
}));

vi.mock('./use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { useRealtimeInvalidation } from './use-realtime-invalidation';

describe('useRealtimeInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
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
      }),
    );
  });
});
