// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { InventoryForecastContent } from './inventory-forecast-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderContent() {
  return render(<InventoryForecastContent />, { wrapper: createWrapper() });
}

describe('InventoryForecastContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/admin/inventory-forecast') {
          return new Response('{}', { status: 404 });
        }

        return new Response(
          JSON.stringify({
            data: {
              week: { start_date: '2026-06-22', end_date: '2026-06-28' },
              drugs: [
                {
                  drugKey: 'アムロジピン',
                  requiredQty: 14,
                  stockQty: 4,
                  unit: '錠',
                  status: 'order_required',
                },
                {
                  drugKey: '酸化Mg',
                  requiredQty: 7,
                  stockQty: 10,
                  unit: '包',
                  status: 'sufficient',
                },
              ],
              patients: [
                {
                  key: 'patient_1',
                  label: '患者A',
                  firstVisitDateKey: '2026-06-23',
                  isFacilityBatch: false,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );
  });

  it('keeps drug forecast table searchable without adding patient-list search controls', async () => {
    renderContent();

    expect(await screen.findByRole('heading', { name: '在庫と定期処方の予測' })).toBeTruthy();
    expect((await screen.findAllByText('アムロジピン')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('薬剤別必要量内検索')).toBeTruthy();
    expect(screen.getByRole('button', { name: '列' })).toBeTruthy();
    expect(screen.getAllByText('要発注').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('14錠').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('患者A 様')).toBeTruthy();
    expect(screen.queryByLabelText('影響患者内検索')).toBeNull();
  });
});
