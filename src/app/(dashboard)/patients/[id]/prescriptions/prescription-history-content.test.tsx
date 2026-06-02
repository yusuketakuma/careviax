// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { PrescriptionHistoryContent } from './prescription-history-content';

setupDomTestEnv();

describe('PrescriptionHistoryContent', () => {
  it('renders prescription dashboard groups as semantic headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: {
            id: 'patient_1',
            name: '山田花子',
            name_kana: 'ヤマダハナコ',
          },
          data: [
            {
              id: 'intake_1',
              cycle_id: 'cycle_1',
              source_type: 'manual',
              prescribed_date: '2026-06-01',
              prescriber_name: '佐藤医師',
              prescriber_institution: '青空クリニック',
              prescription_expiry_date: null,
              original_document_url: null,
              original_collected_at: null,
              original_collected_by: null,
              refill_remaining_count: null,
              refill_next_dispense_date: null,
              split_dispense_total: null,
              split_dispense_current: null,
              split_next_dispense_date: null,
              created_at: '2026-06-01T00:00:00.000Z',
              cycle: { overall_status: 'active' },
              lines: [],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getByRole('heading', { level: 2, name: '処方変更ダッシュボード' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: '調剤方法ワンビュー' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByText('山田花子')).toBeTruthy();
  });
});
