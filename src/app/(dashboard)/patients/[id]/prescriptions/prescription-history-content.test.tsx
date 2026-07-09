// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { PrescriptionDiffReview } from '@/lib/prescriptions/diff-review-contract';

const useMutationMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

// Actual-backed spies so URL/header teeth prove helper adoption via return-value identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

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

import { toast } from 'sonner';

vi.mock('@/components/features/pharmacy/drug-suggest', () => ({
  DrugSuggest: ({
    value,
    ariaLabel,
    onTextChange,
    onSelect,
  }: {
    value: string;
    ariaLabel?: string;
    onTextChange: (text: string) => void;
    onSelect: (drug: {
      drug_master_id: string;
      drug_name: string;
      drug_code: string;
      dosage_form: string | null;
      unit: string | null;
      is_generic: boolean;
      is_narcotic: boolean;
      is_psychotropic: boolean;
      max_administration_days: number | null;
      drug_price: number | null;
    }) => void;
  }) => (
    <div data-testid="history-drug-suggest">
      <input
        aria-label={ariaLabel ?? '医薬品マスター候補'}
        value={value}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
      <button
        type="button"
        onClick={() =>
          onSelect({
            drug_master_id: 'drug_master_selected',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2171013F1024',
            dosage_form: '錠',
            unit: '錠',
            is_generic: false,
            is_narcotic: false,
            is_psychotropic: false,
            max_administration_days: null,
            drug_price: 12.3,
          })
        }
      >
        履歴薬剤候補を選択
      </button>
    </div>
  ),
}));

import { PrescriptionHistoryContent } from './prescription-history-content';

setupDomTestEnv();

describe('PrescriptionHistoryContent', () => {
  it('shows a prescription-history skeleton instead of a generic spinner while loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: undefined,
        isLoading: true,
        isError: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getByRole('status', { name: '処方履歴を読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('山田花子')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '処方変更ダッシュボード' })).toBeNull();
  });

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

  it('places the prescription history (primary) above the auxiliary summary cards in DOM order', () => {
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

    // 履歴ゾーン(剤形フィルタ)が補助の処方変更ダッシュボードより前。CSS order ではなく DOM 順で担保。
    const historyFilter = screen.getByLabelText('剤形フィルタ');
    const auxDashboard = screen.getByRole('heading', { level: 2, name: '処方変更ダッシュボード' });
    expect(
      Boolean(
        historyFilter.compareDocumentPosition(auxDashboard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it('surfaces drug-master fetch failure as a non-blocking notice with retry (no false-empty)', () => {
    const refetchMaster = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: undefined, isError: true, isLoading: false, refetch: refetchMaster };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
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
                  drug_code: 'YJ1234567890',
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

    // 取得失敗を空表示に潰さず、エンリッチ欠落の可能性を明示し再試行できる(履歴本体は描画継続)。
    const notice = screen.getByTestId('drug-master-error-notice');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('薬剤マスタを取得できませんでした');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMaster).toHaveBeenCalledTimes(1);
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

  it('shows drug names and human-readable codes in diff review rows', () => {
    const diffReview = {
      rows: [
        {
          key: 'row_amlo',
          drug_name: 'アムロジピン錠5mg',
          current_drug_master_id: 'drug_master_new',
          current_drug_code: 'YJ_NEW',
          previous_drug_master_id: 'drug_master_old',
          previous_drug_code: 'YJ_OLD',
          change_type: 'changed',
          change_label: '変更',
          previous_label: '5mg 朝食後 28日',
          current_label: '10mg 朝食後 28日',
          pharmacist_memo: null,
        },
        {
          key: 'row_rosu',
          drug_name: 'ロスバスタチン錠2.5mg',
          current_drug_master_id: 'drug_master_rosu',
          current_drug_code: 'YJ_ROSU',
          previous_drug_master_id: null,
          previous_drug_code: null,
          change_type: 'added',
          change_label: '追加',
          previous_label: 'なし',
          current_label: '2.5mg 夕食後 28日',
          pharmacist_memo: '眠前へ変更予定',
        },
      ],
      set_impacts: [],
      patient_checks: [],
      change_count: 2,
    } satisfies PrescriptionDiffReview;

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
          data: [],
          diff_review: diffReview,
          diff_meta: {
            previous: { id: 'old', prescribed_date: '2026-06-01' },
            current: { id: 'new', prescribed_date: '2026-06-02' },
          },
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    // DataTable はデスクトップ表/モバイルカードを両方 DOM に描画するため getAllByText で拾う。
    expect(screen.getByRole('columnheader', { name: '薬剤' })).toBeTruthy();
    expect(screen.getAllByText('アムロジピン錠5mg').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('今回 YJ_NEW / 前回 YJ_OLD').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('別マスターとして判定').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ロスバスタチン錠2.5mg').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('コード YJ_ROSU').length).toBeGreaterThanOrEqual(1);
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

  it('does not mark same-code different-master prescriptions as Do or unchanged', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const line = (id: string, drugMasterId: string) => ({
      id,
      line_number: 1,
      drug_name: '同一コード薬',
      drug_master_id: drugMasterId,
      drug_code: 'YJ_SHARED',
      dosage_form: '錠',
      dose: '1錠',
      frequency: '夕食後',
      days: 28,
      quantity: 28,
      unit: '錠',
      is_generic: false,
      packaging_instructions: null,
      notes: null,
      route: 'internal',
      dispensing_method: null,
      start_date: null,
      end_date: null,
    });
    const intake = (id: string, date: string, drugMasterId: string) => ({
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
      lines: [line(`line_${id}`, drugMasterId)],
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            intake('new', '2026-06-02', 'drug_master_b'),
            intake('old', '2026-06-01', 'drug_master_a'),
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.queryByText('Do')).toBeNull();
    expect(screen.getAllByText('新規').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('前回から中止:').length).toBeGreaterThanOrEqual(1);
  });

  it('treats same-master prescriptions as Do even when display name and YJ code drift', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const line = (id: string, drugName: string, drugCode: string) => ({
      id,
      line_number: 1,
      drug_name: drugName,
      drug_master_id: 'drug_master_same',
      drug_code: drugCode,
      dosage_form: '錠',
      dose: '1錠',
      frequency: '夕食後',
      days: 28,
      quantity: 28,
      unit: '錠',
      is_generic: false,
      packaging_instructions: null,
      notes: null,
      route: 'internal',
      dispensing_method: null,
      start_date: null,
      end_date: null,
    });
    const intake = (id: string, date: string, drugName: string, drugCode: string) => ({
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
      lines: [line(`line_${id}`, drugName, drugCode)],
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            intake('new', '2026-06-02', '新表示名', 'YJ_NEW'),
            intake('old', '2026-06-01', '旧表示名', 'YJ_OLD'),
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getAllByText('Do').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('前回から中止:')).toBeNull();
  });

  it('does not mark unresolved blank-identity prescriptions as Do or unchanged', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const line = (id: string) => ({
      id,
      line_number: 1,
      drug_name: '   ',
      drug_master_id: null,
      drug_code: null,
      dosage_form: '錠',
      dose: '1錠',
      frequency: '夕食後',
      days: 28,
      quantity: 28,
      unit: '錠',
      is_generic: false,
      packaging_instructions: null,
      notes: null,
      route: 'internal',
      dispensing_method: null,
      start_date: null,
      end_date: null,
    });
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
      lines: [line(`line_${id}`)],
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

    render(<PrescriptionHistoryContent />);

    expect(screen.queryByText('Do')).toBeNull();
    expect(screen.queryByText('変化なし')).toBeNull();
    expect(screen.getAllByText('新規').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('前回から中止:').length).toBeGreaterThanOrEqual(1);
  });

  it('prefers drug-master-id enrichment over stale YJ code enrichment for safety badges', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const masterInfo = (overrides: Record<string, unknown>) => ({
      id: 'drug_master_current',
      yj_code: 'YJ_NEW',
      drug_name: '正しいマスター薬',
      dosage_form: '錠',
      drug_price: 12,
      unit: '錠',
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: true,
      is_lasa_risk: true,
      tall_man_name: 'amLODIPine',
      lasa_group_key: 'amlodipine_lasa',
      max_administration_days: 30,
      therapeutic_category: '循環器官用薬',
      ...overrides,
    });

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return {
          data: {
            YJ_STALE: masterInfo({
              id: 'drug_master_wrong',
              yj_code: 'YJ_STALE',
              tall_man_name: 'WRONGTall',
              is_high_risk: false,
              is_lasa_risk: false,
            }),
            by_drug_master_id: {
              drug_master_current: masterInfo({}),
            },
          },
          isLoading: false,
        };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            {
              id: 'intake_stale_code',
              cycle_id: 'cycle_stale_code',
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
                  id: 'line_stale_code',
                  line_number: 1,
                  drug_name: '旧表示名',
                  drug_master_id: 'drug_master_current',
                  drug_code: 'YJ_STALE',
                  dosage_form: '錠',
                  dose: '1錠',
                  frequency: '夕食後',
                  days: 28,
                  quantity: 28,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                  route: 'internal',
                  dispensing_method: null,
                  start_date: null,
                  end_date: null,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getByText('amLODIPine')).toBeTruthy();
    expect(screen.getByText('通常表記: 旧表示名')).toBeTruthy();
    expect(screen.getByText('ハイリスク')).toBeTruthy();
    expect(screen.getByText('LASA')).toBeTruthy();
    expect(screen.getByText('類似薬剤名グループ: amlodipine_lasa')).toBeTruthy();
    expect(screen.queryByText('WRONGTall')).toBeNull();
  });

  it('does not fall back to stale YJ enrichment when canonical drug-master-id lookup misses', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const wrongStaleMaster = {
      id: 'drug_master_wrong',
      yj_code: 'YJ_STALE',
      drug_name: '誤ったマスター薬',
      dosage_form: '錠',
      drug_price: 12,
      unit: '錠',
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: true,
      is_lasa_risk: true,
      tall_man_name: 'WRONGTall',
      lasa_group_key: 'wrong_lasa',
      max_administration_days: 30,
      therapeutic_category: '循環器官用薬',
    };

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return {
          data: {
            YJ_STALE: wrongStaleMaster,
            by_drug_master_id: {},
          },
          isLoading: false,
        };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            {
              id: 'intake_missing_master',
              cycle_id: 'cycle_missing_master',
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
                  id: 'line_missing_master',
                  line_number: 1,
                  drug_name: '旧表示名',
                  drug_master_id: 'missing_master',
                  drug_code: 'YJ_STALE',
                  source_drug_code: 'RC001',
                  source_drug_code_type: 'receipt',
                  dosage_form: '錠',
                  dose: '1錠',
                  frequency: '夕食後',
                  days: 28,
                  quantity: 28,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                  route: 'internal',
                  dispensing_method: null,
                  start_date: null,
                  end_date: null,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getAllByText('旧表示名').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('薬剤未解決')).toBeTruthy();
    expect(screen.getByText('元コード: receipt RC001')).toBeTruthy();
    expect(screen.queryByText('WRONGTall')).toBeNull();
    expect(screen.queryByText('ハイリスク')).toBeNull();
    expect(screen.queryByText('LASA')).toBeNull();
    expect(screen.queryByText('類似薬剤名グループ: wrong_lasa')).toBeNull();
  });

  it('trims drug-master-id before by-id enrichment', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const masterInfo = {
      id: 'drug_master_current',
      yj_code: 'YJ_NEW',
      drug_name: '正しいマスター薬',
      dosage_form: '錠',
      drug_price: 12,
      unit: '錠',
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: true,
      is_lasa_risk: false,
      tall_man_name: 'amLODIPine',
      lasa_group_key: null,
      max_administration_days: 30,
      therapeutic_category: '循環器官用薬',
    };

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return {
          data: {
            YJ_STALE: { ...masterInfo, id: 'drug_master_wrong', tall_man_name: 'WRONGTall' },
            by_drug_master_id: {
              drug_master_current: masterInfo,
            },
          },
          isLoading: false,
        };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            {
              id: 'intake_trimmed_master',
              cycle_id: 'cycle_trimmed_master',
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
                  id: 'line_trimmed_master',
                  line_number: 1,
                  drug_name: '旧表示名',
                  drug_master_id: ' drug_master_current ',
                  drug_code: 'YJ_STALE',
                  dosage_form: '錠',
                  dose: '1錠',
                  frequency: '夕食後',
                  days: 28,
                  quantity: 28,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                  route: 'internal',
                  dispensing_method: null,
                  start_date: null,
                  end_date: null,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getByText('amLODIPine')).toBeTruthy();
    expect(screen.getByText('通常表記: 旧表示名')).toBeTruthy();
    expect(screen.getByText('ハイリスク')).toBeTruthy();
    expect(screen.queryByText('薬剤未解決')).toBeNull();
    expect(screen.queryByText('WRONGTall')).toBeNull();
  });

  it('shows non-resolved medication status on other-route lines with the source drug code', () => {
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
              id: 'intake_unresolved',
              cycle_id: 'cycle_unresolved',
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
                  id: 'line_unresolved',
                  line_number: 1,
                  drug_name: '未確認薬',
                  drug_master_id: null,
                  drug_code: null,
                  source_drug_code: 'RC001',
                  source_drug_code_type: 'receipt',
                  drug_resolution_status: 'code_not_found',
                  dosage_form: '錠',
                  dose: '1錠',
                  frequency: '夕食後',
                  days: 28,
                  quantity: 28,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                  route: 'other',
                  dispensing_method: null,
                  start_date: null,
                  end_date: null,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<PrescriptionHistoryContent />);

    expect(screen.getByText('その他（1剤）')).toBeTruthy();
    expect(screen.getByText('薬剤未解決')).toBeTruthy();
    expect(screen.getByText('元コード: receipt RC001')).toBeTruthy();
  });

  it('resolves an unlinked prescription line through the DrugMaster confirmation contract', async () => {
    const invalidateQueries = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    useMutationMock.mockImplementation(
      (config: {
        mutationFn: (input: unknown) => Promise<unknown> | unknown;
        onSuccess?: () => Promise<void> | void;
      }) => ({
        mutate: vi.fn(async (input: unknown) => {
          await config.mutationFn(input);
          await config.onSuccess?.();
        }),
        isPending: false,
      }),
    );

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: 'patient_1', name: '山田花子', name_kana: 'ヤマダハナコ' },
          data: [
            {
              id: 'intake_unresolved',
              cycle_id: 'cycle_unresolved',
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
                  id: 'line_unresolved',
                  line_number: 1,
                  updated_at: '2026-06-01T09:00:00.000Z',
                  drug_name: '未確認薬',
                  drug_master_id: null,
                  drug_code: null,
                  source_drug_code: 'RC001',
                  source_drug_code_type: 'receipt',
                  drug_resolution_status: 'review_required',
                  dosage_form: '錠',
                  dose: '1錠',
                  frequency: '夕食後',
                  days: 28,
                  quantity: 28,
                  unit: '錠',
                  is_generic: false,
                  packaging_instructions: null,
                  notes: null,
                  route: 'other',
                  dispensing_method: null,
                  start_date: null,
                  end_date: null,
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'line_unresolved' } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PrescriptionHistoryContent />);

      fireEvent.click(screen.getByRole('button', { name: '履歴薬剤候補を選択' }));
      fireEvent.click(screen.getByRole('button', { name: '医薬品マスターへ確定' }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/prescription-lines/line_unresolved',
          expect.any(Object),
        ),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('PATCH');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-org-id': 'org_1' });
      expect(JSON.parse(String(init.body))).toEqual({
        expected_updated_at: '2026-06-01T09:00:00.000Z',
        drug_master_id: 'drug_master_selected',
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['patient-prescriptions', 'org_1', 'patient_1'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['drug-masters-batch', 'org_1'],
      });
    } finally {
      vi.unstubAllGlobals();
    }
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

describe('PrescriptionHistoryContent url/header convergence', () => {
  const HOSTILE = 'pt/1?x=y#z';
  const ENCODED = 'pt%2F1%3Fx%3Dy%23z';

  type HistoryLineFixture = {
    id: string;
    line_number: number;
    drug_name: string;
    drug_master_id: string | null;
    drug_code: string | null;
    dosage_form: string | null;
    dose: string;
    frequency: string;
    days: number;
    quantity: number;
    unit: string;
    is_generic: boolean;
    packaging_instructions: string | null;
    notes: string | null;
    route: string | null;
    dispensing_method: string | null;
    start_date: string | null;
    end_date: string | null;
  };

  function buildLine(drugCode: string | null, overrides: Partial<HistoryLineFixture> = {}) {
    return {
      id: 'line_1',
      line_number: 1,
      drug_name: 'アムロジピン錠5mg',
      drug_master_id: null,
      drug_code: drugCode,
      dosage_form: '錠',
      dose: '1錠',
      frequency: '1日1回朝食後',
      days: 28,
      quantity: 28,
      unit: '錠',
      is_generic: false,
      packaging_instructions: null,
      notes: null,
      route: null,
      dispensing_method: null,
      start_date: null,
      end_date: null,
      ...overrides,
    };
  }

  function renderHistory({
    patientId = HOSTILE,
    lines = [] as ReturnType<typeof buildLine>[],
  } = {}) {
    const queryConfigs = new Map<string, { queryKey: unknown[]; queryFn: () => unknown }>();
    const mutationConfigs: Array<{
      mutationFn: (input?: unknown) => unknown;
      onError?: (error: Error) => void;
    }> = [];
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: patientId });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockImplementation(
      (cfg: { mutationFn: (input?: unknown) => unknown; onError?: (error: Error) => void }) => {
        mutationConfigs.push(cfg);
        return { mutate: vi.fn(), isPending: false };
      },
    );
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[]; queryFn: () => unknown }) => {
      queryConfigs.set(String((cfg.queryKey as unknown[])[0]), cfg);
      if (String((cfg.queryKey as unknown[])[0]) === 'drug-masters-batch') {
        return { data: {}, isLoading: false };
      }
      return {
        data: {
          patient: { id: patientId, name: '山田花子', name_kana: 'ヤマダハナコ' },
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
              lines,
            },
          ],
          diff_review: null,
          diff_meta: null,
        },
        isLoading: false,
      };
    });
    render(<PrescriptionHistoryContent />);
    return { queryConfigs, mutationConfigs };
  }

  function stubFetch(json: unknown = { data: [] }) {
    return stubJsonFetch(json);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single-encodes the patient path on the prescriptions GET and adopts buildOrgHeaders', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderHistory();
    const fetchMock = stubFetch({ patient: {}, data: [], diff_review: null, diff_meta: null });
    try {
      await queryConfigs.get('patient-prescriptions')!.queryFn();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(HOSTILE, '/prescriptions');
      expect(url).toBe(`/api/patients/${ENCODED}/prescriptions?limit=100`);
      expect(url).not.toContain('%25');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      // raw id stays in the cache key
      expect(queryConfigs.get('patient-prescriptions')!.queryKey).toEqual([
        'patient-prescriptions',
        'org_1',
        HOSTILE,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'prescriptions GET fails closed before fetch for the exact dot patient id %p',
    async (dotId) => {
      const { queryConfigs } = renderHistory({ patientId: dotId });
      const fetchMock = stubFetch();
      try {
        await expect(queryConfigs.get('patient-prescriptions')!.queryFn()).rejects.toThrow(
          RangeError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('prescriptions GET consumes the shared patient API path helper return value', async () => {
    const { queryConfigs } = renderHistory({ patientId: 'patient_1' });
    const fetchMock = stubFetch({ patient: {}, data: [], diff_review: null, diff_meta: null });
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__/rx');

    try {
      await queryConfigs.get('patient-prescriptions')!.queryFn();
      expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1', '/prescriptions');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__/rx?limit=100');
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/patients/patient_1/prescriptions?limit=100',
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('prescriptions GET keeps the API message when fetch fails', async () => {
    const { queryConfigs } = renderHistory({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch({ message: '処方履歴を表示できません' }, 403);
    try {
      await expect(queryConfigs.get('patient-prescriptions')!.queryFn()).rejects.toThrow(
        '処方履歴を表示できません',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/patients/patient_1/prescriptions?limit=100',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drug-masters batch POST adopts json helper with yj_codes and drug_master_ids', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderHistory({
      lines: [
        buildLine('YJ_STALE', { drug_master_id: 'drug_master_current' }),
        buildLine(null, {
          id: 'line_id_only',
          drug_name: 'ロサルタン錠25mg',
          drug_master_id: 'drug_master_id_only',
        }),
      ],
    });
    const fetchMock = stubFetch({ data: {} });
    try {
      await queryConfigs.get('drug-masters-batch')!.queryFn();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/drug-masters/batch');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(queryConfigs.get('drug-masters-batch')!.queryKey).toEqual([
        'drug-masters-batch',
        'org_1',
        ['YJ_STALE'],
        ['drug_master_current', 'drug_master_id_only'],
      ]);
      expect(JSON.parse(init.body as string)).toEqual({
        yj_codes: ['YJ_STALE'],
        drug_master_ids: ['drug_master_current', 'drug_master_id_only'],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drug-masters batch POST keeps the API message when fetch fails', async () => {
    const { queryConfigs } = renderHistory({
      lines: [buildLine('YJ_STALE', { drug_master_id: 'drug_master_current' })],
    });
    const fetchMock = stubJsonFetch({ message: '薬剤マスタを表示できません' }, 403);
    try {
      await expect(queryConfigs.get('drug-masters-batch')!.queryFn()).rejects.toThrow(
        '薬剤マスタを表示できません',
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/drug-masters/batch');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
      );
      expect(JSON.parse(String(init.body))).toEqual({
        yj_codes: ['YJ_STALE'],
        drug_master_ids: ['drug_master_current'],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mark-original-collected PATCH single-encodes the intakeId, adopts json helper, keeps id out of body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderHistory();
    const fetchMock = stubFetch({});
    try {
      await mutationConfigs[0].mutationFn(HOSTILE);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/prescription-intakes/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      const body = JSON.parse(init.body as string);
      expect(Object.keys(body)).toEqual(['original_collected_at']);
      expect(body.original_collected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(init.body as string).not.toContain(HOSTILE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps server messages and falls back for prescription history mutation error toasts', () => {
    const { mutationConfigs } = renderHistory();
    expect(mutationConfigs).toHaveLength(2);
    const [markOriginalCollected, resolveDrugMaster] = mutationConfigs;

    markOriginalCollected.onError?.(new Error('原本回収APIからの詳細エラー'));
    expect(toast.error).toHaveBeenLastCalledWith('原本回収APIからの詳細エラー');
    markOriginalCollected.onError?.(new Error(''));
    expect(toast.error).toHaveBeenLastCalledWith('原本回収の記録に失敗しました');

    resolveDrugMaster.onError?.(new Error('医薬品マスターAPIからの詳細エラー'));
    expect(toast.error).toHaveBeenLastCalledWith('医薬品マスターAPIからの詳細エラー');
    resolveDrugMaster.onError?.(new Error(''));
    expect(toast.error).toHaveBeenLastCalledWith('医薬品マスター確定に失敗しました');
  });

  it.each(['.', '..'])(
    'mark-original-collected PATCH fails closed before fetch for the exact dot intakeId %p',
    async (dotId) => {
      const { mutationConfigs } = renderHistory();
      const fetchMock = stubFetch();
      try {
        await expect(mutationConfigs[0].mutationFn(dotId)).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
