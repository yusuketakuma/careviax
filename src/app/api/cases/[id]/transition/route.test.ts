import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindFirstMock,
  firstVisitDocFindFirstMock,
  careCaseUpdateManyMock,
  txCareCaseFindFirstMock,
  taskUpsertMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocFindFirstMock: vi.fn(),
  careCaseUpdateManyMock: vi.fn(),
  txCareCaseFindFirstMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    firstVisitDocument: {
      findFirst: firstVisitDocFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { PATCH } from './route';

function createTransitionRequest(caseId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/cases/${caseId}/transition`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      status: 'assessment',
      patient_id: 'patient_1',
    });
    firstVisitDocFindFirstMock.mockResolvedValue({
      id: 'fvd_1',
      delivered_at: new Date('2026-01-15T10:00:00Z'),
    });
    careCaseUpdateManyMock.mockResolvedValue({ count: 1 });
    txCareCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      status: 'active',
    });
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          updateMany: careCaseUpdateManyMock,
          findFirst: txCareCaseFindFirstMock,
        },
        task: {
          upsert: taskUpsertMock,
        },
      }),
    );
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
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
        status: 'assessment',
      }),
      data: { status: 'active' },
    });
    expect(txCareCaseFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
      }),
    });
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
    expect(body.warnings).toContain('初回訪問文書が未交付です');
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'org_1',
        status: 'assessment',
      }),
      data: { status: 'active' },
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

    expect(response.status).toBe(400);
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
      }),
      data: { status: 'active' },
    });
    expect(txCareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects non-object transition payloads before loading the case', async () => {
    const response = (await PATCH(createTransitionRequest('case_1', []), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('does not transition an unassigned case', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

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
});
