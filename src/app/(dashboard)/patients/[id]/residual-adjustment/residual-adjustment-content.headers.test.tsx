// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: () => 'org_1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// org-headers は実装そのまま使いつつ呼び出しを観測する(actual + spy)。
vi.mock('@/lib/api/org-headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

import { ResidualAdjustmentContent } from './residual-adjustment-content';

setupDomTestEnv();

// plan.rows を1件以上にし(確定ボタン有効)、visit_record_id を持たせ(写真追加有効)、
// 2つの GET と内部 POST・外部 PUT を実際に発火させる最小フィクスチャ。
const RESIDUAL_RECORD = {
  id: 'r1',
  visit_record_id: 'v1',
  drug_name: 'アムロジピン',
  prescribed_quantity: 14,
  remaining_quantity: 7,
  remaining_days: 7,
  excess_days: null,
  is_reduction_target: true,
  is_prohibited_reduction: false,
  created_at: '2026-01-01T00:00:00.000Z',
};

const UPLOAD_URL = 'https://s3.example.test/upload';

type FetchCall = { url: string; init?: RequestInit };

const DEFAULT_PATIENT_ID = 'patient_1';

function renderContent(patientId = DEFAULT_PATIENT_ID) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResidualAdjustmentContent patientId={patientId} />
    </QueryClientProvider>,
  );
}

describe('ResidualAdjustmentContent tenant headers', () => {
  let calls: FetchCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith('/api/residual-medications')) {
        return { ok: true, json: async () => ({ data: [RESIDUAL_RECORD] }) } as unknown as Response;
      }
      if (url.startsWith('/api/inquiry-records')) {
        return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
      }
      if (url === '/api/files/presigned-upload') {
        return {
          ok: true,
          json: async () => ({
            data: { uploadUrl: UPLOAD_URL, headers: { 'x-amz-acl': 'private' }, id: 'f1' },
          }),
        } as unknown as Response;
      }
      if (url === UPLOAD_URL) {
        return { ok: true, headers: { get: () => 'etag-1' } } as unknown as Response;
      }
      if (url === '/api/files/complete') {
        return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends both list GETs with the tenant header via buildOrgHeaders(org_1)', async () => {
    renderContent();
    await screen.findByTestId('residual-adjustment-page');

    await waitFor(() => {
      expect(calls.some((call) => call.url.startsWith('/api/residual-medications'))).toBe(true);
      expect(calls.some((call) => call.url.startsWith('/api/inquiry-records'))).toBe(true);
    });

    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    const getCalls = calls.filter(
      (call) =>
        call.url.startsWith('/api/residual-medications') ||
        call.url.startsWith('/api/inquiry-records'),
    );
    for (const call of getCalls) {
      expect((call.init?.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    }
  });

  it('encodes patient_id query values for both list GETs', async () => {
    const patientId = 'pt/1?tab=x#frag&status=open&limit=999';
    renderContent(patientId);
    await screen.findByTestId('residual-adjustment-page');

    await waitFor(() => {
      expect(calls.some((call) => call.url.startsWith('/api/residual-medications'))).toBe(true);
      expect(calls.some((call) => call.url.startsWith('/api/inquiry-records'))).toBe(true);
    });

    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([
        `/api/residual-medications?patient_id=${encodeURIComponent(patientId)}&limit=100`,
        `/api/inquiry-records?patient_id=${encodeURIComponent(patientId)}&status=resolved`,
      ]),
    );
    expect(calls.map((call) => call.url)).not.toEqual(
      expect.arrayContaining([
        `/api/residual-medications?patient_id=${patientId}&limit=100`,
        `/api/inquiry-records?patient_id=${patientId}&status=resolved`,
      ]),
    );
  });

  it('uses buildOrgJsonHeaders for internal POSTs but never leaks x-org-id to the external presigned PUT', async () => {
    const { container } = renderContent();
    await screen.findByTestId('residual-adjustment-page');
    await waitFor(() =>
      expect(calls.some((call) => call.url.startsWith('/api/residual-medications'))).toBe(true),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'residual.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(calls.some((call) => call.url === '/api/files/complete')).toBe(true);
    });

    // 内部 POST は JSON ヘッダビルダ経由で tenant 境界(x-org-id)+ Content-Type を保つ。
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    const presign = calls.find((call) => call.url === '/api/files/presigned-upload');
    expect((presign?.init?.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    expect((presign?.init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );

    // 外部 S3 への PUT には tenant ヘッダを足さず、presigned headers のみを使う。
    const put = calls.find((call) => call.url === UPLOAD_URL);
    expect(put?.init?.method).toBe('PUT');
    const putHeaders = (put?.init?.headers ?? {}) as Record<string, string>;
    expect(putHeaders['x-org-id']).toBeUndefined();
    expect(putHeaders['X-Org-Id']).toBeUndefined();
  });
});
