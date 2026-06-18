/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setQueryDataMock, useOrgIdMock, useRealtimeQueryMock } = vi.hoisted(() => ({
  setQueryDataMock: vi.fn(),
  useOrgIdMock: vi.fn(),
  useRealtimeQueryMock: vi.fn(),
}));

vi.mock('./use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: setQueryDataMock,
  }),
}));

vi.mock('./use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

import { usePresenceUsers } from './use-presence-users';

describe('usePresenceUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: [
        {
          user_id: 'user_1',
          display_name: '佐藤薬剤師',
          active_field: null,
          updated_at: '2026-06-17T00:00:00.000Z',
        },
      ],
      connected: true,
    });
  });

  it('uses the shared realtime query policy for presence users', () => {
    const { result } = renderHook(() =>
      usePresenceUsers({ entityType: 'patient', entityId: 'patient_1' }),
    );

    expect(result.current.users).toEqual([
      {
        user_id: 'user_1',
        display_name: '佐藤薬剤師',
        active_field: null,
        updated_at: '2026-06-17T00:00:00.000Z',
      },
    ]);
    expect(result.current.queryKey).toEqual(['presence', 'patient', 'patient_1', 'org_1']);
    expect(result.current.enabled).toBe(true);
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        enabled: true,
        invalidateOn: false,
        onRealtimeEvent: expect.any(Function),
        fallbackRefetchInterval: 30_000,
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
      }),
    );
  });

  it('disables the query when org or caller availability is missing', () => {
    useOrgIdMock.mockReturnValue('');
    useRealtimeQueryMock.mockReturnValue({ data: undefined, connected: false });

    const { result } = renderHook(() =>
      usePresenceUsers({ entityType: 'patient', entityId: 'patient_1', enabled: false }),
    );

    expect(result.current.users).toEqual([]);
    expect(result.current.enabled).toBe(false);
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', ''],
        enabled: false,
      }),
    );
  });

  it('patches the presence cache from matching realtime events without refetching', () => {
    renderHook(() => usePresenceUsers({ entityType: 'patient', entityId: 'patient_1' }));

    const options = useRealtimeQueryMock.mock.calls[0]?.[0];
    options.onRealtimeEvent({
      type: 'presence_update',
      entity_type: 'patient',
      entity_id: 'patient_1',
      user_id: 'user_1',
      display_name: '田中',
      active_field: 'note',
      updated_at: '2026-06-18T00:00:00.000Z',
    });

    expect(setQueryDataMock).toHaveBeenCalledWith(
      ['presence', 'patient', 'patient_1', 'org_1'],
      expect.any(Function),
    );
    const updater = setQueryDataMock.mock.calls[0]?.[1] as
      | ((users: Array<{ user_id: string; display_name: string }>) => unknown)
      | undefined;
    expect(
      updater?.([
        {
          user_id: 'user_1',
          display_name: '古い表示名',
        },
      ]),
    ).toEqual([
      {
        user_id: 'user_1',
        display_name: '田中',
        active_field: 'note',
        updated_at: '2026-06-18T00:00:00.000Z',
      },
    ]);
  });

  it('ignores realtime presence updates for other entities', () => {
    renderHook(() => usePresenceUsers({ entityType: 'patient', entityId: 'patient_1' }));

    const options = useRealtimeQueryMock.mock.calls[0]?.[0];
    options.onRealtimeEvent({
      type: 'presence_update',
      entity_type: 'patient',
      entity_id: 'patient_2',
      user_id: 'user_1',
      display_name: '田中',
      active_field: null,
      updated_at: '2026-06-18T00:00:00.000Z',
    });

    expect(setQueryDataMock).not.toHaveBeenCalled();
  });
});
