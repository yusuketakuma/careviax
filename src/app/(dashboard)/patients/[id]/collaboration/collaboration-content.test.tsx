// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientHref } from '@/lib/patient/navigation';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const usePresenceHeartbeatMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

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
  WorkflowBackLink: ({ href, label }: { href: string; label: string }) => (
    <a href={href}>{label}</a>
  ),
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
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    vi.mocked(buildPatientHref).mockImplementation((patientId, suffix = '') => {
      if (patientId === '.' || patientId === '..') {
        throw new RangeError('Patient id cannot be a dot segment');
      }
      return `/patients/${encodeURIComponent(patientId)}${suffix}`;
    });
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

  it('encodes the patient overview URL, preserves the raw query key, and uses org headers', async () => {
    const hostilePatientId = 'patient/1?tab=overview#frag';
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);

    const queryConfigs: Array<{ queryKey?: unknown[]; queryFn?: () => Promise<unknown> }> = [];
    let refreshMutationFn: (() => Promise<void>) | undefined;
    useQueryMock.mockImplementation(
      (options: { queryKey?: unknown[]; queryFn?: () => Promise<unknown> }) => {
        queryConfigs.push(options);
        const [scope] = options.queryKey ?? [];
        if (scope === 'presence') {
          return {
            data: [],
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
      },
    );
    useMutationMock.mockImplementation((options: { mutationFn?: () => Promise<void> }) => {
      refreshMutationFn = options.mutationFn;
      return { isPending: false, mutate: vi.fn() };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: '田中 一郎' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CollaborationContent patientId={hostilePatientId} />);

      const overviewConfig = queryConfigs.find(
        (config) => config.queryKey?.[0] === 'patient-overview',
      );
      expect(overviewConfig?.queryKey).toEqual(['patient-overview', hostilePatientId, 'org_1']);
      expect(overviewConfig?.queryFn).toBeTypeOf('function');
      expect(
        queryConfigs.some(
          (config) =>
            JSON.stringify(config.queryKey) ===
            JSON.stringify(['presence', 'patient', hostilePatientId, 'org_1']),
        ),
      ).toBe(true);
      expect(usePresenceHeartbeatMock).toHaveBeenCalledWith({
        entityType: 'patient',
        entityId: hostilePatientId,
        activeField: 'collaboration',
      });
      expect(screen.getByTestId('mock-comment-thread').textContent).toBe(
        `patient:${hostilePatientId}`,
      );

      await overviewConfig?.queryFn?.();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/patients/${encodeURIComponent(hostilePatientId)}/overview`,
        { headers: sentinelHeaders },
      );
      expect(fetchMock.mock.calls[0]?.[0]).not.toContain('/api/patients/patient/1?tab=');
      expect(fetchMock.mock.calls[0]?.[0]).not.toContain('%25');
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      await refreshMutationFn?.();
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ['presence', 'patient', hostilePatientId, 'org_1'],
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ['patient-overview', hostilePatientId, 'org_1'],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the workflow back link through buildPatientHref', () => {
    const hostilePatientId = 'patient/1?tab=overview#frag';

    render(<CollaborationContent patientId={hostilePatientId} />);

    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(hostilePatientId);
    const backLink = screen.getByRole('link', { name: 'カードへ戻る' });
    expect(backLink.getAttribute('href')).toBe(`/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(backLink.getAttribute('href')).not.toContain('?tab=overview');
    expect(backLink.getAttribute('href')).not.toContain('#frag');
    expect(backLink.getAttribute('href')).not.toContain('%25');
  });

  it.each(['.', '..'])(
    'rejects dot-segment patient ids before fetching overview: %s',
    async (patientId) => {
      const queryConfigs: Array<{ queryKey?: unknown[]; queryFn?: () => Promise<unknown> }> = [];
      useQueryMock.mockImplementation(
        (options: { queryKey?: unknown[]; queryFn?: () => Promise<unknown> }) => {
          queryConfigs.push(options);
          const [scope] = options.queryKey ?? [];
          if (scope === 'presence') {
            return {
              data: [],
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
        },
      );
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      vi.mocked(buildPatientHref).mockReturnValue('/patients/dot-sentinel');

      try {
        render(<CollaborationContent patientId={patientId} />);

        const overviewConfig = queryConfigs.find(
          (config) => config.queryKey?.[0] === 'patient-overview',
        );
        await expect(overviewConfig?.queryFn?.()).rejects.toThrow(
          'Path segment cannot be a dot segment',
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(['.', '..'])(
    'rejects dot-segment patient ids for the workflow back link: %s',
    (patientId) => {
      expect(() => render(<CollaborationContent patientId={patientId} />)).toThrow(
        'Patient id cannot be a dot segment',
      );
    },
  );
});
