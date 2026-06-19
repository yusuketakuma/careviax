// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ConsentRecordsContent } from './consent-records-content';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'patient_1' }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = React.useContext(SelectContext);
      return <span>{context.value ?? placeholder}</span>;
    },
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
  return render(<ConsentRecordsContent />, { wrapper: createWrapper() });
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url === '/api/consent-records?patient_id=patient_1&is_active=false') {
      return new Response(JSON.stringify({ data: [], hasMore: false, totalCount: 0 }), {
        status: 200,
      });
    }
    if (url === '/api/templates?template_type=consent_form') {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url === '/api/files/presigned-upload') {
      return new Response(
        JSON.stringify({
          data: {
            id: 'file_1',
            uploadUrl: 'https://uploads.example.test/file_1',
            headers: { 'Content-Type': 'application/pdf' },
          },
        }),
        { status: 201 },
      );
    }
    if (url === 'https://uploads.example.test/file_1') {
      return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
    }
    if (url === '/api/files/complete') {
      return new Response(
        JSON.stringify({
          data: {
            id: 'file_1',
            originalName: 'consent.pdf',
          },
        }),
        { status: 200 },
      );
    }
    if (url === '/api/consent-records') {
      return new Response(JSON.stringify({ id: 'consent_1' }), { status: 201 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ConsentRecordsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads consent documents and creates consent records with document_file_id only', async () => {
    const fetchMock = stubFetch();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '新規同意取得' }));

    expect(screen.queryByLabelText('文書URL（任意）')).toBeNull();
    const fileInput = screen.getByLabelText('同意書ファイル（任意）') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: '外部共有' }));
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['consent'], 'consent.pdf', { type: 'application/pdf' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          return String(input) === '/api/consent-records' && init?.method === 'POST';
        }),
      ).toBe(true);
    });

    const presignCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/files/presigned-upload' && init?.method === 'POST',
    );
    expect(JSON.parse(String(presignCall?.[1]?.body))).toMatchObject({
      purpose: 'consent-document',
      patient_id: 'patient_1',
      file_name: 'consent.pdf',
      mime_type: 'application/pdf',
      size_bytes: 7,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://uploads.example.test/file_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: expect.any(File),
    });

    const completeCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/files/complete' && init?.method === 'POST',
    );
    expect(JSON.parse(String(completeCall?.[1]?.body))).toMatchObject({
      file_id: 'file_1',
      etag: 'etag_1',
    });

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/consent-records' && init?.method === 'POST',
    );
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody).toMatchObject({
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      method: 'paper_scan',
      document_file_id: 'file_1',
    });
    expect(createBody).not.toHaveProperty('document_url');
  });
});
