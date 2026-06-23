// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('./patient-contacts-panel', () => ({
  PatientContactsPanel: () => <div data-testid="contacts-panel" />,
}));

vi.mock('./patient-care-team-panel', () => ({
  PatientCareTeamPanel: () => <div data-testid="care-team-panel" />,
}));

vi.mock('./patient-mcs-link-card', () => ({
  PatientMcsLinkCard: () => <div data-testid="mcs-link-card" />,
}));

import { PatientCommunicationsPanel } from './patient-communications-panel';

setupDomTestEnv();

const communicationsData = {
  communication_queue: {
    summary: {
      pending_count: 1,
      overdue_count: 0,
      self_reports: 0,
      callback_followups: 0,
      open_requests: 0,
      delivery_backlog: 0,
      expiring_external_shares: 0,
      unconfirmed_count: 0,
      reply_waiting_count: 0,
      failed_count: 0,
    },
    items: [
      {
        id: 'queue_1',
        queue_type: 'phone',
        title: '家族へ連絡',
        summary: '訪問時間確認',
        channel: 'phone',
        status: 'pending',
        priority: 'urgent',
        patient_name: '山田花子',
        due_at: null,
        action_href: '/communications/queue_1',
        action_label: '確認',
      },
    ],
    emergency_drafts: [
      {
        id: 'draft_1',
        patient_id: 'patient_1',
        template_key: 'emergency',
        request_type: 'emergency_contact',
        target_name: '佐藤医師',
        target_role: '医師',
        title: '緊急連絡',
        summary: '疼痛増悪',
        subject: '緊急連絡',
        content: '疼痛増悪の相談',
        action_href: '/communications/new',
        action_label: '作成',
      },
    ],
  },
  open_tasks: [
    {
      id: 'task_1',
      task_type: 'call',
      title: '折り返し',
      description: '家族へ再架電',
      status: 'open',
      priority: 'normal',
      due_date: null,
      sla_due_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
    },
  ],
  medication_issues: [],
  billing_summary: {
    claimable_count: 1,
    blocked_count: 0,
    evidence: [],
    candidates: [],
  },
};

function mockQueriesWithData() {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'patient-contacts') {
      return { data: { data: [] }, isLoading: false, error: null };
    }
    return { data: communicationsData, isLoading: false, error: null };
  });
}

describe('PatientCommunicationsPanel', () => {
  it('renders communication groups with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockQueriesWithData();

    render(<PatientCommunicationsPanel patientId="patient_1" cases={[]} enabled />);

    expect(screen.getByRole('heading', { level: 2, name: '連絡キュー' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: '運用・請求ステータス' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByText('家族へ連絡')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下書き作成' })).toBeTruthy();
    expect(screen.getByText('折り返し')).toBeTruthy();
  });

  it.each([
    ['patient-contacts', 'contacts'],
    ['patient-communications', 'communications'],
  ])(
    'builds the %s fetch URL with an encoded hostile patientId and org header',
    async (queryKeyHead, segment) => {
      const hostileId = 'pt/1?x=y#z';
      useOrgIdMock.mockReturnValue('org_1');
      useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
      useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

      const captured = new Map<string, { queryKey: unknown[]; queryFn: () => Promise<unknown> }>();
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured.set(String(config.queryKey[0]), config);
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientCommunicationsPanel patientId={hostileId} cases={[]} enabled />);

        const config = captured.get(queryKeyHead);
        // raw patientId stays in the cache key.
        expect(config?.queryKey).toEqual([queryKeyHead, hostileId, 'org_1']);

        await config?.queryFn();

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/${segment}`);
        expect(url).not.toContain('?x=y');
        expect(url).not.toContain('#z');
        expect(url).not.toContain('%25');
        expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it.each([
    ['patient-contacts', '.'],
    ['patient-contacts', '..'],
    ['patient-communications', '.'],
    ['patient-communications', '..'],
  ])(
    'fails closed without fetching for %s with exact dot-segment patientId %p',
    async (queryKeyHead, dotId) => {
      useOrgIdMock.mockReturnValue('org_1');
      useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
      useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

      const captured = new Map<string, { queryKey: unknown[]; queryFn: () => Promise<unknown> }>();
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured.set(String(config.queryKey[0]), config);
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientCommunicationsPanel patientId={dotId} cases={[]} enabled />);
        await expect(captured.get(queryKeyHead)?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it('posts the emergency draft to the static endpoint with org JSON headers and a raw patient_id payload', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    mockQueriesWithData();

    let mutationConfig: { mutationFn: (draft: unknown) => Promise<unknown> } | undefined;
    useMutationMock.mockImplementation(
      (config: { mutationFn: (draft: unknown) => Promise<unknown> }) => {
        mutationConfig = config;
        return { mutate: vi.fn(), isPending: false };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientCommunicationsPanel patientId="patient_1" cases={[]} enabled />);

      const draft = {
        patient_id: 'patient_42',
        request_type: 'emergency_contact',
        template_key: 'emergency',
        target_name: '佐藤医師',
        target_role: '医師',
        subject: '緊急連絡',
        content: '疼痛増悪の相談',
      };
      await mutationConfig?.mutationFn(draft);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // static collection endpoint - no dynamic path segment to encode.
      expect(url).toBe('/api/communication-requests');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-org-id']).toBe('org_1');
      // raw patient_id from the draft is preserved verbatim in the payload.
      const body = JSON.parse(init.body as string);
      expect(body.patient_id).toBe('patient_42');
      expect(body.related_entity_id).toBe('patient_42');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
