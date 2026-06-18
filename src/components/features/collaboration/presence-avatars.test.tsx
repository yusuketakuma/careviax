// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());
const usePresenceHeartbeatMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

vi.mock('@/lib/hooks/use-presence-heartbeat', () => ({
  usePresenceHeartbeat: usePresenceHeartbeatMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

import { PresenceAvatars } from './presence-avatars';

setupDomTestEnv();

describe('PresenceAvatars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeEventsMock.mockReturnValue({ connected: true });
    usePresenceHeartbeatMock.mockReturnValue(undefined);
    useQueryMock.mockReturnValue({
      data: [
        {
          user_id: 'user_1',
          display_name: '佐藤薬剤師',
          active_field: null,
          updated_at: '2026-06-17T00:00:00.000Z',
        },
      ],
    });
  });

  it('uses the shared presence stream and disables fallback polling while connected', () => {
    render(<PresenceAvatars entityType="patient" entityId="patient_1" />);

    expect(screen.getByLabelText('佐藤薬剤師')).toBeTruthy();
    expect(useRealtimeEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
      }),
    );
    expect(usePresenceHeartbeatMock).toHaveBeenCalledWith({
      entityType: 'patient',
      entityId: 'patient_1',
      enabled: true,
    });
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        refetchInterval: false,
        enabled: true,
      }),
    );
  });

  it('keeps low-frequency presence polling while the shared stream is disconnected', () => {
    useRealtimeEventsMock.mockReturnValue({ connected: false });

    render(<PresenceAvatars entityType="patient" entityId="patient_1" />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        refetchInterval: 30_000,
        enabled: true,
      }),
    );
  });
});
