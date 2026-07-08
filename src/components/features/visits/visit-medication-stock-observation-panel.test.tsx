// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitMedicationStockObservationPanel } from './visit-medication-stock-observation-panel';
import type { PatientMedicationStockSummaryResponse } from '@/types/medication-stock';

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
        equivalence_review_status: 'none',
        equivalence_confidence: null,
        active: true,
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
        equivalence_review_status: 'none',
        equivalence_confidence: null,
        active: true,
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
    expect(screen.getAllByText('現在推定残数')).toHaveLength(2);
    expect(screen.getByText('4枚')).toBeTruthy();
    expect(screen.getByText(/12枚/)).toBeTruthy();
    expect(screen.getByText('不足見込み')).toBeTruthy();
    expect(screen.getByText(/あと2日/)).toBeTruthy();
    expect(screen.getByText('snapshot未作成')).toBeTruthy();
    expect(screen.getByText('他 1 件')).toBeTruthy();

    const quantityInputs = screen.getAllByLabelText('今回確認した残数') as HTMLInputElement[];
    expect(quantityInputs).toHaveLength(2);
    expect(quantityInputs.every((input) => input.disabled)).toBe(true);
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

  it('shows an explicit error state instead of an empty state when summary fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '患者の残数管理情報の閲覧権限がありません' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPanel();

    expect(await screen.findByText('残数管理情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText('患者の残数管理情報の閲覧権限がありません')).toBeTruthy();
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
});
