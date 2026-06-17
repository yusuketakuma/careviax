/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useQueryMock, useQueryClientMock, useRealtimeEventsMock, invalidateQueriesMock } =
  vi.hoisted(() => ({
    useQueryMock: vi.fn(),
    useQueryClientMock: vi.fn(),
    useRealtimeEventsMock: vi.fn(),
    invalidateQueriesMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('./use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { useRealtimeQuery } from './use-realtime-query';

describe('useRealtimeQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    useQueryMock.mockImplementation((options) => ({ options }));
    useRealtimeEventsMock.mockReturnValue({ connected: false });
  });

  it('uses fallback polling only while realtime is disconnected', () => {
    renderHook(() =>
      useRealtimeQuery({
        queryKey: ['workflow'],
        queryFn: async () => ({ data: [] }),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 30_000,
      }),
    );

    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ refetchInterval: 30_000 }));
  });

  it('turns fallback polling off while realtime is connected', () => {
    useRealtimeEventsMock.mockReturnValue({ connected: true });

    renderHook(() =>
      useRealtimeQuery({
        queryKey: ['workflow'],
        queryFn: async () => ({ data: [] }),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 30_000,
      }),
    );

    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ refetchInterval: false }));
  });

  it('does not subscribe to realtime when the query is disabled', () => {
    renderHook(() =>
      useRealtimeQuery({
        queryKey: ['workflow'],
        queryFn: async () => ({ data: [] }),
        enabled: false,
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 30_000,
      }),
    );

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('invalidates matching realtime events', () => {
    renderHook(() =>
      useRealtimeQuery({
        queryKey: ['workflow'],
        queryFn: async () => ({ data: [] }),
        invalidateOn: ['workflow_refresh'],
      }),
    );

    const realtimeOptions = useRealtimeEventsMock.mock.calls[0]?.[0];
    realtimeOptions.onEvent({ type: 'workflow_refresh' });
    realtimeOptions.onEvent({ type: 'unrelated' });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workflow'] });
  });
});
