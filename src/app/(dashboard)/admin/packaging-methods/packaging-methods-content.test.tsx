// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  PACKAGING_METHODS_API_PATH,
  buildPackagingMethodApiPath,
} from '@/lib/packaging-methods/api-paths';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());

// The org-header builders are mocked with SENTINEL returns ('x-test-helper') so the
// tests prove the component DELEGATES to them: a raw inline `{ 'x-org-id': orgId }`
// literal would not carry the sentinel, so toEqual on the sentinel object fails for
// un-converged code (distinguishes helper adoption from a same-shaped raw literal).
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

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));
// The packaging-method API path helper is mocked with its real implementation so
// tests can assert callsite delegation while retaining hostile-encode and dot
// fail-fast teeth.
vi.mock('@/lib/packaging-methods/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/packaging-methods/api-paths')>();
  return {
    ...actual,
    buildPackagingMethodApiPath: vi.fn(actual.buildPackagingMethodApiPath),
  };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

import { PackagingMethodsContent } from './packaging-methods-content';

setupDomTestEnv();

const METHOD = {
  id: 'method_1',
  name: '一包化',
  description: '1回ごとの分包',
  icon_key: 'package',
  sort_order: 1,
  is_active: true,
};

/** The queryFn passed to the latest useQuery call (captured from the mock). */
function latestQueryFn() {
  const call = useQueryMock.mock.calls.at(-1);
  return call?.[0].queryFn as () => Promise<unknown>;
}

/** The mutationFn passed to the latest useMutation call (captured from the mock). */
function latestMutationFn() {
  const call = useMutationMock.mock.calls.at(-1);
  return call?.[0].mutationFn as () => Promise<unknown>;
}

function stubFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [METHOD] }) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockReturnValue({ data: { data: [METHOD] } });
  useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PackagingMethodsContent', () => {
  it('renders packaging method master form and existing methods', () => {
    render(<PackagingMethodsContent />);

    expect(screen.getByText('配薬方法を追加')).toBeTruthy();
    expect(screen.getByText('登録済み配薬方法')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '有効' })).toBeTruthy();
    expect(screen.getByText('一包化')).toBeTruthy();
    expect(screen.getByText('1回ごとの分包')).toBeTruthy();
  });

  it('loads an existing method into the form for editing', () => {
    render(<PackagingMethodsContent />);

    fireEvent.click(screen.getByRole('button', { name: /一包化/ }));

    expect(screen.getByText('配薬方法を編集')).toBeTruthy();
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('一包化');
  });

  it('GET methods delegates to buildOrgHeaders(orgId) instead of a raw x-org-id literal', async () => {
    const fetchMock = stubFetchOk();
    render(<PackagingMethodsContent />);

    await latestQueryFn()();

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(PACKAGING_METHODS_API_PATH, {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('create (POST) delegates to buildOrgJsonHeaders and posts to the static collection path', async () => {
    const fetchMock = stubFetchOk();
    render(<PackagingMethodsContent />);
    // no method loaded → form.id === '' → POST branch (no path segment to encode)
    await latestMutationFn()();

    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PACKAGING_METHODS_API_PATH);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
  });

  it('update (PATCH) encodes a hostile id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetchOk();
    // a hostile id whose encodeURIComponent form differs from the raw string proves
    // the segment is actually encoded (a raw interpolation would leak '/' and ' ').
    useQueryMock.mockReturnValue({ data: { data: [{ ...METHOD, id: 'a/b c' }] } });
    render(<PackagingMethodsContent />);

    fireEvent.click(screen.getByRole('button', { name: /一包化/ }));
    await latestMutationFn()();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/packaging-methods/a%2Fb%20c');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(buildPackagingMethodApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('update (PATCH) with a dot-segment id fails closed BEFORE any fetch side effect', async () => {
    const fetchMock = stubFetchOk();
    useQueryMock.mockReturnValue({ data: { data: [{ ...METHOD, id: '.' }] } });
    render(<PackagingMethodsContent />);

    fireEvent.click(screen.getByRole('button', { name: /一包化/ }));

    await expect(latestMutationFn()()).rejects.toThrow(/dot segment/);
    expect(buildPackagingMethodApiPath).toHaveBeenCalledWith('.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders an inline error with retry instead of an empty state when the fetch fails (false-empty fail-close)', () => {
    // A fetch failure must NOT masquerade as "master is empty" — that would tell the
    // user to re-register packaging methods that gate the セット工程 and may already exist.
    useQueryMock.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error('配薬方法マスターの取得に失敗しました'),
      refetch: refetchMock,
    });
    render(<PackagingMethodsContent />);

    expect(screen.getByText('配薬方法マスターを取得できませんでした')).toBeTruthy();
    expect(screen.getByText('配薬方法マスターの取得に失敗しました')).toBeTruthy();
    // the "未登録" empty-state copy must be gone so the failure is not read as "no data"
    expect(screen.queryByText(/配薬方法が未登録です/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
