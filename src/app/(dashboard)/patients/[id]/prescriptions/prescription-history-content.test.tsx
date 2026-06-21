// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders prescription intake card toggles as native buttons without PHI in the name', () => {
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
              lines: [
                {
                  id: 'line_1',
                  drug_name: 'アムロジピン',
                  dose: '5mg',
                  frequency: '1日1回',
                  days: 14,
                  quantity: 14,
                  unit: '錠',
                  route: 'internal',
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    const toggle = screen.getByRole('button', { name: '2026年6月1日 の処方履歴を閉じる' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-label')).not.toContain('山田花子');
    expect(toggle.getAttribute('aria-label')).not.toContain('アムロジピン');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);

    const collapsedToggle = screen.getByRole('button', {
      name: '2026年6月1日 の処方履歴を開く',
    });
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('drives cycle-status badge color from the SSOT role (on_hold=confirm, cancelled=blocked)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const intake = (id: string, date: string, status: string) => ({
      id,
      cycle_id: `cycle_${id}`,
      source_type: 'manual',
      prescribed_date: date,
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
      created_at: `${date}T00:00:00.000Z`,
      cycle: { overall_status: status },
      lines: [],
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            intake('intake_hold', '2026-06-02', 'on_hold'),
            intake('intake_cancel', '2026-06-01', 'cancelled'),
          ],
        },
        isLoading: false,
      };
    });

    const { container } = render(<PrescriptionHistoryContent />);

    // 保留=confirm(橙) / 取消=blocked(赤) が SSOT どおり別 role になること（旧実装は両方 destructive 同色）。
    const confirmBadges = Array.from(container.querySelectorAll('[data-role="confirm"]'));
    const blockedBadges = Array.from(container.querySelectorAll('[data-role="blocked"]'));
    expect(confirmBadges.some((el) => el.textContent?.includes('保留'))).toBe(true);
    expect(blockedBadges.some((el) => el.textContent?.includes('取消'))).toBe(true);
    // 回帰: 取消が confirm 側に混ざらない（=保留と同色化していない）こと。
    expect(confirmBadges.some((el) => el.textContent?.includes('取消'))).toBe(false);
  });
});
