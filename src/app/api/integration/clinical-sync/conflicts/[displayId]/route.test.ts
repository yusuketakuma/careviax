import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMode,
  registeredAuthOptions,
  withOrgContextMock,
  getClinicalSyncFhirValidationDetailMock,
} = vi.hoisted(() => ({
  authMode: { value: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' },
  registeredAuthOptions: [] as unknown[],
  withOrgContextMock: vi.fn(),
  getClinicalSyncFhirValidationDetailMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown, options?: unknown) => {
    registeredAuthOptions.push(options);
    return (req: NextRequest, routeContext: { params: Promise<{ displayId: string }> }) => {
      if (authMode.value === 'unauthenticated') {
        return new Response(
          JSON.stringify({ code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' }),
          { status: 401 },
        );
      }
      if (authMode.value === 'forbidden') {
        return new Response(
          JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }),
          { status: 403 },
        );
      }
      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/standard-clinical-sync-conflict-review', () => ({
  getClinicalSyncFhirValidationDetail: getClinicalSyncFhirValidationDetailMock,
}));

import { GET } from './route';

function createRequest(displayId = 'csq0000000001') {
  return new NextRequest(`http://localhost/api/integration/clinical-sync/conflicts/${displayId}`);
}

function routeContext(displayId = 'csq0000000001') {
  return { params: Promise.resolve({ displayId }) };
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/integration/clinical-sync/conflicts/[displayId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'ok';
    getClinicalSyncFhirValidationDetailMock.mockResolvedValue({
      queue_display_id: 'csq0000000001',
      conflict_kind: 'fhir_profile_validation_required',
      profile_validation_review_required: true,
      validation_diagnostics: {
        issue_count: 1,
        returned_issue_count: 1,
        truncated: false,
        issues: [{ code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS' }],
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        clinicalSyncQueueItem: {},
        clinicalFhirResourceCache: {},
      }),
    );
  });

  it('requires admin permission and returns a no-store detail envelope', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        queue_display_id: 'csq0000000001',
        conflict_kind: 'fhir_profile_validation_required',
        validation_diagnostics: {
          issue_count: 1,
        },
      },
      meta: {
        generated_at: expect.any(String),
      },
    });
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canAdmin',
      message: 'clinical sync conflictの閲覧権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(getClinicalSyncFhirValidationDetailMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      queueDisplayId: 'csq0000000001',
    });
  });

  it('rejects non ClinicalSyncQueueItem display IDs before entering org context', async () => {
    const response = await GET(createRequest('cfr0000000001'), routeContext('cfr0000000001'));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getClinicalSyncFhirValidationDetailMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the FHIR validation conflict is not available', async () => {
    getClinicalSyncFhirValidationDetailMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
  });

  it('applies no-store headers to auth failures', async () => {
    authMode.value = 'unauthenticated';
    const unauthenticated = await GET(createRequest(), routeContext());
    expect(unauthenticated.status).toBe(401);
    expectNoStore(unauthenticated);

    authMode.value = 'forbidden';
    const forbidden = await GET(createRequest(), routeContext());
    expect(forbidden.status).toBe(403);
    expectNoStore(forbidden);
  });
});
