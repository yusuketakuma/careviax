// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildServiceAreaApiPath } from '@/lib/service-areas/api-paths';
import ServiceAreasPage from './page';

setupDomTestEnv();

const orgIdMock = vi.hoisted(() => ({ value: 'org_1' }));
vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => orgIdMock.value,
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the tests
// prove the page DELEGATES to them (a raw inline literal lacks the sentinel, so a
// deep-equal on the sentinel object fails for un-converged code). The service-area
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

vi.mock('@/lib/service-areas/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/service-areas/api-paths')>();
  return {
    ...actual,
    buildServiceAreaApiPath: vi.fn(actual.buildServiceAreaApiPath),
  };
});

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

// Base UI Select renders a portaled listbox that jsdom can't drive; mock it to a native
// <select> (carrying the trigger's id + className) so existing label/value assertions keep
// working and the >=44px touch-target class contract can be asserted.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectItems(children: ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: ReactNode };
      if (props.value) {
        items.push({ value: props.value, label: React.Children.toArray(props.children).join('') });
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  type TriggerProps = {
    id?: string;
    className?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
  };

  function findTriggerProps(children: ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (props.id) triggerProps = props;
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);
    return (
      <select
        id={triggerProps?.id}
        className={triggerProps?.className}
        aria-describedby={triggerProps?.['aria-describedby']}
        aria-invalid={triggerProps?.['aria-invalid']}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {collectItems(children).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select: MockSelect,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>,
  };
});

function renderPage() {
  return render(<ServiceAreasPage />, { wrapper: createQueryClientWrapper() });
}

function getServiceAreaFormElement() {
  const form = screen.getByLabelText('エリア名').closest('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('service area form was not rendered');
  }
  return form;
}

describe('ServiceAreasPage', () => {
  beforeEach(() => {
    orgIdMock.value = 'org_1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              data: [{ id: 'site_1', name: '本店' }],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/service-areas' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'area_1',
                  site_id: 'site_1',
                  name: '北多摩エリア',
                  area_type: 'radius',
                  geo_data: { match_keywords: ['北多摩'] },
                  notes: '16km 圏確認済み',
                  site: { id: 'site_1', name: '本店' },
                },
              ],
              meta: {
                total_count: 1,
                visible_count: 1,
                hidden_count: 0,
                truncated: false,
                count_basis: 'service_areas',
                filters_applied: { site_id: null },
                limit: 100,
              },
            }),
            { status: 200 },
          );
        }

        if (url === '/api/service-areas/area_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ data: { id: 'area_1' } }), {
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

  it('explains service area save blockers before mutation', async () => {
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    const saveButton = screen.getByRole('button', { name: '登録する' }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('service-area-save-blocker');
    expect(screen.getByText('拠点を選択してください。')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('拠点'), { target: { value: 'site_1' } });
    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '   ' } });

    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText('エリア名を入力してください。')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '新規エリア' } });
    fireEvent.change(screen.getByLabelText('エリア定義(JSON)'), { target: { value: '[]' } });

    expect(saveButton.disabled).toBe(true);
    expect(screen.getByLabelText('エリア定義(JSON)').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('service-area-geo-error')?.textContent).toBe(
      'エリア定義(JSON) の形式が不正です',
    );
    expect(document.getElementById('service-area-save-blocker')?.textContent).toBe(
      'エリア定義(JSON) の形式が不正です',
    );
  });

  it('shows the RHF error summary without mutating when the form is submitted invalid', async () => {
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    vi.mocked(global.fetch).mockClear();

    fireEvent.submit(getServiceAreaFormElement());

    const summaryTitle = await screen.findByText('入力内容を確認してください');
    const summary = summaryTitle.closest('[role="alert"]');
    expect(summary?.textContent).toContain('拠点');
    expect(summary?.textContent).toContain('拠点を選択してください。');
    const mutationCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method);
    expect(mutationCalls).toHaveLength(0);
  });

  it('requires confirmation before deleting a service area', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を削除' }));

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/service-areas/area_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '訪問エリアを削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '北多摩エリア（本店 / radius）を削除します。この操作は取り消せません。患者登録時の訪問エリア警告にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/service-areas/area_1',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('names edit actions by service area and loads that row into the form', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を編集' }));

    expect(screen.getByText('訪問エリアを編集')).toBeTruthy();
    expect((screen.getByLabelText('エリア名') as HTMLInputElement).value).toBe('北多摩エリア');
    expect((screen.getByLabelText('エリア種別') as HTMLSelectElement).value).toBe('radius');
    expect((screen.getByLabelText('備考') as HTMLTextAreaElement).value).toBe('16km 圏確認済み');
  });

  it('shows service-area list counts without treating a bounded page as the total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/pharmacy-sites') {
          return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
            status: 200,
          });
        }
        if (url === '/api/service-areas' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'area_1',
                  site_id: 'site_1',
                  name: '北多摩エリア',
                  area_type: 'radius',
                  geo_data: { match_keywords: ['北多摩'] },
                  notes: null,
                  site: { id: 'site_1', name: '本店' },
                },
              ],
              meta: {
                total_count: 3,
                visible_count: 1,
                hidden_count: 2,
                truncated: true,
                count_basis: 'service_areas',
                filters_applied: { site_id: null },
                limit: 100,
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );

    renderPage();

    expect(await screen.findByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(screen.queryByText('登録済み 1件')).toBeNull();
  });

  it('gives the site and area-type selects a >=44px touch target at all breakpoints (WCAG)', async () => {
    renderPage();

    await screen.findByRole('option', { name: '本店' });

    // 共有 SelectTrigger の既定は sm で min-h-0/h-8 へ縮むため、ページ側の sm:min-h-[44px]
    // 上書きまで assert し、将来このデスクトップ 44px 契約が落ちる退行を捕捉する。
    for (const label of ['拠点', 'エリア種別']) {
      const className = screen.getByLabelText(label).className;
      expect(className).toContain('min-h-[44px]');
      expect(className).toContain('sm:min-h-[44px]');
    }
  });

  // A fetch stub that serves the sites list and a single service area (with the given
  // id) and 200s every POST/PATCH/DELETE so the convergence teeth can assert call args.
  function stubFetchWithArea(areaId: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url === '/api/service-areas' && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: areaId,
                site_id: 'site_1',
                name: '北多摩エリア',
                area_type: 'radius',
                geo_data: { match_keywords: ['北多摩'] },
                notes: '16km 圏確認済み',
                site: { id: 'site_1', name: '本店' },
              },
            ],
            meta: {
              total_count: 1,
              visible_count: 1,
              hidden_count: 0,
              truncated: false,
              count_basis: 'service_areas',
              filters_applied: { site_id: null },
              limit: 100,
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

  it('both GET queries delegate to buildOrgHeaders(orgId)', async () => {
    const fetchMock = stubFetchWithArea('area_1');
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/service-areas', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('create (POST) delegates to buildOrgJsonHeaders and posts to the static collection path', async () => {
    const fetchMock = stubFetchWithArea('area_1');
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    fireEvent.change(screen.getByLabelText('拠点'), { target: { value: 'site_1' } });
    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '新規エリア' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/service-areas' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/service-areas' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect((postCall![1] as RequestInit).headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
      site_id: 'site_1',
      name: '新規エリア',
      area_type: 'radius',
      geo_data: {
        match_keywords: [],
        facility_ids: [],
      },
    });
  });

  it('surfaces API error messages when service area save fails', async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url === '/api/service-areas' && !init?.method) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url === '/api/service-areas' && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '同じ訪問エリアが既に存在します' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    fireEvent.change(screen.getByLabelText('拠点'), { target: { value: 'site_1' } });
    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '北多摩エリア' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('同じ訪問エリアが既に存在します');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/service-areas',
      expect.objectContaining({
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
      }),
    );
  });

  it('update (PATCH) encodes a hostile area id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetchWithArea('a/b c');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/service-areas/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildServiceAreaApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('update (PATCH) with a dot-segment area id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetchWithArea('.');
    vi.mocked(toast.error).mockClear();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildServiceAreaApiPath).toHaveBeenCalledWith('.');
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('DELETE encodes a hostile area id via encodePathSegment', async () => {
    const fetchMock = stubFetchWithArea('a/b c');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/service-areas/a%2Fb%20c',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildServiceAreaApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('surfaces API error messages when service area delete fails', async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url === '/api/service-areas' && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'area_1',
                site_id: 'site_1',
                name: '北多摩エリア',
                area_type: 'radius',
                geo_data: { match_keywords: ['北多摩'] },
                notes: null,
                site: { id: 'site_1', name: '本店' },
              },
            ],
            meta: {
              total_count: 1,
              visible_count: 1,
              hidden_count: 0,
              truncated: false,
              count_basis: 'service_areas',
              filters_applied: { site_id: null },
              limit: 100,
            },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/service-areas/area_1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ message: '利用中の訪問エリアは削除できません' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('利用中の訪問エリアは削除できません');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/service-areas/area_1',
      expect.objectContaining({
        method: 'DELETE',
        headers: buildOrgHeaders('org_1'),
      }),
    );
  });

  it('DELETE with a dot-segment area id fails closed before any DELETE fetch', async () => {
    const fetchMock = stubFetchWithArea('.');
    vi.mocked(toast.error).mockClear();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildServiceAreaApiPath).toHaveBeenCalledWith('.');
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('fails closed with a retryable error instead of a silently empty 拠点 selector when the sites fetch fails', async () => {
    // A failed sites fetch must not leave the 拠点 selector silently empty (no options,
    // save blocked with no explanation) — surface the error with a retry instead.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              message:
                'GET /api/pharmacy-sites?patient=田中一郎&storage_key=s3://phi-bucket/raw&token=secret',
            }),
            { status: 500 },
          );
        }
        if (url === '/api/service-areas' && !init?.method) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    renderPage();

    const retry = await screen.findByRole('button', { name: '再試行' });
    expect(screen.getByText('拠点一覧を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/訪問エリアに紐づける拠点を取得できませんでした。/)).toBeTruthy();
    expect(screen.getByText(/再試行して、登録先の拠点を選び直してください。/)).toBeTruthy();
    expect(screen.queryByText(/田中一郎/)).toBeNull();
    expect(screen.queryByText(/storage_key/)).toBeNull();
    expect(screen.queryByText(/token/)).toBeNull();
    expect(screen.queryByText(/\/api\/pharmacy-sites/)).toBeNull();

    fireEvent.click(retry);
    await waitFor(() => {
      const siteCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([u]) => String(u) === '/api/pharmacy-sites');
      expect(siteCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('fails closed with a retryable error instead of an empty-state when the areas fetch fails', async () => {
    // A failed areas fetch must not render the "まだ訪問エリアはありません" empty-state — that
    // false-empty reads as "no service areas" rather than "the fetch failed."
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/pharmacy-sites') {
          return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
            status: 200,
          });
        }
        if (url === '/api/service-areas' && !init?.method) {
          return new Response(
            JSON.stringify({
              message:
                'GET /api/service-areas?patient=田中一郎&storage_key=s3://phi-bucket/raw&provider_error=stack',
            }),
            { status: 500 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    renderPage();

    expect(await screen.findByText('訪問エリアを取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/訪問エリアの取得に失敗しました。/)).toBeTruthy();
    expect(screen.getByText(/再試行して、登録済みエリアと件数を確認してください。/)).toBeTruthy();
    expect(screen.queryByText('まだ訪問エリアはありません。')).toBeNull();
    expect(screen.queryByText(/田中一郎/)).toBeNull();
    expect(screen.queryByText(/storage_key/)).toBeNull();
    expect(screen.queryByText(/provider_error/)).toBeNull();
    expect(screen.queryByText(/\/api\/service-areas/)).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));
    await waitFor(() => {
      const areaCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(
          ([u, i]) => String(u) === '/api/service-areas' && !(i as RequestInit | undefined)?.method,
        );
      expect(areaCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows loading (not the empty-state) while orgId is unresolved and the areas query is disabled', () => {
    // useOrgId returns '' until the auth store resolves, so enabled: !!orgId keeps the areas
    // query pending-but-not-fetching (isPending true, isLoading false). The area-list
    // empty-state must not show, and no fetch should fire.
    orgIdMock.value = '';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(screen.getByRole('status', { name: '訪問エリアを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('まだ訪問エリアはありません。')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
