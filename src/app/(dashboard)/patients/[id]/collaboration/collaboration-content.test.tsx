// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const usePresenceHeartbeatMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-presence-heartbeat', () => ({
  usePresenceHeartbeat: usePresenceHeartbeatMock,
}));

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@/components/features/comments/comment-thread', () => ({
  CommentThread: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="mock-comment-thread">{`${entityType}:${entityId}`}</div>
  ),
}));

vi.mock('@/components/features/workflow/workflow-back-link', () => ({
  WorkflowBackLink: ({ label }: { label: string }) => <span>{label}</span>,
}));

import { CollaborationContent } from './collaboration-content';

setupDomTestEnv();

function mockLoadedQueries() {
  useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const [scope] = options.queryKey;
    if (scope === 'presence') {
      return {
        data: [
          {
            user_id: 'user_2',
            display_name: '佐藤薬剤師',
            active_field: 'report',
            updated_at: '2026-06-17T00:00:00.000Z',
          },
        ],
      };
    }

    if (scope === 'patient-overview') {
      return {
        data: { name: '田中 一郎' },
        isError: false,
        isLoading: false,
      };
    }

    throw new Error(`Unexpected query key: ${JSON.stringify(options.queryKey)}`);
  });
}

describe('CollaborationContent realtime presence policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useAuthStoreMock.mockImplementation(
      (selector: (state: { currentUser: { id: string } }) => unknown) =>
        selector({ currentUser: { id: 'user_1' } }),
    );
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    useRealtimeEventsMock.mockReturnValue({ connected: true });
    mockLoadedQueries();
  });

  it('subscribes to the patient presence stream and pauses fallback polling while connected', () => {
    render(<CollaborationContent patientId="patient_1" />);

    expect(screen.getByTestId('mock-comment-thread').textContent).toBe('patient:patient_1');
    expect(usePresenceHeartbeatMock).toHaveBeenCalledWith({
      entityType: 'patient',
      entityId: 'patient_1',
      activeField: 'collaboration',
    });
    expect(useRealtimeEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        refetchInterval: false,
        enabled: true,
      }),
    );
  });

  it('keeps low-frequency fallback polling while the shared stream is disconnected', () => {
    useRealtimeEventsMock.mockReturnValue({ connected: false });

    render(<CollaborationContent patientId="patient_1" />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['presence', 'patient', 'patient_1', 'org_1'],
        refetchInterval: 30_000,
        enabled: true,
      }),
    );
  });
});
