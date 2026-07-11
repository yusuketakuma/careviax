// @vitest-environment jsdom

import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  formatStockLedgerDifference,
  VisitMedicationStockObservationPanel,
} from './visit-medication-stock-observation-panel';
import type {
  PatientMedicationStockSummaryResponse,
  VisitMedicationStockObservationDraft,
} from '@/types/medication-stock';

const { useOrgIdMock, useNetworkOnlineMock, fetchMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
  useNetworkOnlineMock: vi.fn(),
  fetchMock: vi.fn<typeof fetch>(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-network-online', () => ({
  useNetworkOnline: useNetworkOnlineMock,
}));

setupDomTestEnv();

const stockSummary: PatientMedicationStockSummaryResponse = {
  data: {
    patient_id: 'patient_1',
    summary: {
      total_item_count: 2,
      visible_item_count: 2,
      active_item_count: 2,
      urgent_count: 0,
      shortage_expected_count: 1,
      watch_count: 0,
      unknown_risk_count: 0,
      usage_unknown_count: 0,
      equivalence_review_count: 0,
      pending_external_observation_count: 0,
      last_observed_at: '2026-07-07T00:00:00.000Z',
    },
    items: [
      {
        id: 'stock_1',
        display_id: 'STK-1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        display_name: 'モーラスパップ30mg',
        normalized_name: 'モーラスパップ30mg',
        ingredient_name: 'ケトプロフェン',
        strength: '30mg',
        dosage_form: '貼付剤',
        route: '外用',
        unit: '枚',
        source_type: 'prescription',
        medication_category: 'topical',
        managing_party: 'family',
        equivalence_review_status: 'not_required',
        equivalence_confidence: null,
        active: true,
        snapshot_status: 'available',
        snapshot: {
          current_quantity: 4,
          last_observed_quantity: 12,
          last_observed_at: '2026-07-06T10:30:00.000Z',
          estimated_daily_usage: 2,
          usage_confidence: 'medium',
          estimated_stockout_date: '2026-07-09T00:00:00.000Z',
          days_until_stockout: 2,
          stock_risk_level: 'shortage_expected',
          risk_reason_code: 'before_next_visit',
          calculated_at: '2026-07-07T00:00:00.000Z',
        },
      },
      {
        id: 'stock_2',
        display_id: 'STK-2',
        patient_id: 'patient_1',
        case_id: null,
        display_name: '不明薬',
        normalized_name: null,
        ingredient_name: null,
        strength: null,
        dosage_form: null,
        route: null,
        unit: '錠',
        source_type: 'manual',
        medication_category: 'other',
        managing_party: 'unknown',
        equivalence_review_status: 'not_required',
        equivalence_confidence: null,
        active: true,
        snapshot_status: 'missing',
        snapshot: null,
      },
    ],
    recent_events: [],
  },
  meta: {
    generated_at: '2026-07-07T00:00:00.000Z',
    item_limit: 20,
    event_limit: 0,
    visible_count: 2,
    hidden_count: 1,
    count_basis: 'limited_items',
    partial_failures: [],
  },
};

function renderPanel(patientId: string | null = 'patient_1') {
  return render(<VisitMedicationStockObservationPanel patientId={patientId} />, {
    wrapper: createQueryClientWrapper(),
  });
}

function freshStockSummary(): PatientMedicationStockSummaryResponse {
  return {
    ...stockSummary,
    meta: {
      ...stockSummary.meta,
      generated_at: new Date().toISOString(),
    },
  };
}

function WritePanelHarness({
  onDraftsChange,
  initialDrafts = [],
}: {
  onDraftsChange?: (drafts: VisitMedicationStockObservationDraft[]) => void;
  initialDrafts?: VisitMedicationStockObservationDraft[];
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  return (
    <VisitMedicationStockObservationPanel
      patientId="patient_1"
      writeEnabled
      drafts={drafts}
      onDraftsChange={(nextDrafts) => {
        setDrafts(nextDrafts);
        onDraftsChange?.(nextDrafts);
      }}
    />
  );
}

describe('formatStockLedgerDifference', () => {
  it('formats signed, rounded, and unavailable ledger differences without treating them as measurements', () => {
    expect(formatStockLedgerDifference(4, 12, '枚')).toBe('-8枚（減少）');
    expect(formatStockLedgerDifference(6, 4, '枚')).toBe('+2枚（増加）');
    expect(formatStockLedgerDifference(0, 0, '錠')).toBe('0錠（変化なし）');
    expect(formatStockLedgerDifference(0.3, 0.1, 'mL')).toBe('+0.2mL（増加）');
    expect(formatStockLedgerDifference(null, 4, '枚')).toBe('算出不可');
    expect(formatStockLedgerDifference(4, Number.NaN, '枚')).toBe('算出不可');
    expect(formatStockLedgerDifference(Number.POSITIVE_INFINITY, 4, '枚')).toBe('算出不可');
  });
});

describe('VisitMedicationStockObservationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useNetworkOnlineMock.mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches patient medication stock summary and renders read-only stock context', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(stockSummary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPanel();

    expect(await screen.findByText('モーラスパップ30mg')).toBeTruthy();
    expect(screen.getAllByText('前回の記録残数')).toHaveLength(2);
    expect(screen.getAllByText('台帳計算残数（参考）')).toHaveLength(2);
    expect(screen.getAllByText('前回記録以降の台帳差分')).toHaveLength(2);
    expect(screen.getByText('4枚')).toBeTruthy();
    expect(screen.getByText(/12枚/)).toBeTruthy();
    expect(screen.getByText('-8枚（減少）')).toBeTruthy();
    expect(screen.getByText('算出不可')).toBeTruthy();
    expect(screen.getByText(/2026年7月6日/)).toBeTruthy();
    expect(screen.getAllByText(/2026年7月7日/)).toHaveLength(2);
    expect(screen.queryByText('前回実測')).toBeNull();
    expect(screen.getByText('不足見込み')).toBeTruthy();
    expect(screen.getByText(/あと2日/)).toBeTruthy();
    expect(screen.getByText('snapshot未作成')).toBeTruthy();
    expect(screen.getByText('他 1 件')).toBeTruthy();

    expect(screen.getByText('登録無効')).toBeTruthy();
    const observationSelectors = screen.getAllByRole('combobox', { name: '今回の観測' });
    expect(observationSelectors).toHaveLength(2);
    expect(observationSelectors.every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/patients/patient_1/medication-stock?item_limit=20&event_limit=0',
    );
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/medication-stock-observations'),
      ),
    ).toBe(false);
  });

  it('fails closed when the summary marks a snapshot unit mismatch', async () => {
    const unitMismatchSummary: PatientMedicationStockSummaryResponse = {
      ...freshStockSummary(),
      data: {
        ...stockSummary.data,
        summary: {
          ...stockSummary.data.summary,
          total_item_count: 1,
          visible_item_count: 1,
          active_item_count: 1,
          urgent_count: 0,
          shortage_expected_count: 0,
          unknown_risk_count: 1,
          last_observed_at: null,
        },
        items: [
          {
            ...stockSummary.data.items[0],
            id: 'stock_unit_mismatch',
            display_name: '単位確認薬',
            snapshot_status: 'unit_mismatch',
            snapshot: {
              ...stockSummary.data.items[0].snapshot!,
              current_quantity: 777,
              last_observed_quantity: 444,
              stock_risk_level: 'urgent',
              risk_reason_code: 'legacy-unit-mismatch',
            },
          },
        ],
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(unitMismatchSummary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPanel();

    expect(await screen.findByText('単位確認薬')).toBeTruthy();
    expect(screen.getByText('残数単位の整合性を確認中です。')).toBeTruthy();
    expect(
      screen.getByText(
        '前回の記録残数・台帳計算残数・差分・推定値は表示していません。薬剤師が確認してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('不明', { exact: true })).toBeTruthy();
    expect(screen.getAllByText('確認不可', { exact: true })).toHaveLength(5);
    expect(screen.getByText('算出不可', { exact: true })).toBeTruthy();
    expect(screen.queryByText('777枚')).toBeNull();
    expect(screen.queryByText('444枚')).toBeNull();
    expect(screen.queryByText('至急', { exact: true })).toBeNull();
    expect(screen.queryByText('legacy-unit-mismatch')).toBeNull();
    expect(screen.queryByText('snapshot未作成')).toBeNull();
  });

  it('shows an explicit error state instead of an empty state when summary fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '患者の残数管理情報の閲覧権限がありません' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPanel();

    expect(await screen.findByText('残数管理情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText('通信状態を確認して再試行してください。')).toBeTruthy();
    expect(screen.queryByText('患者の残数管理情報の閲覧権限がありません')).toBeNull();
    expect(screen.queryByText('残数管理台帳に表示できる薬剤はまだありません。')).toBeNull();
  });

  it('does not fetch and does not show a false empty state when patient id is missing', async () => {
    renderPanel(null);

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
    expect(screen.getByText('患者IDを確認できるまで残数管理情報は取得しません。')).toBeTruthy();
  });

  it('does not fetch and does not show a false empty state when org context is missing', async () => {
    useOrgIdMock.mockReturnValue(null);

    renderPanel();

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
    expect(
      screen.getByText('薬局コンテキストを確認できるまで残数管理情報は取得しません。'),
    ).toBeTruthy();
  });

  it('shows offline unavailable state before treating data as empty', async () => {
    useNetworkOnlineMock.mockReturnValue(false);

    renderPanel();

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
    expect(
      screen.getByText(
        'オフライン中のため残数管理情報を取得できません。通信復帰後に再取得してください。',
      ),
    ).toBeTruthy();
  });

  it('collects a controlled observation draft without posting before visit record save', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(freshStockSummary()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onDraftsChange = vi.fn();

    render(<WritePanelHarness onDraftsChange={onDraftsChange} />, {
      wrapper: createQueryClientWrapper(),
    });

    expect(await screen.findByText('モーラスパップ30mg')).toBeTruthy();
    const observationSelectors = screen.getAllByRole('combobox', { name: '今回の観測' });
    fireEvent.click(observationSelectors[0]);
    const observedAbsoluteOption = screen.getByRole('option', { name: '今回残数' });
    fireEvent.pointerDown(observedAbsoluteOption, { pointerType: 'mouse' });
    fireEvent.click(observedAbsoluteOption);

    await waitFor(() => {
      expect(onDraftsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          stock_item_id: 'stock_1',
          kind: 'observed_absolute',
        }),
      ]);
    });

    fireEvent.change(screen.getByLabelText('今回残数（枚）'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: '確認元' }));
    const pharmacistSourceOption = screen.getByRole('option', { name: '薬剤師が直接確認' });
    fireEvent.pointerDown(pharmacistSourceOption, { pointerType: 'mouse' });
    fireEvent.click(pharmacistSourceOption);

    expect(onDraftsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        stock_item_id: 'stock_1',
        kind: 'observed_absolute',
        quantity_input: '4',
        source_preset: 'pharmacist_counted',
      }),
    ]);
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/medication-stock-observations'),
      ),
    ).toBe(false);
  });

  it('uses controlled review labels and blocks only unresolved medication identities', async () => {
    const reviewSummary: PatientMedicationStockSummaryResponse = {
      ...freshStockSummary(),
      data: {
        ...stockSummary.data,
        summary: {
          ...stockSummary.data.summary,
          total_item_count: 3,
          visible_item_count: 3,
          active_item_count: 3,
          equivalence_review_count: 2,
        },
        items: [
          {
            ...stockSummary.data.items[0],
            id: 'stock_needs_review',
            display_name: '名寄せ確認薬',
            equivalence_review_status: 'needs_review',
          },
          {
            ...stockSummary.data.items[1],
            id: 'stock_uncertain',
            display_name: '名寄せ継続薬',
            equivalence_review_status: 'uncertain',
          },
          {
            ...stockSummary.data.items[0],
            id: 'stock_reviewed',
            display_name: '名寄せ確認済み薬',
            equivalence_review_status: 'reviewed',
          },
        ],
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(reviewSummary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<WritePanelHarness />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByText('名寄せ確認薬')).toBeTruthy();
    expect(screen.getByText('名寄せ確認が必要')).toBeTruthy();
    expect(screen.getByText('名寄せ確認を継続')).toBeTruthy();
    expect(screen.getByText('名寄せ確認済み')).toBeTruthy();
    expect(screen.queryByText('needs_review')).toBeNull();
    expect(screen.queryByText('uncertain')).toBeNull();
    expect(screen.queryByText('reviewed')).toBeNull();

    const observationSelectors = screen.getAllByRole('combobox', { name: '今回の観測' });
    expect(observationSelectors).toHaveLength(3);
    expect(observationSelectors[0].hasAttribute('disabled')).toBe(true);
    expect(observationSelectors[1].hasAttribute('disabled')).toBe(true);
    expect(observationSelectors[2].hasAttribute('disabled')).toBe(false);
  });

  it('preserves a draft but disables mutation fields when the network goes offline', async () => {
    useNetworkOnlineMock.mockReturnValue(false);
    const draft: VisitMedicationStockObservationDraft = {
      client_observation_id: 'obs_1',
      stock_item_id: 'stock_1',
      unit: '枚',
      kind: 'observed_absolute',
      quantity_input: '4',
      used_quantity_input: '',
      usage_quantity_input: '',
      usage_period_days_input: '',
      last_used_date: '',
      unobserved_reason_code: '',
      source_preset: 'pharmacist_counted',
    };

    render(<WritePanelHarness initialDrafts={[draft]} />, {
      wrapper: createQueryClientWrapper(),
    });

    expect(screen.getByText('オフライン送信不可')).toBeTruthy();
    expect(
      screen.getByText(
        'オフライン中のため残数管理情報を取得できません。通信復帰後に再取得してください。',
      ),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows persistent submission failure and retries only through the explicit action', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(freshStockSummary()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onRetrySubmission = vi.fn();

    render(
      <VisitMedicationStockObservationPanel
        patientId="patient_1"
        writeEnabled
        drafts={[]}
        onDraftsChange={() => undefined}
        submissionState={{
          status: 'conflict',
          message: '残数観測が競合しました。最新情報を確認して同じ内容で再試行してください。',
        }}
        onRetrySubmission={onRetrySubmission}
      />,
      { wrapper: createQueryClientWrapper() },
    );

    expect((await screen.findByRole('alert')).textContent).toContain('残数観測が競合しました');
    fireEvent.click(screen.getByRole('button', { name: '同じ内容で再試行' }));
    expect(onRetrySubmission).toHaveBeenCalledTimes(1);
  });
});
