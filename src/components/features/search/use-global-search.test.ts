// @vitest-environment jsdom

import { MemberRole } from '@prisma/client';
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEnabledCategories, useGlobalSearch } from './use-global-search';

const ORG = 'org_1';

function okBody(url: string): unknown {
  if (url.startsWith('/api/patients')) return { data: [{ id: 'p1', name: '山田 太郎' }] };
  if (url.startsWith('/api/visit-schedule-proposals'))
    return { data: [{ id: 'pr1', proposal_status: 'pending', proposed_date: '2026-06-20' }] };
  if (url.startsWith('/api/prescription-intakes'))
    return {
      data: [
        { id: 'rx1', cycle: { case_: { patient: { name: '山田 太郎' } } } },
        { id: 'rx2', cycle: { case_: { patient: { name: '佐藤 花子' } } } },
      ],
    };
  if (url.startsWith('/api/drug-masters'))
    return { data: [{ id: 'd1', drug_name: 'ロキソニン錠' }] };
  if (url.startsWith('/api/care-reports'))
    return {
      data: [{ id: 'r1', report_type: 'monthly', status: 'draft', created_at: '2026-06-20' }],
    };
  if (url.startsWith('/api/contact-profiles')) return { data: [{ id: 'c1', name: '田中薬局' }] };
  return { data: [] };
}

let requestedUrls: string[];

function installFetch(
  responder: (url: string) => Promise<Response> = async (url) =>
    new Response(JSON.stringify(okBody(url)), { status: 200 }),
) {
  requestedUrls = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);
    void init;
    return responder(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const pathsOf = () => requestedUrls.map((u) => u.split('?')[0]).sort();

async function runSearch(query: string, role: MemberRole | null, orgId: string) {
  const hook = renderHook(({ q }) => useGlobalSearch(q, role, orgId), {
    initialProps: { q: query },
  });
  // debounce(250ms) を超えて fetch を発火させ、Promise.allSettled を flush する。
  await act(async () => {
    vi.advanceTimersByTime(260);
    await Promise.resolve();
    await Promise.resolve();
  });
  return hook;
}

describe('resolveEnabledCategories (no-fetch permission gate)', () => {
  it('admin with org sees all 6 active categories; without org only drug; clerk gets canReport+drug', () => {
    expect(resolveEnabledCategories(MemberRole.admin, ORG).map((c) => c.id)).toEqual([
      'patient',
      'proposal',
      'prescription',
      'drug',
      'report',
      'contact',
    ]);
    // org スコープのカテゴリは orgId 不在では fetch しない(drug は org 非依存)。
    expect(resolveEnabledCategories(MemberRole.admin, '').map((c) => c.id)).toEqual(['drug']);
    // clerk(canVisit:false, canReport:true): patient/proposal/prescription(canVisit)を除外、report/contact/drug のみ。
    expect(resolveEnabledCategories(MemberRole.clerk, ORG).map((c) => c.id)).toEqual([
      'drug',
      'report',
      'contact',
    ]);
  });

  it('driver / external_viewer / unknown role get drug only (fail-closed)', () => {
    expect(resolveEnabledCategories(MemberRole.driver, ORG).map((c) => c.id)).toEqual(['drug']);
    expect(resolveEnabledCategories(MemberRole.external_viewer, ORG).map((c) => c.id)).toEqual([
      'drug',
    ]);
    expect(resolveEnabledCategories(null, ORG).map((c) => c.id)).toEqual(['drug']);
  });
});

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not fetch below the 2-char minimum', async () => {
    installFetch();
    await runSearch('a', MemberRole.admin, ORG);
    expect(requestedUrls).toHaveLength(0);
  });

  it('reports pending immediately for an eligible query, then clears once results arrive', async () => {
    installFetch();
    const hook = renderHook(({ q }) => useGlobalSearch(q, MemberRole.driver, ORG), {
      initialProps: { q: 'やま' },
    });
    // before the debounce fires: eligible query but no current results yet -> pending.
    expect(hook.result.current.hasQuery).toBe(true);
    expect(hook.result.current.pending).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.pending).toBe(false);
  });

  it('marks results stale (pending) immediately when the query changes before the next fetch', async () => {
    installFetch();
    const hook = renderHook(({ q }) => useGlobalSearch(q, MemberRole.driver, ORG), {
      initialProps: { q: 'ふる' },
    });
    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.pending).toBe(false); // results correspond to 'ふる'

    hook.rerender({ q: 'しん' }); // query changed; no new fetch completed yet
    // results are now stale relative to the current query -> pending until the new fetch lands.
    expect(hook.result.current.pending).toBe(true);
  });

  it('requests all permitted category endpoints for admin (full cross-category search)', async () => {
    installFetch();
    await runSearch('やま', MemberRole.admin, ORG);
    expect(pathsOf()).toEqual([
      '/api/care-reports',
      '/api/contact-profiles',
      '/api/drug-masters',
      '/api/patients',
      '/api/prescription-intakes',
      '/api/visit-schedule-proposals',
    ]);
  });

  it('routes patient/proposal/report through view=palette (F-012 minimal projection over-fetch guard)', async () => {
    installFetch();
    await runSearch('やま', MemberRole.admin, ORG);
    const urlFor = (path: string) => requestedUrls.find((u) => u.startsWith(path)) ?? '';
    // view=palette を付けないと full list 分岐で over-wide payload がブラウザへ転送される。
    expect(urlFor('/api/patients')).toContain('view=palette');
    expect(urlFor('/api/visit-schedule-proposals')).toContain('view=palette');
    expect(urlFor('/api/care-reports')).toContain('view=palette');
    // drug(global master)/prescription/contact(F-010A q/limit) は view=palette を使わない。
    expect(urlFor('/api/drug-masters')).not.toContain('view=palette');
    expect(urlFor('/api/prescription-intakes')).not.toContain('view=palette');
    expect(urlFor('/api/contact-profiles')).not.toContain('view=palette');
  });

  it('clerk never requests canVisit URLs but does request canReport + drug URLs', async () => {
    installFetch();
    await runSearch('やま', MemberRole.clerk, ORG);
    expect(pathsOf()).toEqual(['/api/care-reports', '/api/contact-profiles', '/api/drug-masters']);
    for (const visitUrl of [
      '/api/patients',
      '/api/visit-schedule-proposals',
      '/api/prescription-intakes',
    ]) {
      expect(
        requestedUrls.some((u) => u.startsWith(visitUrl)),
        visitUrl,
      ).toBe(false);
    }
  });

  it('driver requests only drug masters (no protected category URLs)', async () => {
    installFetch();
    await runSearch('やま', MemberRole.driver, ORG);
    expect(pathsOf()).toEqual(['/api/drug-masters']);
  });

  it('with no orgId, org-scoped categories are not fetched (drug still is)', async () => {
    installFetch();
    await runSearch('やま', MemberRole.admin, '');
    expect(pathsOf()).toEqual(['/api/drug-masters']);
  });

  it('sends x-org-id on every authenticated request including drug masters', async () => {
    const fetchMock = installFetch();
    await runSearch('やま', MemberRole.admin, ORG);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect((init?.headers as Record<string, string>)['x-org-id']).toBe(ORG);
    }
  });

  it('marks a failed category as failed with no rows (fail-closed, not empty/0-results)', async () => {
    // active=drug のみのため単一カテゴリで検証: 403/malformed は failed(rows=[])であり 0 件 ok にしない。
    installFetch(async () => new Response('forbidden', { status: 403 }));
    const { result } = await runSearch('ロキソ', MemberRole.admin, ORG);
    const drug = result.current.results.find((r) => r.category === 'drug');
    expect(drug?.status).toBe('failed');
    expect(drug?.rows).toHaveLength(0);
  });

  it('marks an over-limit (>8) category response as failed (backend ignored limit -> fail-closed)', async () => {
    // backend が limit を無視して 9 件返した場合、schema.max が safeParse を失敗させ、
    // 成功扱いで rows 化せず failed(rows=0)にする。
    installFetch(async (url) => {
      if (url.startsWith('/api/drug-masters')) {
        const data = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, drug_name: `薬${i}` }));
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      return new Response(JSON.stringify(okBody(url)), { status: 200 });
    });
    const { result } = await runSearch('くすり', MemberRole.driver, ORG);
    const drug = result.current.results.find((r) => r.category === 'drug');
    expect(drug?.status).toBe('failed');
    expect(drug?.rows).toHaveLength(0);
  });

  it('drops a stale response so an older query cannot overwrite a newer one', async () => {
    // first query resolves slowly; second resolves fast. Newer result must win.
    let resolveFirst: ((r: Response) => void) | null = null;
    installFetch(async (url) => {
      if (url.startsWith('/api/drug-masters')) {
        // first call (query "ふる") hangs until we release it; later calls resolve immediately.
        if (!resolveFirst) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Response(JSON.stringify({ data: [{ id: 'd-new', drug_name: '新薬' }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(okBody(url)), { status: 200 });
    });

    const hook = renderHook(({ q }) => useGlobalSearch(q, MemberRole.driver, ORG), {
      initialProps: { q: 'ふる' },
    });
    await act(async () => {
      vi.advanceTimersByTime(260); // fires query "ふる" -> drug fetch hangs
      await Promise.resolve();
    });
    // newer query "しん"
    hook.rerender({ q: 'しん' });
    await act(async () => {
      vi.advanceTimersByTime(260); // fires query "しん" -> resolves immediately
      await Promise.resolve();
      await Promise.resolve();
    });
    // now release the stale first response
    await act(async () => {
      resolveFirst?.(
        new Response(JSON.stringify({ data: [{ id: 'd-old', drug_name: '旧薬' }] }), {
          status: 200,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const rx = hook.result.current.results.find((r) => r.category === 'drug');
    // the newer query's result must remain; the stale first response must not overwrite it.
    expect(rx?.rows[0]?.title).toBe('新薬');
  });
});
