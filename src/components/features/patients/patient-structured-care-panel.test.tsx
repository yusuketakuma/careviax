// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientStructuredCarePanel } from './patient-structured-care-panel';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
  );
}

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

    render(<PatientStructuredCarePanel patientId="p1" />, { wrapper: createWrapper() });

    await screen.findByTestId('patient-structured-care-panel');
    expect(screen.getByText('TPN')).toBeTruthy();
    expect(screen.getByText('ベース')).toBeTruthy();
    // date-only は UTC 基準で TZ 非依存に整形される
    expect(screen.getByText(/開始 2026\/6\/10/)).toBeTruthy();
    expect(screen.getByText(/確認元: 訪問記録/)).toBeTruthy();
  });

  it('構造化行が無ければ空カードを描画しない', async () => {
    stubFetch({ data: { procedures: [], narcotics: [] } });

    render(<PatientStructuredCarePanel patientId="p1" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('patient-structured-care-panel')).toBeNull();
  });
});
