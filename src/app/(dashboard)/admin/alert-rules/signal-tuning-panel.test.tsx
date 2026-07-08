// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildDrugAlertRuleApiPath } from '@/lib/drug-alert-rules/api-paths';
import { SignalTuningPanel } from './signal-tuning-panel';
import type { SignalTuningRule } from './signal-tuning.shared';

setupDomTestEnv();

const orgIdMock = vi.hoisted(() => ({ value: 'org_1' }));
vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => orgIdMock.value,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the tests
// prove the panel DELEGATES to them (a raw inline literal lacks the sentinel, so a
// deep-equal on the sentinel object fails for un-converged code). The alert-rule
// API path helper is mocked with its real implementation so tests can assert
// callsite delegation while retaining hostile-encode and dot fail-fast teeth.
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-org-id': orgId, 'x-test-helper': 'orgHeaders' })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-org-id': orgId,
    'x-test-helper': 'orgJsonHeaders',
  })),
);
vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/drug-alert-rules/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/drug-alert-rules/api-paths')>();
  return {
    ...actual,
    buildDrugAlertRuleApiPath: vi.fn(actual.buildDrugAlertRuleApiPath),
  };
});

function renderPanel() {
  return render(<SignalTuningPanel />, { wrapper: createQueryClientWrapper() });
}

/** A fetch stub that serves `rules` on the GET and 200s every POST/PATCH. */
function stubFetch(
  rules: SignalTuningRule[],
  metadata: Partial<{
    total_count: number;
    visible_count: number;
    hidden_count: number;
    truncated: boolean;
  }> = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/drug-alert-rules' && !init?.method) {
      return new Response(
        JSON.stringify({
          data: rules,
          meta: {
            total_count: metadata.total_count ?? rules.length,
            visible_count: metadata.visible_count ?? rules.length,
            hidden_count: metadata.hidden_count ?? 0,
            truncated: metadata.truncated ?? false,
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The 強く表示/標準 toggle button inside the list row for a given item label (re-queried fresh). */
function toggleButton(label: string) {
  const row = screen.getByText(label).closest('li');
  if (!row) throw new Error(`row not found for ${label}`);
  return within(row).getByRole('button');
}

function saveButton() {
  return screen.getByRole('button', { name: /件の変更を保存/ }) as HTMLButtonElement;
}

function findPostCall(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === '/api/drug-alert-rules' &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SignalTuningPanel', () => {
  beforeEach(() => {
    orgIdMock.value = 'org_1';
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it('GET rules delegates to buildOrgHeaders(orgId) instead of a raw x-org-id literal', async () => {
    const fetchMock = stubFetch([]);
    renderPanel();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/drug-alert-rules', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('create (POST) delegates to buildOrgJsonHeaders and posts to the static collection path', async () => {
    const fetchMock = stubFetch([]); // no existing rule -> toggling strong creates one
    renderPanel();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    // wait for the panel to render after the query settles (isPending false) before toggling
    await screen.findByText('腎機能に注意');
    fireEvent.click(toggleButton('腎機能に注意'));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => expect(findPostCall(fetchMock)).toBeTruthy());
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const init = findPostCall(fetchMock)![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      alert_type: 'renal_dose',
      severity: 'critical',
      is_active: true,
    });
  });

  it('deactivate (PATCH) encodes a hostile rule id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetch([
      { id: 'a/b c', alert_type: 'renal_dose', severity: 'critical', is_active: true },
    ]);
    renderPanel();

    // active critical rule -> once loaded the row toggle reads 強く表示
    await waitFor(() => expect(toggleButton('腎機能に注意').textContent).toContain('強く表示'));
    fireEvent.click(toggleButton('腎機能に注意')); // -> 標準 (deactivate)
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drug-alert-rules/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const patchCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/drug-alert-rules/a%2Fb%20c',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ is_active: false });
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('activate (PATCH) encodes a hostile rule id and sends is_active:true', async () => {
    const fetchMock = stubFetch([
      // renal_dose exists but inactive -> toggling strong ACTIVATES it (PATCH)
      { id: 'x/y z', alert_type: 'renal_dose', severity: 'critical', is_active: false },
      // an active sibling is the load sentinel (observable 強く表示 once data is in)
      { id: 'pim_1', alert_type: 'pim_elderly', severity: 'critical', is_active: true },
    ]);
    renderPanel();

    await waitFor(() => expect(toggleButton('高齢者の注意薬').textContent).toContain('強く表示'));
    fireEvent.click(toggleButton('腎機能に注意')); // 標準 -> 強く表示 (activate)
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drug-alert-rules/x%2Fy%20z',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const patchCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/drug-alert-rules/x%2Fy%20z',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ is_active: true });
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('x/y z');
  });

  it('PATCH with a dot-segment rule id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetch([
      { id: '.', alert_type: 'renal_dose', severity: 'critical', is_active: true },
    ]);
    renderPanel();

    await waitFor(() => expect(toggleButton('腎機能に注意').textContent).toContain('強く表示'));
    fireEvent.click(toggleButton('腎機能に注意')); // -> deactivate the dot-id rule
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());

    // the shared path helper throws inside the mutationFn before fetch -> onError, no PATCH.
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('.');
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('fails closed with a retryable error instead of a misleading all-standard panel when the fetch fails', async () => {
    // A failed rules fetch must not render the tuning panel with every signal defaulted to
    // 標準 — on a patient-safety surface that false-empty misrepresents the saved emphasis.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/drug-alert-rules' && !init?.method) {
        return new Response(
          JSON.stringify({
            message:
              'boom patient_name=山田 太郎 storage_key=s3://secret token=secret /api/drug-alert-rules?debug=1',
          }),
          { status: 500 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    expect(await screen.findByText('表示設定を取得できませんでした')).toBeTruthy();
    // the misleading panel (with all-standard signals) must not render on fetch failure
    expect(screen.queryByTestId('signal-tuning-panel')).toBeNull();
    expect(screen.queryByText(/patient_name=山田/)).toBeNull();
    expect(screen.queryByText(/storage_key/)).toBeNull();
    expect(screen.queryByText(/token=secret/)).toBeNull();
    expect(screen.queryByText(/\/api\/drug-alert-rules/)).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));
    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(
        ([u, i]) =>
          String(u) === '/api/drug-alert-rules' && !(i as RequestInit | undefined)?.method,
      );
      expect(getCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('pauses saving when the alert-rule list is truncated', async () => {
    const fetchMock = stubFetch(
      [{ id: 'high_1', alert_type: 'high_risk', severity: 'critical', is_active: true }],
      { total_count: 3, visible_count: 1, hidden_count: 2, truncated: true },
    );
    renderPanel();

    expect(await screen.findByText(/他2件が非表示のため/)).toBeTruthy();
    fireEvent.click(toggleButton('腎機能に注意'));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(saveButton());

    const postCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input) === '/api/drug-alert-rules' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  it('shows loading (not the all-standard panel) while orgId is unresolved and the query is disabled', () => {
    // useOrgId returns '' until the auth store resolves, so enabled: !!orgId keeps the query
    // pending-but-not-fetching (isPending true, isLoading false). The misleading all-標準
    // panel must not render, and no fetch should fire.
    orgIdMock.value = '';
    const fetchMock = stubFetch([]);
    renderPanel();

    expect(screen.getByTestId('signal-tuning-loading')).toBeTruthy();
    expect(screen.getByRole('status', { name: '表示設定を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('表示設定を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByTestId('signal-tuning-panel')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
