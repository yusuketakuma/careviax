// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { VisitReflectedFieldsCard } from './visit-reflected-fields-card';
import { jsonResponse, stubJsonFetch as stubFetch } from '@/test/fetch-test-utils';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

const revision = {
  id: 'rev_1',
  category: 'clinical',
  field_key: 'care_level',
  field_label: '介護度',
  value_label: '要介護2 → 要介護4',
  previous: '要介護2',
  current: '要介護4',
  source: 'visit_record',
  source_visit_record_id: 'vr_1',
  change_reason: null,
  importance: 'normal',
  confirmed_by: null,
  confirmed_by_name: null,
  confirmed_at: null,
  valid_from: '2026-06-16T00:00:00.000Z',
  valid_to: null,
  is_current: true,
  updated_by: 'u',
  updated_by_name: '田中',
  created_at: '2026-06-16T01:00:00.000Z',
};

describe('VisitReflectedFieldsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('反映項目を項目名・変更種別・差分で表示する', async () => {
    stubFetch({ data: [revision] });

    render(<VisitReflectedFieldsCard recordId="vr_1" />, { wrapper: createQueryClientWrapper() });

    await screen.findByTestId('visit-reflected-fields-card');
    expect(screen.getByText('介護度')).toBeTruthy();
    expect(screen.getByText('変更')).toBeTruthy(); // previous/current 両方あり → 変更
    expect(screen.getByText('要介護2 → 要介護4')).toBeTruthy();
  });

  it('電話など機微項目は生値を出さず項目名のみ表示する', async () => {
    stubFetch({
      data: [
        {
          ...revision,
          id: 'rev_2',
          category: 'basic',
          field_key: 'phone',
          field_label: '電話番号',
          value_label: '090-1111-2222',
        },
      ],
    });

    render(<VisitReflectedFieldsCard recordId="vr_1" />, { wrapper: createQueryClientWrapper() });

    await screen.findByTestId('visit-reflected-fields-card');
    expect(screen.getByText('電話番号')).toBeTruthy();
    expect(screen.queryByText('090-1111-2222')).toBeNull();
  });

  it('反映が無ければカードを描画しない', async () => {
    stubFetch({ data: [] });

    render(<VisitReflectedFieldsCard recordId="vr_1" />, { wrapper: createQueryClientWrapper() });

    await waitFor(() => {
      expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('visit-reflected-fields-card')).toBeNull();
  });

  it('取得失敗時は空カードではなく再読み込み可能なエラー状態を表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );

    render(<VisitReflectedFieldsCard recordId="vr_1" />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByTestId('visit-reflected-fields-card-error')).toBeTruthy();
    expect(screen.getByText('反映済み項目の取得に失敗しました。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('取得失敗時にAPIメッセージをquery errorへ残す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'API側の反映項目エラー' }, 500)),
    );
    const queryClient = createTestQueryClient();

    render(<VisitReflectedFieldsCard recordId="vr_1" />, {
      wrapper: createQueryClientWrapper(queryClient),
    });

    expect(await screen.findByTestId('visit-reflected-fields-card-error')).toBeTruthy();
    await waitFor(() => {
      expect(queryClient.getQueryState(['visit-reflected-fields', 'vr_1', 'org_1'])?.error).toEqual(
        new Error('API側の反映項目エラー'),
      );
    });
  });
});
