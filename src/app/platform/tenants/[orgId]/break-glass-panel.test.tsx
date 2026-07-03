// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { BreakGlassPanel } from './break-glass-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, id }: PropsWithChildren<{ id?: string }>) => (
      <div id={id}>{children}</div>
    ),
    SelectValue: ({ children }: PropsWithChildren) => <span>{children}</span>,
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ value, children }: PropsWithChildren<{ value: string }>) => {
      const context = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

setupDomTestEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function stubSessionsFetch(sessions: unknown[]) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ sessions }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BreakGlassPanel', () => {
  it('shows field validation errors and does not submit when the reason is too short and credentials are missing', async () => {
    const fetchMock = stubSessionsFetch([]);

    render(<BreakGlassPanel orgId="org_1" tenantName="さくら薬局" />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByText('ブレークグラスアクセスを起動')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/アクセス理由/), { target: { value: '短い理由' } });
    fireEvent.click(screen.getByRole('button', { name: 'アクセスを起動' }));

    expect(await screen.findByText('アクセス理由を10文字以上で入力してください')).toBeTruthy();
    expect(screen.getByText('パスワードを入力してください')).toBeTruthy();
    expect(screen.getByText('MFAコードを入力してください')).toBeTruthy();

    // Client-side validation must block the POST — only the initial GET (active
    // session check) should have hit the network.
    const postCalls = fetchMock.mock.calls.filter(([, init]) => {
      const method = (init as RequestInit | undefined)?.method;
      return method === 'POST';
    });
    expect(postCalls).toHaveLength(0);
  });

  it('renders the active session card (with revoke action) when a session is already active for this org', async () => {
    stubSessionsFetch([
      {
        id: 'bg_1',
        target_org_id: 'org_1',
        reason: '障害調査のため確認します',
        reference_ticket: 'SUP-1',
        scope: 'read_only',
        status: 'active',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
    ]);

    render(<BreakGlassPanel orgId="org_1" tenantName="さくら薬局" />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByText('アクティブなブレークグラスセッション')).toBeTruthy();
    expect(screen.getByRole('button', { name: /セッションを終了/ })).toBeTruthy();
    expect(screen.queryByText('ブレークグラスアクセスを起動')).toBeNull();
  });
});
