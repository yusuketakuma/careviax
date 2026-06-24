// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { SignalTuningPanel } from './signal-tuning-panel';
import type { SignalTuningRule } from './signal-tuning.shared';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the tests
// prove the panel DELEGATES to them (a raw inline literal lacks the sentinel, so a
// deep-equal on the sentinel object fails for un-converged code). '@/lib/http/path-segment'
// is intentionally NOT mocked — the real encodePathSegment is exercised for the
// hostile-encode and dot fail-fast teeth.
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPanel() {
  return render(<SignalTuningPanel />, { wrapper: createWrapper() });
}

/** A fetch stub that serves `rules` on the GET and 200s every POST/PATCH. */
function stubFetch(rules: SignalTuningRule[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/drug-alert-rules' && !init?.method) {
      return new Response(JSON.stringify({ data: rules }), { status: 200 });
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

    // encodePathSegment('.') throws inside the mutationFn before fetch -> onError, no PATCH.
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });
});
