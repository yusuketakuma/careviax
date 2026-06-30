// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildAdminFacilityApiPath } from '@/lib/facilities/api-paths';
import { FacilitiesContent, type Facility, type FacilityUnit } from './facilities-content';

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

vi.mock('@/lib/facilities/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/facilities/api-paths')>();
  return {
    ...actual,
    buildAdminFacilityApiPath: vi.fn(actual.buildAdminFacilityApiPath),
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
  return render(<FacilitiesContent />, { wrapper: createWrapper() });
}

function facilityFixture(id = 'facility_1'): Facility {
  return {
    id,
    name: 'グリーンヒル',
    facility_type: 'nursing_home',
    address: '東京都千代田区1-1',
    phone: '03-1111-2222',
    fax: '03-1111-2223',
    acceptance_time_from: '09:00',
    acceptance_time_to: '17:00',
    regular_visit_weekdays: [1, 3, 5],
    notes: '鍵は事務所',
    patient_count: 2,
    updated_at: '2026-06-30T10:00:00.000Z',
    contacts: [
      {
        id: 'contact_1',
        name: '佐藤 施設長',
        role: '施設長',
        phone: '03-2222-3333',
        email: 'sato@example.com',
        fax: '03-2222-3334',
        is_primary: true,
        notes: '午前中優先',
      },
    ],
  };
}

function unitFixture(id = 'unit_1'): FacilityUnit {
  return {
    id,
    name: '2F 東',
    floor: '2F',
    unit_type: 'wing',
    capacity: 24,
    notes: 'エレベーター東側',
    display_order: 1,
    patient_count: 3,
  };
}

function stubFetchWithFacility(
  facility = facilityFixture(),
  units: FacilityUnit[] = [unitFixture()],
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/admin/facilities?' && !init?.method) {
      return new Response(
        JSON.stringify({
          data: [facility],
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
        }),
        { status: 200 },
      );
    }

    if (url === `/api/admin/facilities/${encodeURIComponent(facility.id)}/units` && !init?.method) {
      return new Response(JSON.stringify({ data: units }), { status: 200 });
    }

    if (url === '/api/admin/facilities' && init?.method === 'POST') {
      return new Response(JSON.stringify({ data: { ...facility, id: 'facility_new' } }), {
        status: 201,
      });
    }

    if (
      url === `/api/admin/facilities/${encodeURIComponent(facility.id)}/units` &&
      init?.method === 'POST'
    ) {
      return new Response(
        JSON.stringify({ data: { ...unitFixture('unit_new'), patient_count: 0 } }),
        {
          status: 201,
        },
      );
    }

    if (url.includes('/units/') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ data: units[0] ?? unitFixture() }), { status: 200 });
    }

    if (url.includes('/units/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (url.startsWith('/api/admin/facilities/') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ data: facility }), { status: 200 });
    }

    if (url.startsWith('/api/admin/facilities/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('FacilitiesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetchWithFacility();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real facility data instead of the fabricated sample master editor', async () => {
    renderContent();

    expect(await screen.findByText('グリーンヒル')).toBeTruthy();
    expect(screen.getByText('佐藤 施設長')).toBeTruthy();
    expect(screen.queryByText('実データ接続待ちのマスターです。')).toBeNull();
    expect(screen.queryByText('施設マスター1')).toBeNull();
  });

  it('GET facilities delegates to buildOrgHeaders(orgId)', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/facilities?', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('keeps list actions and search at the PH-OS touch target size', async () => {
    renderContent();

    for (const name of ['新規登録', 'グリーンヒル を編集', 'グリーンヒル を削除']) {
      const control = await screen.findByRole('button', { name });
      expect(control.className).toContain('!h-11');
      expect(control.className).toContain('!min-h-[44px]');
    }

    expect(screen.getByLabelText('検索').className).toContain('!h-11');
    expect(screen.getByLabelText('検索').className).toContain('!min-h-[44px]');
  });

  it('PATCH sends expected_updated_at and edited contacts through the encoded facility path', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: 'グリーンヒル を編集' }));
    fireEvent.change(screen.getByLabelText('施設名'), {
      target: { value: 'グリーンヒル東' },
    });
    fireEvent.change(screen.getByLabelText('担当者メモ'), {
      target: { value: '駐車場は裏口' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/facilities/facility_1',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildAdminFacilityApiPath).toHaveBeenCalledWith('facility_1');
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/admin/facilities/facility_1' &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      expected_updated_at: '2026-06-30T10:00:00.000Z',
      name: 'グリーンヒル東',
      contacts: [
        {
          id: 'contact_1',
          name: '佐藤 施設長',
          role: '施設長',
          phone: '03-2222-3333',
          email: 'sato@example.com',
          fax: '03-2222-3334',
          is_primary: true,
          notes: '駐車場は裏口',
        },
      ],
    });
  });

  it('POST creates a facility with normalized optional fields and org JSON headers', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    await screen.findByText('グリーンヒル');
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('施設名'), {
      target: { value: '新宿ケアホーム' },
    });
    fireEvent.change(screen.getByLabelText('住所'), {
      target: { value: '東京都新宿区2-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/facilities',
        expect.objectContaining({ method: 'POST', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/admin/facilities' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toMatchObject({
      name: '新宿ケアホーム',
      facility_type: 'nursing_home',
      address: '東京都新宿区2-2',
      contacts: [],
    });
  });

  it('loads facility units when editing a facility', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: 'グリーンヒル を編集' }));

    expect(await screen.findByText('2F 東')).toBeTruthy();
    expect(screen.getByText('入居患者 3名 / 表示順 1')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/facilities/facility_1/units', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('POST creates a facility unit through the encoded facility units path', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: 'グリーンヒル を編集' }));
    await screen.findByText('2F 東');
    fireEvent.click(screen.getByRole('button', { name: 'ユニットを追加' }));
    fireEvent.change(screen.getByLabelText('ユニット名'), {
      target: { value: '3F 西' },
    });
    fireEvent.change(screen.getByLabelText('階・棟'), {
      target: { value: '3F' },
    });
    fireEvent.change(screen.getByLabelText('定員'), {
      target: { value: '18' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ユニットを保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/facilities/facility_1/units',
        expect.objectContaining({ method: 'POST', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/admin/facilities/facility_1/units' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toMatchObject({
      name: '3F 西',
      floor: '3F',
      unit_type: 'unit',
      capacity: 18,
      display_order: 0,
    });
  });

  it('PATCH updates an existing facility unit through the encoded unit path', async () => {
    const fetchMock = stubFetchWithFacility();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: 'グリーンヒル を編集' }));
    fireEvent.click(await screen.findByRole('button', { name: '2F 東を編集' }));
    fireEvent.change(screen.getByLabelText('定員'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ユニットを保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/facilities/facility_1/units/unit_1',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/admin/facilities/facility_1/units/unit_1' &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toMatchObject({
      name: '2F 東',
      floor: '2F',
      unit_type: 'wing',
      capacity: 30,
      display_order: 1,
    });
  });

  it('fails closed before PATCH fetch when a facility id is an exact dot segment', async () => {
    const fetchMock = stubFetchWithFacility(facilityFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: 'グリーンヒル を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildAdminFacilityApiPath).toHaveBeenCalledWith('.');
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('passes query failures to DataTable instead of showing a false empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/admin/facilities?') {
          return new Response(JSON.stringify({ message: 'internal details' }), { status: 500 });
        }
        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderContent();

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent).join('\n')).toContain(
      '施設マスター一覧を取得できませんでした',
    );
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });
});
