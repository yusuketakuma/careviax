// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildAdminExternalProfessionalApiPath,
  buildAdminExternalProfessionalPatientsApiPath,
} from '@/lib/external-professionals/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  ExternalProfessionalsContent,
  type ExternalProfessional,
} from './external-professionals-content';

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

vi.mock('@/lib/external-professionals/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/external-professionals/api-paths')>();
  return {
    ...actual,
    buildAdminExternalProfessionalApiPath: vi.fn(actual.buildAdminExternalProfessionalApiPath),
    buildAdminExternalProfessionalPatientsApiPath: vi.fn(
      actual.buildAdminExternalProfessionalPatientsApiPath,
    ),
  };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return {
    ...actual,
    buildPatientHref: vi.fn(actual.buildPatientHref),
  };
});

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    errorMessage,
    onRetry,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (args: { row: { original: unknown } }) => ReactNode;
    }>;
    data: unknown[];
    errorMessage?: string;
    onRetry?: () => void;
  }) => (
    <div>
      {errorMessage ? (
        <div role="alert">
          <p>{errorMessage}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}
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

function renderContent() {
  return render(<ExternalProfessionalsContent />, { wrapper: createQueryClientWrapper() });
}

function professionalFixture(id = 'external_1'): ExternalProfessional {
  return {
    id,
    profession_type: 'nurse',
    name: '青葉 訪問看護',
    facility_id: 'facility_1',
    facility_name: 'さくら荘',
    organization_name: 'あおば訪看',
    department: '北ステーション',
    phone: '03-1111-2222',
    email: 'aoba@example.com',
    fax: '03-1111-2223',
    preferred_contact_method: 'fax',
    preferred_contact_time: '平日13時以降',
    last_contacted_at: '2026-06-30T04:00:00.000Z',
    last_success_channel: 'fax',
    address: '東京都千代田区1-1',
    notes: '報告書はFAX優先',
    patient_count: 2,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
  };
}

function linkedPatientsResponseFixture() {
  return {
    data: [
      {
        id: 'link_1',
        role: 'nurse',
        is_primary: true,
        case_id: 'case_1',
        case_status: 'active',
        patient_id: 'patient_1',
        patient_name: '山田 花子',
        patient_name_kana: 'ヤマダ ハナコ',
        archived_at: null,
        archive: { status: 'active', archived: false, archived_at: null },
      },
    ],
    metadata: {
      limit: 20,
      total_count: 2,
      visible_count: 1,
      hidden_count: 1,
      has_more: true,
      count_basis: 'care_team_links',
    },
  };
}

function stubFetchWithProfessional(
  professional = professionalFixture(),
  linkedPatientsResponse: unknown = linkedPatientsResponseFixture(),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method;

    if (url === '/api/admin/external-professionals?' && !method) {
      return new Response(
        JSON.stringify({
          data: [professional],
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
        }),
        { status: 200 },
      );
    }

    if (url === '/api/admin/facilities?' && !method) {
      return new Response(JSON.stringify({ data: [{ id: 'facility_1', name: 'さくら荘' }] }), {
        status: 200,
      });
    }

    if (
      url.includes('/patients?') &&
      url.startsWith('/api/admin/external-professionals/') &&
      !method
    ) {
      return new Response(JSON.stringify(linkedPatientsResponse), { status: 200 });
    }

    if (url === '/api/admin/external-professionals' && method === 'POST') {
      return new Response(JSON.stringify({ data: { ...professional, id: 'external_new' } }), {
        status: 201,
      });
    }

    if (url.startsWith('/api/admin/external-professionals/') && method === 'PATCH') {
      return new Response(JSON.stringify({ data: professional }), { status: 200 });
    }

    if (url.startsWith('/api/admin/external-professionals/') && method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ExternalProfessionalsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetchWithProfessional();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real external professional data instead of the fabricated sample master editor', async () => {
    renderContent();

    expect(await screen.findByText('青葉 訪問看護')).toBeTruthy();
    expect(screen.getByText('さくら荘')).toBeTruthy();
    expect(screen.queryByText('実データ接続待ちのマスターです。')).toBeNull();
    expect(screen.queryByText('医療機関マスター1')).toBeNull();
  });

  it('GET external professionals and facility options delegate to buildOrgHeaders(orgId)', async () => {
    const fetchMock = stubFetchWithProfessional();
    renderContent();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/external-professionals?', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/facilities?', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('keeps list actions and search at the PH-OS touch target size', async () => {
    renderContent();

    for (const name of ['新規登録', '青葉 訪問看護 を編集', '青葉 訪問看護 を削除']) {
      const control = await screen.findByRole('button', { name });
      expect(control.className).toContain('!h-11');
      expect(control.className).toContain('!min-h-[44px]');
    }

    expect(screen.getByLabelText('検索').className).toContain('!h-11');
    expect(screen.getByLabelText('検索').className).toContain('!min-h-[44px]');
  });

  it('PATCH uses the encoded external professional path and buildOrgJsonHeaders', async () => {
    const professional = professionalFixture('external/1?x');
    const fetchMock = stubFetchWithProfessional(professional);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を編集' }));
    fireEvent.change(screen.getByLabelText('部署'), {
      target: { value: '南ステーション' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const encodedPath = `/api/admin/external-professionals/${encodeURIComponent(professional.id)}`;
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        encodedPath,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(buildAdminExternalProfessionalApiPath).toHaveBeenCalledWith(professional.id);
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === encodedPath && (init as RequestInit)?.method === 'PATCH',
    );
    const init = patchCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: '青葉 訪問看護',
      department: '南ステーション',
      facility_id: 'facility_1',
      preferred_contact_method: 'fax',
    });
  });

  it('loads linked patients in the edit sheet with counted metadata and patient navigation helpers', async () => {
    const fetchMock = stubFetchWithProfessional();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を編集' }));

    const linkedPatientsRegion = await screen.findByRole('region', { name: '担当患者' });
    expect(await within(linkedPatientsRegion).findByText('山田 花子')).toBeTruthy();
    expect(within(linkedPatientsRegion).getByText('ヤマダ ハナコ / 訪問看護師')).toBeTruthy();
    expect(within(linkedPatientsRegion).getByText('総数 2件')).toBeTruthy();
    expect(within(linkedPatientsRegion).getByText('表示 1件')).toBeTruthy();
    expect(within(linkedPatientsRegion).getByText('非表示 1件')).toBeTruthy();
    expect(
      within(linkedPatientsRegion).getByRole('link', { name: '山田 花子' }).getAttribute('href'),
    ).toBe('/patients/patient_1');

    const linkedPatientsPath = '/api/admin/external-professionals/external_1/patients?limit=20';
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(linkedPatientsPath, {
        headers: buildOrgHeaders('org_1'),
      });
    });
    const patientsPathCall = vi
      .mocked(buildAdminExternalProfessionalPatientsApiPath)
      .mock.calls.find(([externalProfessionalId]) => externalProfessionalId === 'external_1');
    expect(patientsPathCall?.[1].toString()).toBe('limit=20');
    expect(buildPatientHref).toHaveBeenCalledWith('patient_1');
  });

  it('announces a linked-patient skeleton while assigned patients are loading', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;

      if (url === '/api/admin/external-professionals?' && !method) {
        return new Response(
          JSON.stringify({
            data: [professionalFixture()],
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
            truncated: false,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/admin/facilities?' && !method) {
        return new Response(JSON.stringify({ data: [{ id: 'facility_1', name: 'さくら荘' }] }), {
          status: 200,
        });
      }
      if (url === '/api/admin/external-professionals/external_1/patients?limit=20' && !method) {
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を編集' }));

    const linkedPatientsRegion = await screen.findByRole('region', { name: '担当患者' });
    expect(
      await within(linkedPatientsRegion).findByRole('status', {
        name: '担当患者を読み込み中',
      }),
    ).toBeTruthy();
    expect(within(linkedPatientsRegion).queryByText('担当患者を読み込み中...')).toBeNull();
    expect(
      within(linkedPatientsRegion).queryByText('この他職種に紐づく患者はありません。'),
    ).toBeNull();
  });

  it('does not collapse linked-patient query failures into an empty assigned-patient state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      if (url === '/api/admin/external-professionals?' && !method) {
        return new Response(
          JSON.stringify({
            data: [professionalFixture()],
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
            truncated: false,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/admin/facilities?' && !method) {
        return new Response(JSON.stringify({ data: [{ id: 'facility_1', name: 'さくら荘' }] }), {
          status: 200,
        });
      }
      if (url === '/api/admin/external-professionals/external_1/patients?limit=20' && !method) {
        return new Response(JSON.stringify({ message: 'failed' }), { status: 500 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を編集' }));

    expect(await screen.findByText('担当患者を取得できませんでした')).toBeTruthy();
    expect(screen.getByText('担当患者なしとして扱いません。', { exact: false })).toBeTruthy();
    expect(screen.queryByText('この他職種に紐づく患者はありません。')).toBeNull();
  });

  it('POST creates a normalized external professional payload', async () => {
    const fetchMock = stubFetchWithProfessional();
    renderContent();

    await screen.findByRole('button', { name: '青葉 訪問看護 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('氏名'), {
      target: { value: '  緑川 ケアマネ  ' },
    });
    fireEvent.change(screen.getByLabelText('所属名'), {
      target: { value: '  緑川居宅介護支援  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/external-professionals',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/admin/external-professionals' &&
        (init as RequestInit)?.method === 'POST',
    );
    const init = postCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      profession_type: 'nurse',
      name: '緑川 ケアマネ',
      organization_name: '緑川居宅介護支援',
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty('facility_id');
  });

  it('keeps the existing name blocker reactive and prevents invalid create requests', async () => {
    const fetchMock = stubFetchWithProfessional();
    renderContent();

    await screen.findByRole('button', { name: '青葉 訪問看護 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

    expect(screen.getByText('氏名は必須です。')).toBeTruthy();
    let saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('氏名'), {
      target: { value: '佐藤 訪問看護' },
    });
    expect(screen.queryByText('氏名は必須です。')).toBeNull();
    saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('氏名'), {
      target: { value: '   ' },
    });
    expect(screen.getByText('氏名は必須です。')).toBeTruthy();
    saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);

    expect(fetchMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          '/api/admin/external-professionals',
          expect.objectContaining({ method: 'POST' }),
        ]),
      ]),
    );
  });

  it('prevents deleting an external professional that is linked to patients', async () => {
    renderContent();

    const deleteButton = await screen.findByRole('button', { name: '青葉 訪問看護 を削除' });
    expect(deleteButton).toHaveProperty('disabled', true);
    expect(screen.getByText('削除前にケアチーム解除が必要')).toBeTruthy();
  });

  it('confirms deletion for unlinked external professionals before calling DELETE', async () => {
    const fetchMock = stubFetchWithProfessional({
      ...professionalFixture(),
      patient_count: 0,
    });
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を削除' }));

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/external-professionals/external_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(
      screen.getByRole('alertdialog', { name: '他職種マスターを削除しますか？' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/external-professionals/external_1',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
  });

  it('fails closed before PATCH when the external professional id is a dot segment', async () => {
    const fetchMock = stubFetchWithProfessional({
      ...professionalFixture('.'),
      patient_count: 0,
    });
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '青葉 訪問看護 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Path segment cannot be a dot segment'),
    );
    expect(fetchMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringMatching(/^\/api\/admin\/external-professionals\/\./),
          expect.objectContaining({ method: 'PATCH' }),
        ]),
      ]),
    );
  });

  it('does not collapse query failures into an empty external professional list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/external-professionals?') {
        return new Response(JSON.stringify({ message: 'failed' }), { status: 500 });
      }
      if (url === '/api/admin/facilities?') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    expect(await screen.findByText('他職種マスターを取得できませんでした')).toBeTruthy();
    expect(screen.getByText('他職種マスター一覧を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('他職種はまだ登録されていません')).toBeNull();
  });
});
