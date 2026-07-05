// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildVisitVehicleResourceApiPath } from '@/lib/visit-vehicle-resources/api-paths';
import type { VisitVehicleResource } from '@/types/api/visit-vehicle-resources';
import { VehiclesContent } from './vehicles-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

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

vi.mock('@/lib/visit-vehicle-resources/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/visit-vehicle-resources/api-paths')>();
  return {
    ...actual,
    buildVisitVehicleResourceApiPath: vi.fn(actual.buildVisitVehicleResourceApiPath),
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
  return render(<VehiclesContent />, { wrapper: createQueryClientWrapper() });
}

function vehicleFixture(id = 'vehicle_1'): VisitVehicleResource {
  return {
    id,
    site_id: 'site_1',
    label: '軽バン1号',
    vehicle_code: 'K-001',
    travel_mode: 'DRIVE',
    max_stops: 8,
    max_route_duration_minutes: 240,
    available: true,
    next_inspection_date: '2999-07-31T00:00:00.000Z',
    notes: '医療材料の常備あり',
    site: { id: 'site_1', name: '本店' },
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
  };
}

function stubFetchWithVehicle(vehicle = vehicleFixture()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method;

    if (url === '/api/visit-vehicle-resources?limit=200' && !method) {
      return new Response(
        JSON.stringify({
          data: [vehicle],
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
        }),
        { status: 200 },
      );
    }

    if (url === '/api/pharmacy-sites' && !method) {
      return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
        status: 200,
      });
    }

    if (url === '/api/visit-vehicle-resources' && method === 'POST') {
      return new Response(JSON.stringify({ data: { ...vehicle, id: 'vehicle_new' } }), {
        status: 201,
      });
    }

    if (url.startsWith('/api/visit-vehicle-resources/') && method === 'PATCH') {
      return new Response(JSON.stringify({ data: vehicle }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('VehiclesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetchWithVehicle();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real vehicle data instead of the fabricated sample master editor', async () => {
    renderContent();

    expect(await screen.findByText('軽バン1号')).toBeTruthy();
    expect(screen.getByText('管理番号 K-001')).toBeTruthy();
    expect(screen.getByText('本店')).toBeTruthy();
    expect(screen.queryByText('実データ接続待ちのマスターです。')).toBeNull();
    expect(screen.queryByText('車両マスター1')).toBeNull();
  });

  it('GET vehicle resources and site options delegate to buildOrgHeaders(orgId)', async () => {
    const fetchMock = stubFetchWithVehicle();
    renderContent();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/visit-vehicle-resources?limit=200', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('keeps list actions and search at the PH-OS touch target size', async () => {
    renderContent();

    for (const name of ['新規登録', '軽バン1号 を編集', '軽バン1号 を無効化']) {
      const control = await screen.findByRole('button', { name });
      expect(control.className).toContain('!h-11');
      expect(control.className).toContain('!min-h-[44px]');
    }

    expect(screen.getByLabelText('検索').className).toContain('!h-11');
    expect(screen.getByLabelText('検索').className).toContain('!min-h-[44px]');
  });

  it('POST creates a normalized vehicle resource payload', async () => {
    const fetchMock = stubFetchWithVehicle();
    renderContent();

    await screen.findByRole('button', { name: '軽バン1号 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('車両名'), {
      target: { value: '  社用車2号  ' },
    });
    fireEvent.change(screen.getByLabelText('管理番号'), {
      target: { value: '  CAR-02  ' },
    });
    fireEvent.change(screen.getByLabelText('最大訪問件数'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText('次回点検期限'), {
      target: { value: '2026-09-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-vehicle-resources',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-vehicle-resources' &&
        (init as RequestInit)?.method === 'POST',
    );
    const init = postCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      site_id: 'site_1',
      label: '社用車2号',
      vehicle_code: 'CAR-02',
      travel_mode: 'DRIVE',
      max_stops: 6,
      available: true,
      next_inspection_date: '2026-09-30',
    });
  });

  it('surfaces API error messages when vehicle save fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      if (url === '/api/visit-vehicle-resources?limit=200' && !method) {
        return new Response(
          JSON.stringify({
            data: [vehicleFixture()],
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
            truncated: false,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/pharmacy-sites' && !method) {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url === '/api/visit-vehicle-resources' && method === 'POST') {
        return new Response(JSON.stringify({ message: '車両コードが重複しています' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    await screen.findByRole('button', { name: '軽バン1号 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('車両名'), {
      target: { value: '社用車2号' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('車両コードが重複しています');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-vehicle-resources',
      expect.objectContaining({
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
      }),
    );
  });

  it('keeps existing save blockers reactive and prevents invalid create requests', async () => {
    const fetchMock = stubFetchWithVehicle();
    renderContent();

    await screen.findByRole('button', { name: '軽バン1号 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('車両名'), {
      target: { value: '社用車3号' },
    });
    fireEvent.change(screen.getByLabelText('最大訪問件数'), {
      target: { value: '0' },
    });

    expect(screen.getByText('最大訪問件数は1〜50件で指定してください。')).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);

    expect(fetchMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          '/api/visit-vehicle-resources',
          expect.objectContaining({ method: 'POST' }),
        ]),
      ]),
    );
  });

  it('PATCH uses the encoded vehicle path and buildOrgJsonHeaders', async () => {
    const vehicle = vehicleFixture('vehicle/1?x');
    const fetchMock = stubFetchWithVehicle(vehicle);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '軽バン1号 を編集' }));
    fireEvent.change(screen.getByLabelText('最大ルート時間（分）'), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const encodedPath = `/api/visit-vehicle-resources/${encodeURIComponent(vehicle.id)}`;
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        encodedPath,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(buildVisitVehicleResourceApiPath).toHaveBeenCalledWith(vehicle.id);
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === encodedPath && (init as RequestInit)?.method === 'PATCH',
    );
    const init = patchCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      label: '軽バン1号',
      vehicle_code: 'K-001',
      travel_mode: 'DRIVE',
      max_stops: 8,
      max_route_duration_minutes: 180,
      available: true,
      next_inspection_date: '2999-07-31',
      notes: '医療材料の常備あり',
    });
  });

  it('confirms disabling an active vehicle before calling PATCH', async () => {
    const fetchMock = stubFetchWithVehicle();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '軽バン1号 を無効化' }));

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/visit-vehicle-resources/vehicle_1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(screen.getByRole('alertdialog', { name: '車両を無効化しますか？' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-vehicle-resources/vehicle_1',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-vehicle-resources/vehicle_1' &&
        (init as RequestInit)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      available: false,
    });
  });

  it('surfaces API error messages when vehicle availability update fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      if (url === '/api/visit-vehicle-resources?limit=200' && !method) {
        return new Response(
          JSON.stringify({
            data: [vehicleFixture()],
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
            truncated: false,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/pharmacy-sites' && !method) {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url === '/api/visit-vehicle-resources/vehicle_1' && method === 'PATCH') {
        return new Response(JSON.stringify({ message: '稼働中の訪問予定がある車両です' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '軽バン1号 を無効化' }));
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('稼働中の訪問予定がある車両です');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-vehicle-resources/vehicle_1',
      expect.objectContaining({
        method: 'PATCH',
        headers: buildOrgJsonHeaders('org_1'),
      }),
    );
  });

  it('fails closed before PATCH when the vehicle id is a dot segment', async () => {
    const fetchMock = stubFetchWithVehicle(vehicleFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '軽バン1号 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Path segment cannot be a dot segment'),
    );
    expect(fetchMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringMatching(/^\/api\/visit-vehicle-resources\/\./),
          expect.objectContaining({ method: 'PATCH' }),
        ]),
      ]),
    );
  });

  it('does not collapse query failures into an empty vehicle list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/visit-vehicle-resources?limit=200') {
        return new Response(JSON.stringify({ message: 'failed' }), { status: 500 });
      }
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    expect(await screen.findByText('車両マスターを取得できませんでした')).toBeTruthy();
    expect(screen.getByText('車両マスター一覧を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('車両はまだ登録されていません')).toBeNull();
  });
});
