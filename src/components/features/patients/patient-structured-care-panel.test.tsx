// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientStructuredCarePanel } from './patient-structured-care-panel';
import { stubJsonFetch as stubFetch } from '@/test/fetch-test-utils';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

setupDomTestEnv();

describe('PatientStructuredCarePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('処置・麻薬の構造化行をラベル・開始日・確認元で表示する', async () => {
    stubFetch({
      data: {
        procedures: [
          {
            id: 'mp_1',
            kind: 'tpn',
            is_active: true,
            start_date: '2026-06-10T00:00:00.000Z',
            end_date: null,
            source: 'visit_record',
            confirmed_by: 'u',
            confirmed_by_name: '佐藤',
            confirmed_at: null,
            notes: null,
          },
        ],
        narcotics: [
          {
            id: 'nu_1',
            kind: 'base',
            is_active: true,
            start_date: '2026-06-11T00:00:00.000Z',
            end_date: null,
            source: 'patient_detail_edit',
            confirmed_by: null,
            confirmed_by_name: null,
            confirmed_at: null,
            notes: null,
          },
        ],
      },
    });

    render(<PatientStructuredCarePanel patientId="p1" />, { wrapper: createQueryClientWrapper() });

    await screen.findByTestId('patient-structured-care-panel');
    expect(screen.getByText('TPN')).toBeTruthy();
    expect(screen.getByText('ベース')).toBeTruthy();
    // date-only は UTC 基準で TZ 非依存に整形される
    expect(screen.getByText(/開始 2026\/6\/10/)).toBeTruthy();
    expect(screen.getByText(/確認元: 訪問記録/)).toBeTruthy();
  });

  it('構造化行が無ければ空カードを描画しない', async () => {
    stubFetch({ data: { procedures: [], narcotics: [] } });

    render(<PatientStructuredCarePanel patientId="p1" />, { wrapper: createQueryClientWrapper() });

    await waitFor(() => {
      expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('patient-structured-care-panel')).toBeNull();
  });

  it('shared patient API path helper 経由で構造化ケアを取得する', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { procedures: [], narcotics: [] } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_pt__/structured-care',
    );

    render(<PatientStructuredCarePanel patientId="pt/1?tab=x#frag" />, {
      wrapper: createQueryClientWrapper(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(buildPatientApiPath).toHaveBeenCalledWith('pt/1?tab=x#frag', '/structured-care');
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_pt__/structured-care', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/patients/pt/1?tab=x#frag/structured-care',
      expect.anything(),
    );
  });

  it('取得失敗時は空カードではなく再読み込み可能なエラー状態を表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );

    render(<PatientStructuredCarePanel patientId="p1" />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByTestId('patient-structured-care-panel-error')).toBeTruthy();
    expect(screen.getByText('在宅医療処置・麻薬の取得に失敗しました。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('failed structured-care reads keep API error messages in the query error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '構造化ケアの閲覧権限がありません' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const queryClient = createTestQueryClient();

    render(<PatientStructuredCarePanel patientId="p1" />, {
      wrapper: createQueryClientWrapper(queryClient),
    });

    await screen.findByTestId('patient-structured-care-panel-error');
    const query = queryClient.getQueryCache().find({
      queryKey: ['patient-structured-care', 'p1', 'org_1'],
    });
    expect(query?.state.error).toBeInstanceOf(Error);
    expect((query?.state.error as Error).message).toBe('構造化ケアの閲覧権限がありません');
  });
});
