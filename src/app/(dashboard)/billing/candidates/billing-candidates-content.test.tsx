// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { BillingCandidatesContent } from './billing-candidates-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

setupDomTestEnv();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderBillingCandidatesContent() {
  return render(
    <BillingCandidatesContent
      initialBillingMonth="2026-03-01"
      initialPatientId="patient_1"
      initialCandidateId="candidate_target"
      initialWorkflowFrom="visit_record"
      initialVisitRecordId="record_1"
    />,
    { wrapper: createWrapper() },
  );
}

describe('BillingCandidatesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/billing-candidates?')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'candidate_other',
                  patient_id: 'patient_1',
                  patient_name: '山田 太郎',
                  billing_domain: 'home_care',
                  billing_target_type: 'patient',
                  billing_target_id: 'patient_1',
                  billing_target_label: '山田 太郎',
                  billing_month: '2026-03-01T00:00:00.000Z',
                  billing_code: 'OTHER',
                  billing_name: '居宅療養管理指導料',
                  points: 1080,
                  quantity: 1,
                  status: 'candidate',
                  exclusion_reason: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
                  calculation_breakdown: { amount_yen: 1080 },
                  source_snapshot: {
                    billing_scope: 'home_care_ssot',
                    selection_mode: 'auto',
                    validation_layers: {
                      evidence: { label: '証跡', state: 'manual_review', message: '確認待ち' },
                    },
                  },
                  workflow_state: { review_state: 'pending', resolution_state: 'unresolved' },
                },
                {
                  id: 'candidate_target',
                  patient_id: 'patient_1',
                  patient_name: '山田 太郎',
                  billing_domain: 'home_care',
                  billing_target_type: 'patient',
                  billing_target_id: 'patient_1',
                  billing_target_label: '山田 太郎',
                  billing_month: '2026-03-01T00:00:00.000Z',
                  billing_code: 'MED_HOME_VISIT_SINGLE',
                  billing_name: '在宅患者訪問薬剤管理指導料',
                  points: 3240,
                  quantity: 1,
                  status: 'confirmed',
                  exclusion_reason: null,
                  updated_at: '2026-06-18T00:01:00.000Z',
                  calculation_breakdown: { amount_yen: 3240 },
                  source_snapshot: {
                    billing_scope: 'home_care_ssot',
                    selection_mode: 'auto',
                    source_note: '訪問記録から算定候補を作成',
                    validation_layers: {
                      evidence: { label: '証跡', state: 'passed', message: 'OK' },
                    },
                  },
                  workflow_state: { review_state: 'reviewed', resolution_state: 'confirmed' },
                },
              ],
              hasMore: false,
              summary: {
                total: 2,
                pending_review: 1,
                confirmed: 1,
                excluded: 0,
                exported: 0,
                reviewed: 1,
                ready_to_close: 1,
                blocked_from_close: 1,
                blocker_reasons: [],
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/billing-candidates/candidate_other' && init?.method === 'PATCH') {
          return new Response(
            JSON.stringify({
              data: {
                id: 'candidate_other',
                status: 'confirmed',
                updated_at: '2026-06-18T00:02:00.000Z',
              },
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('highlights the candidate opened from a visit record', async () => {
    renderBillingCandidatesContent();

    expect(await screen.findByTestId('billing-target-candidate')).toBeTruthy();
    expect(await screen.findByText('対象候補を選択中')).toBeTruthy();

    expect(screen.getByText('訪問記録から確認中')).toBeTruthy();
    expect(screen.getByText('candidate_target')).toBeTruthy();

    const fetchMock = vi.mocked(fetch);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('billing_month=2026-03-01');
    expect(requestUrl).toContain('patient_id=patient_1');
    expect(requestUrl).toContain('billing_domain=home_care');

    const table = screen.getByRole('table', { name: '月次請求候補一覧' });
    const rows = within(table).getAllByRole('row');
    const targetRow = rows.find((row) => row.textContent?.includes('在宅患者訪問薬剤管理指導料'));
    expect(targetRow?.className).toContain('ring-primary');
  });

  it('sends expected_updated_at when reviewing a billing candidate', async () => {
    renderBillingCandidatesContent();

    const table = await screen.findByRole('table', { name: '月次請求候補一覧' });
    const candidateRow = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('居宅療養管理指導料'));
    if (!candidateRow) throw new Error('candidate row is required');

    fireEvent.click(within(candidateRow).getByRole('button', { name: '確定' }));

    await waitFor(() => {
      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/billing-candidates/candidate_other' && init?.method === 'PATCH',
        );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        action: 'confirm',
        expected_updated_at: '2026-06-18T00:00:00.000Z',
      });
    });
  });
});
