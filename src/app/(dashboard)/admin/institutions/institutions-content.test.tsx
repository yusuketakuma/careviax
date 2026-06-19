// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { InstitutionsContent } from './institutions-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (args: { row: { original: unknown } }) => ReactNode;
    }>;
    data: unknown[];
  }) => (
    <div>
      {data.map((row, rowIndex) => (
        <div key={rowIndex}>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={`${column.id ?? column.accessorKey ?? columnIndex}`}>
                {column.cell({ row: { original: row } })}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  ),
}));

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
  return render(<InstitutionsContent />, { wrapper: createWrapper() });
}

describe('InstitutionsContent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/prescriber-institutions?' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'institution_1',
                  name: '在宅内科クリニック',
                  institution_code: '1312345678',
                  address: '東京都千代田区1-1',
                  phone: '03-1111-2222',
                  fax: '03-1111-2223',
                  notes: '報告書はFAX優先',
                  prescription_count: 12,
                  last_prescribed_at: '2026-06-01',
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/prescriber-institutions/institution_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '医療機関マスターを削除しました' }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names institution row actions by target and confirms deletion first', async () => {
    renderContent();

    expect(await screen.findByRole('button', { name: '在宅内科クリニック を編集' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '在宅内科クリニック を削除' }));

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/prescriber-institutions/institution_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '医療機関を削除しますか？' })).toBeTruthy();
    expect(
      screen.getByText('在宅内科クリニック を削除します。この操作は取り消せません。'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/prescriber-institutions/institution_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });
});
