import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMode, registeredAuthOptions, withOrgContextMock, listClinicalSyncConflictsMock } =
  vi.hoisted(() => ({
    authMode: { value: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' },
    registeredAuthOptions: [] as unknown[],
    withOrgContextMock: vi.fn(),
    listClinicalSyncConflictsMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown, options?: unknown) => {
    registeredAuthOptions.push(options);
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
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
  isClinicalSyncReviewConflictCode: (value: unknown) =>
    value === 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION' ||
    value === 'FHIR_PROFILE_VALIDATION_REQUIRED',
  listClinicalSyncConflicts: listClinicalSyncConflictsMock,
}));

import { GET } from './route';

function createRequest(path = '/api/integration/clinical-sync/conflicts') {
  return new NextRequest(`http://localhost${path}`);
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/integration/clinical-sync/conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'ok';
    listClinicalSyncConflictsMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        clinicalSyncQueueItem: {},
        clinicalExternalReference: {},
        clinicalFhirResourceCache: {},
      }),
    );
  });

  it('requires admin permission and returns an explicit data envelope', async () => {
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        conflicts: [],
      },
      meta: {
        count: 0,
        limit: 50,
        error_code: null,
      },
    });
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canAdmin',
      message: 'clinical sync conflictの閲覧権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(listClinicalSyncConflictsMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      limit: 50,
      errorCode: undefined,
    });
  });

  it('passes a valid error_code and clamps limit', async () => {
    const response = await GET(
      createRequest(
        '/api/integration/clinical-sync/conflicts?error_code=FHIR_PROFILE_VALIDATION_REQUIRED&limit=999',
      ),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(listClinicalSyncConflictsMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      limit: 100,
      errorCode: 'FHIR_PROFILE_VALIDATION_REQUIRED',
    });
  });

  it('normalizes small and invalid limits consistently with route pagination helper', async () => {
    await GET(createRequest('/api/integration/clinical-sync/conflicts?limit=0'));
    expect(listClinicalSyncConflictsMock).toHaveBeenLastCalledWith(expect.anything(), {
      orgId: 'org_1',
      limit: 1,
      errorCode: undefined,
    });

    await GET(createRequest('/api/integration/clinical-sync/conflicts?limit=abc'));
    expect(listClinicalSyncConflictsMock).toHaveBeenLastCalledWith(expect.anything(), {
      orgId: 'org_1',
      limit: 50,
      errorCode: undefined,
    });
  });

  it('rejects invalid or duplicate error_code before entering org context', async () => {
    const invalid = await GET(
      createRequest(
        '/api/integration/clinical-sync/conflicts?error_code=FHIR_RESOURCE_CACHE_REQUIRED',
      ),
    );
    expect(invalid.status).toBe(400);
    expectNoStore(invalid);
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const duplicate = await GET(
      createRequest(
        '/api/integration/clinical-sync/conflicts?error_code=FHIR_PROFILE_VALIDATION_REQUIRED&error_code=PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
      ),
    );
    expect(duplicate.status).toBe(400);
    expectNoStore(duplicate);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(listClinicalSyncConflictsMock).not.toHaveBeenCalled();
  });

  it('applies no-store headers to auth failures', async () => {
    authMode.value = 'unauthenticated';
    const unauthenticated = await GET(createRequest());
    expect(unauthenticated.status).toBe(401);
    expectNoStore(unauthenticated);

    authMode.value = 'forbidden';
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);
    expectNoStore(forbidden);
  });
});
