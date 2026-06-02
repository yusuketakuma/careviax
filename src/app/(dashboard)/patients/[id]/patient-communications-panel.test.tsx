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

describe('PatientCommunicationsPanel', () => {
  it('renders communication groups with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, error: null };
      }
      return {
        data: {
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
        },
        isLoading: false,
        error: null,
      };
    });

    render(<PatientCommunicationsPanel patientId="patient_1" cases={[]} enabled />);

    expect(screen.getByRole('heading', { level: 2, name: '連絡キュー' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: '運用・請求ステータス' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByText('家族へ連絡')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下書き作成' })).toBeTruthy();
    expect(screen.getByText('折り返し')).toBeTruthy();
  });
});
