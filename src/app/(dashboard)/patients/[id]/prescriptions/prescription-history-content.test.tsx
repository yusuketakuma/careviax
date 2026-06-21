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

  it('uses 6-axis state tokens for change-type badges (added=info, changed=confirm)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const line = (id: string, drug: string, dose: string) => ({
      id,
      drug_name: drug,
      dose,
      frequency: '1日1回',
      days: 14,
      quantity: 14,
      unit: '錠',
      route: 'internal',
    });
    const intake = (id: string, date: string, lines: ReturnType<typeof line>[]) => ({
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
      cycle: { overall_status: 'active' },
      lines,
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            // 新しい処方: アムロジピンは用量変更、ロスバスタチンは新規。
            intake('intake_new', '2026-06-02', [
              line('l_amlo_new', 'アムロジピン', '10mg'),
              line('l_rosu', 'ロスバスタチン', '2.5mg'),
            ]),
            intake('intake_old', '2026-06-01', [line('l_amlo_old', 'アムロジピン', '5mg')]),
          ],
        },
        isLoading: false,
      };
    });

    const { container } = render(<PrescriptionHistoryContent />);
    const html = container.innerHTML;

    // 変更種別が実際に描画されていること（diff パスが発火している保証）。
    expect(screen.getAllByText('新規').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('用量変更').length).toBeGreaterThanOrEqual(1);

    // 新規=tag-info / 用量変更=state-confirm の 6軸トークンへ集約されていること。
    expect(html).toContain('text-tag-info');
    expect(html).toContain('text-state-confirm');

    // 回帰: 旧 ad-hoc な変更種別パレット + 装飾 slate/sky(S4) が残っていないこと。
    expect(html).not.toMatch(
      /bg-green-100|bg-orange-100|bg-green-50|bg-orange-50|text-emerald-700|text-orange-700|border-slate-200|bg-slate-50|text-slate-700|text-sky-700/,
    );
  });

  it('uses neutral/blocked tokens for Do and warning badges (no ad-hoc gray/red)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    // 一包化不適応(OD錠)の同一処方を2回 → 新しい方は Do、一包化警告も発火。
    const odLine = {
      id: 'l_od',
      drug_name: 'ランソプラゾールOD錠',
      dose: '15mg',
      frequency: '1日1回',
      days: 14,
      quantity: 14,
      unit: '錠',
      route: 'internal',
      dispensing_method: 'unit_dose',
    };
    const intake = (id: string, date: string) => ({
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
      cycle: { overall_status: 'active' },
      lines: [{ ...odLine, id: `${odLine.id}_${id}` }],
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [intake('new', '2026-06-02'), intake('old', '2026-06-01')],
        },
        isLoading: false,
      };
    });

    const { container } = render(<PrescriptionHistoryContent />);
    const html = container.innerHTML;

    // Do バッジは neutral(muted)、警告統計は blocked トークンへ。
    expect(screen.getAllByText('Do').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/警告/)).toBeTruthy();
    expect(html).toContain('text-muted-foreground');
    expect(html).toContain('text-state-blocked');

    // 回帰: Do の旧 gray、警告の旧 red-200 が残っていないこと。
    expect(html).not.toMatch(/bg-gray-200|bg-red-200/);
  });

  it('renders the 後発 (generic) badge without state color (classification value)', () => {
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
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            {
              id: 'intake_generic',
              cycle_id: 'cycle_generic',
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
                  id: 'l_generic',
                  drug_name: 'アムロジピン',
                  dose: '5mg',
                  frequency: '1日1回',
                  days: 14,
                  quantity: 14,
                  unit: '錠',
                  route: 'internal',
                  is_generic: true,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    // 後発は分類値 → 状態色なし(青を付けない)。枠線のみ/muted。
    const badge = screen.getByText('後発');
    expect(badge.className).not.toMatch(/text-blue-600|border-blue-300/);
    expect(badge.className).toContain('text-muted-foreground');
  });
});
