// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import BillingRulesPage from './page';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
    isPending: false,
  }),
  useQuery: () => ({
    data: {
      data: [
        {
          id: 'rule_1',
          org_id: 'org_1',
          billing_scope: 'home_care',
          rule_type: 'addition',
          service_type: 'home_care',
          payer_basis: null,
          provider_scope: null,
          selection_mode: 'manual',
          calculation_unit: 'point',
          name: '夜間加算',
          code: 'YAKAN',
          conditions: {},
          evidence_requirements: {},
          amount: 100,
          source_url: null,
          source_note: null,
          is_system: false,
          is_active: true,
          created_at: '2026-06-19T00:00:00.000Z',
          updated_at: '2026-06-19T00:00:00.000Z',
        },
      ],
      source: {
        source_of_truth: 'local',
        sync_direction: 'push',
        recovery_procedure: null,
      },
      summary: { ssot_rule_count: 0, custom_rule_count: 1 },
    },
    isLoading: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
  }: {
    columns: Array<{ id?: string; cell?: (args: { row: { original: unknown } }) => ReactNode }>;
    data: unknown[];
  }) => (
    <div>
      {data.map((row, rowIndex) => (
        <div key={rowIndex}>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={`${column.id ?? columnIndex}`}>
                {column.cell({ row: { original: row } })}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('BillingRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the billing rule delete action and requires confirmation', () => {
    render(<BillingRulesPage />);

    fireEvent.click(screen.getByRole('button', { name: '夜間加算 を削除' }));

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '算定ルールを削除しますか？' })).toBeTruthy();
    expect(screen.getByText('「夜間加算」を削除します。この操作は取り消せません。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(mutationMutateMock).toHaveBeenCalledWith('rule_1');
  });
});
