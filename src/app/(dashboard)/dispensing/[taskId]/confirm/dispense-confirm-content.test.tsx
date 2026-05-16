// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DispenseConfirmContent } from './dispense-confirm-content';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

setupDomTestEnv();

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <DispenseConfirmContent />
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

function mockDispenseTask() {
  return {
    id: 'task_1',
    priority: 'normal',
    status: 'ready',
    cycle_id: 'cycle_1',
    cycle: {
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_: {
        patient: {
          id: 'patient_1',
          name: '安全 太郎',
          name_kana: 'アンゼン タロウ',
        },
      },
      prescription_intakes: [
        {
          id: 'intake_1',
          prescribed_date: '2026-05-12T00:00:00.000Z',
          prescriber_name: '確認 医師',
          prescriber_institution: '確認クリニック',
          lines: [
            {
              id: 'line_1',
              line_number: 1,
              drug_name: 'アムロジピン錠5mg',
              drug_code: 'drug_1',
              dosage_form: 'tablet',
              dose: '1錠',
              frequency: '朝食後',
              days: 14,
              quantity: 14,
              unit: '錠',
              packaging_instructions: null,
              notes: null,
            },
          ],
        },
      ],
    },
    results: [
      {
        id: 'result_1',
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン錠5mg',
        actual_drug_code: 'drug_1',
        actual_quantity: 14,
        actual_unit: '錠',
        discrepancy_reason: null,
        carry_type: 'carry',
        special_notes: null,
        dispensed_at: '2026-05-12T00:00:00.000Z',
      },
    ],
  };
}

describe('DispenseConfirmContent safety checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ taskId: 'task_1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks completion until required checks are confirmed and posts safety checklist evidence', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      requests.push({ url: requestUrl, init });

      if (requestUrl === '/api/dispense-tasks/task_1') {
        return new Response(JSON.stringify(mockDispenseTask()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (requestUrl === '/api/cds/check') {
        return new Response(JSON.stringify({ alerts: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (requestUrl === '/api/dispense-results') {
        return new Response(JSON.stringify({ data: { id: 'dispense_result_1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient();

    expect(await screen.findByText('安全 太郎 様')).toBeTruthy();

    const submitButton = screen.getByRole('button', { name: '調剤完了' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(screen.getByText('残り 6 件の必須項目が未確認です')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /患者氏名が正しいこと/ }));
    fireEvent.click(screen.getByRole('button', { name: /全薬剤の名称・規格/ }));
    fireEvent.click(screen.getByRole('button', { name: /数量・日数/ }));
    fireEvent.click(screen.getByRole('button', { name: /用法が正しく/ }));
    fireEvent.click(screen.getByRole('button', { name: /包装指示/ }));
    fireEvent.click(screen.getByRole('button', { name: /処方安全アラートを確認/ }));

    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dispense-results',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const dispenseRequest = requests.find((request) => request.url === '/api/dispense-results');
    expect(dispenseRequest).toBeTruthy();
    expect(JSON.parse(String(dispenseRequest?.init?.body))).toEqual({
      task_id: 'task_1',
      lines: [
        {
          line_id: 'line_1',
          actual_drug_name: 'アムロジピン錠5mg',
          actual_drug_code: 'drug_1',
          actual_quantity: 14,
          actual_unit: '錠',
          carry_type: 'carry',
        },
      ],
      safety_checklist: DISPENSE_SAFETY_CHECKLIST_ACK,
    });
    expect(routerPushMock).toHaveBeenCalledWith('/dispensing');
  });
});
