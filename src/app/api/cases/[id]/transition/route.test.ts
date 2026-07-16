import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  membershipFindFirstMock,
  firstVisitDocFindFirstMock,
  careCaseUpdateManyMock,
  txCareCaseFindFirstMock,
  taskUpsertMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  writePatientFieldRevisionsMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  firstVisitDocFindFirstMock: vi.fn(),
  careCaseUpdateManyMock: vi.fn(),
  txCareCaseFindFirstMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  writePatientFieldRevisionsMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) =>
    async (req: unknown, routeContext?: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('@/server/services/patient-field-revision', () => ({
  writePatientFieldRevisions: writePatientFieldRevisionsMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

function createTransitionRequest(caseId: string, body: unknown) {
  const versionedBody =
    body != null && typeof body === 'object' && !Array.isArray(body)
      ? { version: 1, ...body }
      : body;
  return new NextRequest(`http://localhost/api/cases/${caseId}/transition`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(versionedBody),
  });
}

function createMalformedTransitionRequest(caseId: string) {
  return new NextRequest(`http://localhost/api/cases/${caseId}/transition`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"from":',
  });
}

describe('/api/cases/[id]/transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    txCareCaseFindFirstMock.mockReset().mockResolvedValueOnce({
      id: 'case_1',
      org_id: 'org_1',
      status: 'assessment',
      patient_id: 'patient_1',
      version: 1,
    });
    firstVisitDocFindFirstMock.mockResolvedValue({
      id: 'fvd_1',
      delivered_at: new Date('2026-01-15T10:00:00Z'),
    });
    careCaseUpdateManyMock.mockResolvedValue({ count: 1 });
    txCareCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
      status: 'active',
      patient_id: 'patient_1',
      version: 2,
    });
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    writePatientFieldRevisionsMock.mockResolvedValue(undefined);
    createAuditLogEntryMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        membership: {
          findFirst: membershipFindFirstMock,
        },
        careCase: {
          updateMany: careCaseUpdateManyMock,
          findFirst: txCareCaseFindFirstMock,
        },
        task: {
          upsert: taskUpsertMock,
        },
        firstVisitDocument: {
          findFirst: firstVisitDocFindFirstMock,
        },
      }),
    );
  });

  it('returns the authorization response before parsing or reading the case', async () => {
    const deniedResponse = Response.json(
      { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
      { status: 403 },
    );
    requireAuthContextMock.mockResolvedValueOnce({ response: deniedResponse });

    const response = await PATCH(createMalformedTransitionRequest('case_1'), {
      params: Promise.resolve({ id: 'case_1' }),
    });

    expect(response).toBe(deniedResponse);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('transitions a case when the current status matches', async () => {
    const response = (await PATCH(
      createTransitionRequest('case_1', {
        from: 'assessment',
        to: 'active',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        permission: 'canVisit',
        message: 'ケース更新の権限がありません',
      }),
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'case_1',
        org_id: 'org_1',
        status: 'active',
        patient_id: 'patient_1',
        version: 2,
      },
      meta: { warnings: [] },
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
        status: 'assessment',
        version: 1,
      }),
      data: { status: 'active', version: { increment: 1 } },
    });
    expect(txCareCaseFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
      }),
    });
    expect(writePatientFieldRevisionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: 'case_1', source: 'care_case_transition' }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'care_case_transitioned', targetId: 'case_1' }),
    );
  });

  it('adds a warning and creates a task when transitioning to active with undelivered first visit doc', async () => {
    firstVisitDocFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createTransitionRequest('case_1', {
        from: 'assessment',
        to: 'active',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.warnings).toContain('初回訪問文書が未交付です');
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
        status: 'assessment',
        version: 1,
      }),
      data: { status: 'active', version: { increment: 1 } },
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskType: 'first_visit_document_delivery',
        dedupeKey: 'first_visit_doc_delivery:case_1',
      }),
    );
  });

  it('rejects transitions when the current status does not match', async () => {
    const response = (await PATCH(
      createTransitionRequest('case_1', {
        from: 'active',
        to: 'discharged',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale transitions when the case changes after the preflight status check', async () => {
    careCaseUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = (await PATCH(
      createTransitionRequest('case_1', {
        from: 'assessment',
        to: 'active',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'ケースが同時に更新されました。再読み込みしてください',
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
        status: 'assessment',
        version: 1,
      }),
      data: { status: 'active', version: { increment: 1 } },
    });
    expect(txCareCaseFindFirstMock).toHaveBeenCalledTimes(1);
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects non-object transition payloads before loading the case', async () => {
    const response = (await PATCH(createTransitionRequest('case_1', []), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects blank case ids before loading or transitioning the case', async () => {
    const response = (await PATCH(
      createTransitionRequest('case_1', {
        from: 'assessment',
        to: 'active',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the case', async () => {
    const response = (await PATCH(createMalformedTransitionRequest('case_1'), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('does not transition an unassigned case', async () => {
    txCareCaseFindFirstMock.mockReset().mockResolvedValue(null);

    const response = (await PATCH(
      createTransitionRequest('case_2', {
        from: 'assessment',
        to: 'active',
      }),
      {
        params: Promise.resolve({ id: 'case_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects an inactive membership inside the transaction', async () => {
    membershipFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createTransitionRequest('case_1', { from: 'assessment', to: 'active' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    ))!;

    expect(response.status).toBe(403);
    expect(txCareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a stale version before mutating the case', async () => {
    txCareCaseFindFirstMock.mockReset().mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
      status: 'assessment',
      patient_id: 'patient_1',
      version: 4,
    });

    const response = (await PATCH(
      createTransitionRequest('case_1', { from: 'assessment', to: 'active' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { expected_version: 1, current_version: 4 },
    });
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
