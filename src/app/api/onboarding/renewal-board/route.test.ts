import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildOnboardingRenewalBoardMock,
  requireAuthContextMock,
  syncOnboardingRenewalTasksMock,
  withOrgContextMock,
  withRoutePerformanceMock,
  withSensitiveNoStoreMock,
} = vi.hoisted(() => ({
  buildOnboardingRenewalBoardMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  syncOnboardingRenewalTasksMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  withRoutePerformanceMock: vi.fn(),
  withSensitiveNoStoreMock: vi.fn((response) => response),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (req: NextRequest, ctx: Record<string, unknown>) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest) =>
      withRoutePerformanceMock(req, async () => {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return withSensitiveNoStoreMock(authResult.response);
        return withSensitiveNoStoreMock(await handler(req, authResult.ctx));
      }),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/sensitive-response', () => ({
  withSensitiveNoStore: withSensitiveNoStoreMock,
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('@/server/services/management-plans', () => ({
  buildOnboardingRenewalBoard: buildOnboardingRenewalBoardMock,
  normalizeRenewalBoardLimit: (value?: number | null) => value ?? 250,
  normalizeRenewalBoardWindowDays: (value?: number | null) => value ?? 30,
  syncOnboardingRenewalTasks: syncOnboardingRenewalTasksMock,
}));

import { GET, POST } from './route';

function makeRequest(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init);
}

describe('/api/onboarding/renewal-board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    });
    withOrgContextMock.mockImplementation((_orgId, fn) => fn({ tx: true }));
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
  });

  it('returns renewal board data with no-store wrapper', async () => {
    buildOnboardingRenewalBoardMock.mockResolvedValue({
      generated_at: '2026-07-05T00:00:00.000Z',
      as_of: '2026-07-05',
      window_days: 14,
      summary: { total: 0, blocking: 0, urgent: 0, warning: 0 },
      items: [],
    });

    const response = await GET(
      makeRequest('/api/onboarding/renewal-board?window_days=14&limit=25'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.as_of).toBe('2026-07-05');
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canViewDashboard' }),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
    });
    expect(buildOnboardingRenewalBoardMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orgId: 'org_1', windowDays: 14, limit: 25 }),
    );
    expect(withSensitiveNoStoreMock).toHaveBeenCalledOnce();
  });

  it('rejects invalid query values before querying the database', async () => {
    const response = await GET(makeRequest('/api/onboarding/renewal-board?window_days=0'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(buildOnboardingRenewalBoardMock).not.toHaveBeenCalled();
  });

  it('syncs renewal tasks from POST body parameters', async () => {
    syncOnboardingRenewalTasksMock.mockResolvedValue({
      board: { generated_at: '2026-07-05T00:00:00.000Z', items: [] },
      synced: {
        state: 'ok',
        upserted: 0,
        resolved: 2,
        scope_complete: true,
        count_basis: 'bounded_active_patient_window',
        processed_patient_count: 2,
        limit: 50,
        truncated: false,
      },
    });

    const response = await POST(
      makeRequest('/api/onboarding/renewal-board', {
        method: 'POST',
        body: JSON.stringify({ window_days: 7, limit: 50 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.synced).toMatchObject({
      state: 'ok',
      upserted: 0,
      resolved: 2,
      scope_complete: true,
      count_basis: 'bounded_active_patient_window',
      truncated: false,
    });
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canManageOperationalTasks' }),
    );
    expect(syncOnboardingRenewalTasksMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orgId: 'org_1', windowDays: 7, limit: 50 }),
    );
  });

  it('rejects POST without mutation capability before opening org context', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = await POST(
      makeRequest('/api/onboarding/renewal-board', {
        method: 'POST',
        body: JSON.stringify({ window_days: 7, limit: 50 }),
      }),
    );

    expect(response.status).toBe(403);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canManageOperationalTasks' }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(syncOnboardingRenewalTasksMock).not.toHaveBeenCalled();
    expect(withSensitiveNoStoreMock).toHaveBeenCalledOnce();
  });
});
