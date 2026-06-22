// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrescriptionDetailContent } from './prescription-detail-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBackMock,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

describe('PrescriptionDetailContent', () => {
  beforeEach(() => {
    useOrgIdMock.mockReset();
    useQueryMock.mockReset();
    routerBackMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('encodes decoded route ids before fetching prescription intake details', async () => {
    const hostileId = '../settings?x=1#frag';
    let queryConfig: QueryConfig | undefined;

    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      queryConfig = config;
      return {
        data: null,
        isLoading: true,
        error: null,
      };
    });

    render(<PrescriptionDetailContent intakeId={hostileId} />);

    if (!queryConfig) throw new Error('query config was not captured');
    expect(queryConfig.queryKey).toEqual(['prescription-intake-detail', 'org_1', hostileId]);
    await queryConfig.queryFn();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/prescription-intakes/${encodeURIComponent(hostileId)}`,
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );
  });
});
