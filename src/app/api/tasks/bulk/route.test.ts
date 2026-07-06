import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { bulkCompleteTasksResponseSchema } from '@/lib/tasks/bulk-completion-contract';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  taskFindManyMock,
  taskUpdateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
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
      findMany: taskFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tasks/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/tasks/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/tasks/bulk', () => {
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
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'patient_self_report_followup',
        status: 'pending',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      },
      {
        id: 'task_2',
        task_type: 'general',
        status: 'in_progress',
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      },
    ]);
    taskUpdateManyMock.mockResolvedValue({ count: 2 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          updateMany: taskUpdateManyMock,
        },
      }),
    );
  });

  it('completes inline tasks with one scoped updateMany call', async () => {
    const response = await POST(createPostRequest({ ids: ['task_1', 'task_2'] }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(bulkCompleteTasksResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      data: {
        total: 2,
        completed: 2,
        failed: 0,
        failures: [],
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['task_1', 'task_2'] },
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
      select: {
        id: true,
        task_type: true,
        status: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledOnce();
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['task_1', 'task_2'] },
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
        status: { in: ['pending', 'in_progress'] },
      },
      data: {
        status: 'completed',
        completed_at: expect.any(Date),
      },
    });
  });

  it('returns a stale-state conflict when fewer eligible tasks are updated than selected', async () => {
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(createPostRequest({ ids: ['task_1', 'task_2'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 2,
        completed: 1,
        failed: 1,
        failures: [
          {
            id: null,
            code: 'conflict',
            message: '1件のタスクはすでに完了または取り消されています。再読み込みしてください',
          },
        ],
      },
    });
  });

  it('deduplicates requested ids before querying and updating', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'general',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
    ]);
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(createPostRequest({ ids: ['task_1', 'task_1'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        completed: 1,
        failed: 0,
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
  });

  it('returns partial failures for inaccessible and dedicated-flow tasks', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'general',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
      {
        id: 'task_2',
        task_type: 'handoff_confirmation',
        status: 'pending',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      },
      {
        id: 'task_3',
        task_type: 'handoff_supervision_review',
        status: 'pending',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      },
      {
        id: 'task_4',
        task_type: 'risk_billing',
        status: 'pending',
        related_entity_type: 'billing_evidence',
        related_entity_id: 'bill_1',
      },
    ]);
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(
      createPostRequest({ ids: ['task_1', 'task_2', 'task_3', 'task_4', 'task_missing'] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 5,
        completed: 1,
        failed: 4,
        failures: [
          {
            id: 'task_2',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_3',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_4',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_missing',
            code: 'not_found',
            message: 'タスクが見つかりません',
          },
        ],
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
  });

  it('rejects archived related patients before updating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(createPostRequest({ ids: ['task_1'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        completed: 0,
        failed: 1,
        failures: [
          {
            id: 'task_1',
            code: 'conflict',
            message: 'アーカイブ中の患者は復元するまで更新できません',
          },
        ],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object and malformed payloads before resolving assignment scope', async () => {
    const arrayResponse = await POST(createPostRequest([]));
    const malformedResponse = await POST(createMalformedPostRequest());

    expect(arrayResponse.status).toBe(400);
    expect(malformedResponse.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});
