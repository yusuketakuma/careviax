import { ClinicalFhirValidationStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMode,
  registeredAuthOptions,
  withOrgContextMock,
  requeueClinicalSyncFhirValidationConflictMock,
} = vi.hoisted(() => ({
  authMode: { value: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' },
  registeredAuthOptions: [] as unknown[],
  withOrgContextMock: vi.fn(),
  requeueClinicalSyncFhirValidationConflictMock: vi.fn(),
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
  requeueClinicalSyncFhirValidationConflict: requeueClinicalSyncFhirValidationConflictMock,
}));

import { POST } from './route';

function createRequest(displayId = 'csq0000000001') {
  return new NextRequest(
    `http://localhost/api/integration/clinical-sync/conflicts/${displayId}/requeue`,
    { method: 'POST' },
  );
}

function post(req: NextRequest, displayId = 'csq0000000001') {
  return POST(req, { params: Promise.resolve({ displayId }) });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/integration/clinical-sync/conflicts/[displayId]/requeue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'ok';
    requeueClinicalSyncFhirValidationConflictMock.mockResolvedValue({
      kind: 'requeued',
      queue_display_id: 'csq0000000001',
      queue_status: 'pending',
      validation_status: ClinicalFhirValidationStatus.valid,
      requeued_queue_item_count: 1,
      provenance_recorded: true,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        clinicalSyncQueueItem: {},
        clinicalFhirResourceCache: {},
        clinicalProvenanceRecord: {},
      }),
    );
  });

  it('requires admin permission and requeues a valid FHIR validation conflict', async () => {
    const response = await post(createRequest());

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        queue_display_id: 'csq0000000001',
        queue_status: 'pending',
        validation_status: ClinicalFhirValidationStatus.valid,
        requeued_queue_item_count: 1,
        provenance_recorded: true,
      },
    });
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canAdmin',
      message: 'clinical sync conflictの更新権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeoutMs: 5000,
    });
    expect(requeueClinicalSyncFhirValidationConflictMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      queueDisplayId: 'csq0000000001',
      reviewedByUserId: 'user_1',
    });
  });

  it('rejects non queue display IDs before entering org context', async () => {
    const response = await post(createRequest('p0000000001'), 'p0000000001');

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(requeueClinicalSyncFhirValidationConflictMock).not.toHaveBeenCalled();
  });

  it('maps not-ready validation to a safe conflict response', async () => {
    requeueClinicalSyncFhirValidationConflictMock.mockResolvedValueOnce({
      kind: 'validation_not_ready',
      queue_display_id: 'csq0000000001',
      validation_status: ClinicalFhirValidationStatus.invalid,
    });

    const response = await post(createRequest());

    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'FHIR_VALIDATION_NOT_READY',
        queue_display_id: 'csq0000000001',
        validation_status: ClinicalFhirValidationStatus.invalid,
      },
    });
  });

  it('maps stale and missing conflicts without exposing internal IDs', async () => {
    requeueClinicalSyncFhirValidationConflictMock.mockResolvedValueOnce({ kind: 'not_found' });
    const missing = await post(createRequest());
    expect(missing.status).toBe(404);
    expectNoStore(missing);

    requeueClinicalSyncFhirValidationConflictMock.mockResolvedValueOnce({
      kind: 'stale_conflict',
      queue_display_id: 'csq0000000001',
    });
    const stale = await post(createRequest());
    expect(stale.status).toBe(409);
    expectNoStore(stale);
    expect(JSON.stringify(await stale.json())).not.toContain('cache_');
  });

  it('applies no-store headers to auth failures', async () => {
    authMode.value = 'unauthenticated';
    const unauthenticated = await post(createRequest());
    expect(unauthenticated.status).toBe(401);
    expectNoStore(unauthenticated);

    authMode.value = 'forbidden';
    const forbidden = await post(createRequest());
    expect(forbidden.status).toBe(403);
    expectNoStore(forbidden);
  });
});
