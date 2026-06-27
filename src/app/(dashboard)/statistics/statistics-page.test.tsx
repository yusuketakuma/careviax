// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { MemberRole } from '@prisma/client';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { StatisticsSurface } from './statistics-surfaces';
import StatisticsPage from './page';

// The page is the actual integration point: it resolves the member role server-side, gates the hub
// on canViewDashboard, and filters the surfaces by per-surface permission before handing them to the
// presentational client component. These tests exercise that glue (pure-fn + render tests cannot).
const { authMock, resolveMock, findFirstMock, contentMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  resolveMock: vi.fn(),
  findFirstMock: vi.fn(),
  contentMock: vi.fn(() => <div>statistics-content</div>),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/auth/user-resolution', () => ({ resolveLocalUserByIdentity: resolveMock }));
vi.mock('@/lib/db/client', () => ({ prisma: { membership: { findFirst: findFirstMock } } }));
vi.mock('./statistics-content', () => ({ StatisticsContent: contentMock }));
vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

setupDomTestEnv();

function setupRole(role: MemberRole | null) {
  authMock.mockResolvedValue({
    user: { id: 'u1', orgId: 'o1', cognitoSub: 'sub', email: 'a@b.test' },
  });
  resolveMock.mockResolvedValue(null);
  findFirstMock.mockResolvedValue(role ? { role } : null);
}

function passedSurfaces(): StatisticsSurface[] {
  return (contentMock.mock.calls[0] as unknown as [{ surfaces: StatisticsSurface[] }])[0].surfaces;
}

const FORBIDDEN_TITLE = '統計を表示する権限がありません';

describe('StatisticsPage (server permission gate)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes all 23 surfaces to the content for an admin', async () => {
    setupRole(MemberRole.admin);

    render(await StatisticsPage());

    expect(contentMock).toHaveBeenCalledTimes(1);
    expect(passedSurfaces()).toHaveLength(23);
    expect(screen.queryByText(FORBIDDEN_TITLE)).toBeNull();
  });

  it('renders the shared WorkflowPageHeader h1 「統計」 (description moves into the HelpPopover)', async () => {
    setupRole(MemberRole.admin);

    render(await StatisticsPage());

    // ヘッダは共通 WorkflowPageHeader 化。見出し「統計」は h1 として可視のまま維持する
    // (説明文は HelpPopover へ集約され既定では非表示)。
    expect(screen.getByRole('heading', { level: 1, name: '統計' })).toBeTruthy();
  });

  it('resolves the role via an org-scoped, active-membership query (access boundary)', async () => {
    setupRole(MemberRole.admin);

    render(await StatisticsPage());

    // the role must be read for THIS user in THIS org and only from an active membership —
    // an inactive or cross-org membership must not grant statistics access.
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { user_id: 'u1', org_id: 'o1', is_active: true },
      select: { role: true },
    });
  });

  it('forbids and never queries membership when there is no session/resolved user', async () => {
    authMock.mockResolvedValue(null);
    resolveMock.mockResolvedValue(null);

    render(await StatisticsPage());

    expect(contentMock).not.toHaveBeenCalled();
    expect(screen.getByText(FORBIDDEN_TITLE)).toBeTruthy();
    // no user/org -> we must short-circuit before touching the membership table
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('forbids driver (no dashboard permission): no content, no cards', async () => {
    setupRole(MemberRole.driver);

    render(await StatisticsPage());

    expect(contentMock).not.toHaveBeenCalled();
    expect(screen.getByText(FORBIDDEN_TITLE)).toBeTruthy();
  });

  it('forbids external_viewer (no dashboard permission)', async () => {
    setupRole(MemberRole.external_viewer);

    render(await StatisticsPage());

    expect(contentMock).not.toHaveBeenCalled();
    expect(screen.getByText(FORBIDDEN_TITLE)).toBeTruthy();
  });

  it('forbids when no active membership/role resolves', async () => {
    setupRole(null);

    render(await StatisticsPage());

    expect(contentMock).not.toHaveBeenCalled();
    expect(screen.getByText(FORBIDDEN_TITLE)).toBeTruthy();
  });

  it('passes only the canViewDashboard surfaces to the content for a clerk', async () => {
    setupRole(MemberRole.clerk);

    render(await StatisticsPage());

    expect(contentMock).toHaveBeenCalledTimes(1);
    expect(
      passedSurfaces()
        .map((surface) => surface.href)
        .sort(),
    ).toEqual(['/clerk-support', '/dashboard', '/prescriptions/intake', '/workflow'].sort());
  });
});
