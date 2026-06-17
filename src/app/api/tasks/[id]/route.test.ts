import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  taskFindFirstMock,
  taskUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createPatchRequest(taskId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest(taskId: string) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
    });
    taskUpdateMock.mockResolvedValue({
      id: 'task_1',
      status: 'completed',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          update: taskUpdateMock,
        },
      }),
    );
  });

  it('does not let a scoped user reassign a PHI-backed task to another user', async () => {
    const response = (await PATCH(
      createPatchRequest('task_1', {
        assigned_to: 'user_2',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank task ids before parsing or resolving assignment scope', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('task_1'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'タスクIDが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('updates a task and sets completed_at when marking it completed', async () => {
    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(Date),
      }),
    });
  });

  it('rejects archived related patients before updating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients resolved from related cases before updating operational tasks', async () => {
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: 'case',
      related_entity_id: 'case_1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: { patient_id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before resolving assignment scope', async () => {
    const response = (await PATCH(createPatchRequest('task_1', []), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before resolving assignment scope', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('task_1'), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it('does not update tasks outside the assignment scope', async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest('task_unassigned', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task_unassigned',
        org_id: 'org_1',
        OR: [
          { assigned_to: 'user_1' },
          {
            related_entity_type: 'patient',
            related_entity_id: { in: ['patient_1'] },
          },
          {
            related_entity_type: 'case',
            related_entity_id: { in: ['case_1'] },
          },
        ],
      },
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
