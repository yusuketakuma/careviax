// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BILLING_RULES_API_PATH, buildBillingRuleApiPath } from '@/lib/billing-rules/api-paths';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import BillingRulesPage from './page';

setupDomTestEnv();

const { mutationMutateMock, mutationOptionsMock, queryOptionsMock, ruleStateMock } = vi.hoisted(
  () => ({
    mutationMutateMock: vi.fn(),
    mutationOptionsMock: [] as Array<{
      mutationFn?: (variables?: unknown) => Promise<unknown>;
      onError?: (error: Error) => void;
      onSuccess?: (data: unknown) => void | Promise<void>;
    }>,
    queryOptionsMock: [] as Array<{
      queryKey?: readonly unknown[];
      queryFn?: () => Promise<unknown>;
    }>,
    ruleStateMock: {
      id: 'rule_1',
      conditions: {} as Record<string, unknown>,
      evidenceRequirements: {} as Record<string, unknown>,
    },
  }),
);

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: (typeof mutationOptionsMock)[number]) => {
    mutationOptionsMock.push(options);
    return {
      mutate: (variables?: unknown) => {
        mutationMutateMock(variables);
        void Promise.resolve()
          .then(() => options.mutationFn?.(variables))
          .then(
            (data) => void options.onSuccess?.(data),
            (error: Error) => options.onError?.(error),
          );
      },
      isPending: false,
    };
  },
  useQuery: (options: (typeof queryOptionsMock)[number]) => {
    queryOptionsMock.push(options);
    return {
      data: {
        data: [
          {
            id: ruleStateMock.id,
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
            conditions: ruleStateMock.conditions,
            evidence_requirements: ruleStateMock.evidenceRequirements,
            amount: 100,
            source_url: null,
            source_note: null,
            is_system: false,
            is_active: true,
            created_at: '2026-06-19T00:00:00.000Z',
            updated_at: '2026-06-19T00:00:00.000Z',
          },
          {
            id: 'rule_system',
            org_id: 'org_1',
            billing_scope: 'home_care',
            rule_type: 'base',
            service_type: 'home_care',
            payer_basis: 'medical',
            provider_scope: null,
            selection_mode: 'automatic',
            calculation_unit: 'point',
            name: '基本報酬',
            code: 'BASE',
            conditions: {},
            evidence_requirements: {},
            amount: 1000,
            source_url: 'https://example.test/source',
            source_note: null,
            is_system: true,
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
    };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/lib/billing-rules/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/billing-rules/api-paths')>();
  return {
    ...actual,
    buildBillingRuleApiPath: vi.fn(actual.buildBillingRuleApiPath),
  };
});

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

function queryFnAt(index: number) {
  const queryFn = queryOptionsMock[index]?.queryFn;
  if (typeof queryFn !== 'function') throw new Error(`Missing queryFn at index ${index}`);
  return queryFn;
}

function mutationFnAt(index: number) {
  const mutationFn = mutationOptionsMock[index]?.mutationFn;
  if (typeof mutationFn !== 'function') throw new Error(`Missing mutationFn at index ${index}`);
  return mutationFn;
}

function fetchCallsForMethod(method: string) {
  return vi
    .mocked(global.fetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
}

function expectNoSensitiveToastLeak(rawId: string, ...sensitiveValues: string[]) {
  expect(vi.mocked(toast.error)).toHaveBeenCalled();
  const message = String(vi.mocked(toast.error).mock.calls.at(-1)?.[0] ?? '');

  expect(message).not.toContain(rawId);
  expect(message).not.toContain(BILLING_RULES_API_PATH);
  expect(message).not.toContain(`${BILLING_RULES_API_PATH}/${rawId}`);
  expect(message).not.toContain('conditions');
  expect(message).not.toContain('evidence_requirements');
  for (const value of sensitiveValues) {
    expect(message).not.toContain(value);
  }
}

describe('BillingRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptionsMock.length = 0;
    queryOptionsMock.length = 0;
    ruleStateMock.id = 'rule_1';
    ruleStateMock.conditions = {};
    ruleStateMock.evidenceRequirements = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [], message: 'ok' }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prioritizes the billing rules workbench over the generic admin intro', () => {
    render(<BillingRulesPage />);

    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(screen.getByLabelText('請求ルールSSOT状態')).toBeTruthy();
    expect(screen.getByText('公式SSOTと任意ルールを照合')).toBeTruthy();
    expect(screen.getByText('local / push')).toBeTruthy();
  });

  it('keeps high-risk billing rule actions at the PH-OS 44px target', () => {
    render(<BillingRulesPage />);

    expect(screen.getByRole('button', { name: '公式SSOT同期' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: '任意ルール追加' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: '夜間加算 を編集' }).className).toContain('size-11');
    expect(screen.getByRole('button', { name: '夜間加算 を削除' }).className).toContain('size-11');
  });

  it('names the billing rule delete action and requires confirmation', async () => {
    render(<BillingRulesPage />);

    fireEvent.click(screen.getByRole('button', { name: '夜間加算 を削除' }));

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '算定ルールを削除しますか？' })).toBeTruthy();
    expect(screen.getByText('「夜間加算」を削除します。この操作は取り消せません。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(mutationMutateMock).toHaveBeenCalledWith('rule_1');
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
  });

  it('explains why system billing rules cannot be edited or deleted', () => {
    render(<BillingRulesPage />);

    const editButton = screen.getByRole('button', { name: '基本報酬 を編集' }) as HTMLButtonElement;
    const deleteButton = screen.getByRole('button', {
      name: '基本報酬 を削除',
    }) as HTMLButtonElement;

    expect(editButton.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
    const reasonId = editButton.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(deleteButton.getAttribute('aria-describedby')).toBe(reasonId);
    expect(document.getElementById(reasonId ?? '')?.textContent).toBe(
      '公式SSOTルールは編集・削除できません。',
    );
    expect(screen.getByText('公式SSOTルールは編集・削除できません。')).toBeTruthy();
  });

  it('collection GET uses the billing-rules collection API path', async () => {
    render(<BillingRulesPage />);

    await queryFnAt(0)();

    expect(global.fetch).toHaveBeenCalledWith(BILLING_RULES_API_PATH);
  });

  it('SSOT sync POST uses the collection API path and preserves the seed action body', async () => {
    render(<BillingRulesPage />);

    await mutationFnAt(0)();

    expect(global.fetch).toHaveBeenCalledWith(
      BILLING_RULES_API_PATH,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_home_care_ssot' }),
      }),
    );
  });

  it('create POST uses the collection API path and preserves the payload', async () => {
    const payload = {
      rule_type: 'addition',
      name: '休日加算',
      code: 'HOLIDAY',
      conditions: { service_day: 'holiday' },
      amount: 120,
      is_active: true,
    };
    render(<BillingRulesPage />);

    await mutationFnAt(1)(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      BILLING_RULES_API_PATH,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  });

  it('update PATCH encodes a hostile detail id and preserves method, headers, and body', async () => {
    const ruleId = 'rule/1 space?mode=x#frag';
    const body = {
      name: '夜間加算更新',
      code: 'YAKAN2',
      conditions: { visit_window: 'night' },
      amount: 150,
      is_active: false,
    };
    render(<BillingRulesPage />);

    await mutationFnAt(2)({ id: ruleId, body });

    expect(buildBillingRuleApiPath).toHaveBeenCalledWith(ruleId);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/billing-rules/${encodeURIComponent(ruleId)}`,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  });

  it('delete DELETE encodes a hostile detail id', async () => {
    const ruleId = 'rule/1 space?mode=x#frag';
    render(<BillingRulesPage />);

    await mutationFnAt(3)(ruleId);

    expect(buildBillingRuleApiPath).toHaveBeenCalledWith(ruleId);
    expect(global.fetch).toHaveBeenCalledWith(`/api/billing-rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    });
  });

  it('update with an exact dot-segment id fails before PATCH and does not leak sensitive rule data', async () => {
    ruleStateMock.id = '.';
    ruleStateMock.conditions = { secret_condition: 'condition-leak' };
    ruleStateMock.evidenceRequirements = { secret_evidence: 'evidence-leak' };
    render(<BillingRulesPage />);

    fireEvent.click(screen.getByRole('button', { name: '夜間加算 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(buildBillingRuleApiPath).toHaveBeenCalledWith('.'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());

    expect(fetchCallsForMethod('PATCH')).toHaveLength(0);
    expectNoSensitiveToastLeak('.', 'condition-leak', 'evidence-leak');
  });

  it('delete with an exact dot-segment id fails before DELETE and does not leak sensitive rule data', async () => {
    ruleStateMock.id = '..';
    ruleStateMock.conditions = { secret_condition: 'condition-leak' };
    ruleStateMock.evidenceRequirements = { secret_evidence: 'evidence-leak' };
    render(<BillingRulesPage />);

    fireEvent.click(screen.getByRole('button', { name: '夜間加算 を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(buildBillingRuleApiPath).toHaveBeenCalledWith('..'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());

    expect(fetchCallsForMethod('DELETE')).toHaveLength(0);
    expectNoSensitiveToastLeak('..', 'condition-leak', 'evidence-leak');
  });
});
