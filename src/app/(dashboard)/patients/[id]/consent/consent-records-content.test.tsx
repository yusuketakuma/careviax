// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import {
  ConsentRecordsContent,
  fetchConsentRecords,
  fetchConsentTemplates,
} from './consent-records-content';

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
    SelectTrigger: ({
      children,
      id,
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedBy,
    }: PropsWithChildren<{
      id?: string;
      'aria-invalid'?: boolean;
      'aria-describedby'?: string;
    }>) => (
      <div id={id} aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy}>
        {children}
      </div>
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

function renderContent() {
  return render(<ConsentRecordsContent />, { wrapper: createQueryClientWrapper() });
}

type TestConsentRecord = {
  id: string;
  patient_id: string;
  template_id: string | null;
  template_version: number | null;
  template: { id: string; name: string; version: number } | null;
  consent_type: string;
  method: string;
  obtained_date: string;
  expiry_date: string | null;
  revoked_date: string | null;
  document_url: string | null;
  has_document_url: boolean;
  document_url_redacted: boolean;
  is_active: boolean;
  access_restricted: boolean;
  created_at: string;
};

const defaultConsentRecord: TestConsentRecord = {
  id: 'consent_1',
  patient_id: 'patient_1',
  template_id: null,
  template_version: null,
  template: null,
  consent_type: 'external_sharing',
  method: 'paper_scan',
  obtained_date: '2026-06-19T00:00:00.000Z',
  expiry_date: null,
  revoked_date: null,
  document_url: null,
  has_document_url: false,
  document_url_redacted: false,
  is_active: true,
  access_restricted: false,
  created_at: '2026-06-19T00:00:00.000Z',
};

function stubFetch(records: TestConsentRecord[] = [defaultConsentRecord]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/consent-records?patient_id=patient_1') {
      return new Response(
        JSON.stringify({
          data: records,
          hasMore: false,
          totalCount: records.length,
        }),
        {
          status: 200,
        },
      );
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
          },
        }),
        { status: 200 },
      );
    }
    if (url === '/api/consent-records') {
      return new Response(JSON.stringify({ id: 'consent_1' }), { status: 201 });
    }
    if (url === '/api/consent-records/consent_1' && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ id: 'consent_1' }), { status: 200 });
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

  it('surfaces API error messages when consent template lookup fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: '同意書テンプレート権限なし' }), { status: 403 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchConsentTemplates('org_1')).rejects.toThrow('同意書テンプレート権限なし');
    expect(fetchMock).toHaveBeenCalledWith('/api/templates?template_type=consent_form', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('surfaces API error messages when consent record lookup fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: '同意記録の閲覧権限がありません' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchConsentRecords('patient_1', 'org_1')).rejects.toThrow(
      '同意記録の閲覧権限がありません',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/consent-records?patient_id=patient_1', {
      headers: { 'x-org-id': 'org_1' },
    });
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

  it('keeps required create consent validation visible inline', async () => {
    const fetchMock = stubFetch();
    renderContent();

    const createButton = await screen.findByRole('button', { name: '新規同意取得' });
    fireEvent.click(createButton);

    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    expect(screen.getByRole('alert').textContent).toBe('同意種別を選択してください');
    expect(document.getElementById('consent_type')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('consent_type')?.getAttribute('aria-describedby')).toBe(
      'consent-type-error',
    );
    expect(toast.error).toHaveBeenCalledWith('同意種別を選択してください');
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === '/api/consent-records' && init?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '外部共有' }));
    const obtainedDate = screen.getByLabelText('取得日 *');
    fireEvent.change(obtainedDate, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    expect(screen.getByRole('alert').textContent).toBe('取得日を入力してください');
    expect(obtainedDate.getAttribute('aria-invalid')).toBe('true');
    expect(obtainedDate.getAttribute('aria-describedby')).toBe('obtained-date-error');
    expect(toast.error).toHaveBeenLastCalledWith('取得日を入力してください');
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === '/api/consent-records' && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('falls back when consent creation fails with an empty server message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/consent-records?patient_id=patient_1') {
        return new Response(
          JSON.stringify({
            data: [defaultConsentRecord],
            hasMore: false,
            totalCount: 1,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/templates?template_type=consent_form') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url === '/api/consent-records' && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '' }), { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '新規同意取得' }));
    fireEvent.click(screen.getByRole('button', { name: '外部共有' }));
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('同意記録の登録に失敗しました');
    });
  });

  it('updates active consent records with a replacement document_file_id only', async () => {
    const fetchMock = stubFetch();
    renderContent();

    fireEvent.click((await screen.findAllByRole('button', { name: '更新' }))[0]);

    fireEvent.change(screen.getByLabelText('有効期限'), {
      target: { value: '2026-12-31' },
    });
    const fileInput = screen.getByLabelText('同意書ファイル差し替え') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' })],
      },
    });
    const updateButtons = screen.getAllByRole('button', { name: '更新' });
    fireEvent.click(updateButtons[updateButtons.length - 1]);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/consent-records/consent_1' && init?.method === 'PATCH',
        ),
      ).toBe(true);
    });

    const presignCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/files/presigned-upload' && init?.method === 'POST',
    );
    expect(JSON.parse(String(presignCall?.[1]?.body))).toMatchObject({
      purpose: 'consent-document',
      patient_id: 'patient_1',
      file_name: 'replacement.pdf',
      mime_type: 'application/pdf',
      size_bytes: 11,
    });

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/consent-records/consent_1' && init?.method === 'PATCH',
    );
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    expect(patchBody).toEqual({
      expiry_date: '2026-12-31',
      document_file_id: 'file_1',
    });
    expect(patchBody).not.toHaveProperty('document_url');
  });

  it('does not show mutation actions for expired or revoked consent records', async () => {
    stubFetch([
      {
        ...defaultConsentRecord,
        id: 'consent_expired',
        expiry_date: '2026-01-01T00:00:00.000Z',
      },
      {
        ...defaultConsentRecord,
        id: 'consent_revoked',
        consent_type: 'photo_capture',
        is_active: false,
        revoked_date: '2026-02-01T00:00:00.000Z',
      },
    ]);
    renderContent();

    expect((await screen.findAllByText('期限切れ')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('撤回済')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '撤回' })).toBeNull();
  });

  it('does not expose legacy redacted consent document urls as links', async () => {
    stubFetch([
      {
        ...defaultConsentRecord,
        has_document_url: true,
        document_url_redacted: true,
      },
    ]);
    renderContent();

    expect((await screen.findAllByText('旧URL非表示')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /閲覧/ })).toBeNull();
  });

  it('loads active consent records by default', async () => {
    const fetchMock = stubFetch();
    renderContent();

    expect((await screen.findAllByText('外部共有')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('有効')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/consent-records?patient_id=patient_1', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('is_active=false'))).toBe(
      false,
    );
  });

  it('surfaces a retryable error instead of a false-empty table when consent fetch fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/consent-records?patient_id=patient_1') {
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    // 取得失敗を「同意記録ゼロ件」の空テーブルに化けさせず、エラー＋再読み込みを提示する。
    expect(await screen.findByText('同意記録を取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });
});
