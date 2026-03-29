import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindFirstMock,
  firstVisitDocFindFirstMock,
  careCaseUpdateMock,
  taskUpsertMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocFindFirstMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
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
    careCaseUpdateMock.mockResolvedValue({
      id: 'case_1',
      status: 'active',
    });
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          update: careCaseUpdateMock,
        },
        task: {
          upsert: taskUpsertMock,
        },
      }),
    );
  });

  it('transitions a case when the current status matches', async () => {
    const response = await PATCH({
      json: async () => ({
        from: 'assessment',
        to: 'active',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'case_1' }),
    });

    expect(response.status).toBe(200);
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: { status: 'active' },
    });
  });

  it('adds a warning and creates a task when transitioning to active with undelivered first visit doc', async () => {
    firstVisitDocFindFirstMock.mockResolvedValue(null);

    const response = await PATCH({
      json: async () => ({
        from: 'assessment',
        to: 'active',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'case_1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.warnings).toContain('初回訪問文書が未交付です');
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskType: 'first_visit_document_delivery',
        dedupeKey: 'first_visit_doc_delivery:case_1',
      }),
    );
  });

  it('rejects transitions when the current status does not match', async () => {
    const response = await PATCH({
      json: async () => ({
        from: 'active',
        to: 'discharged',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'case_1' }),
    });

    expect(response.status).toBe(400);
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });
});
