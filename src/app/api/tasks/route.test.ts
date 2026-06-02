import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  taskFindManyMock,
  taskCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

describe('/api/tasks', () => {
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
    taskFindManyMock.mockResolvedValue([]);
    taskCreateMock.mockResolvedValue({ id: 'task_1', title: '折返し対応' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          create: taskCreateMock,
        },
      }),
    );
  });

  it('filters tasks by related entity fields', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/tasks?task_type=conference_action_item&related_entity_type=conference_note&related_entity_id=note_1',
      ),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
          task_type: 'conference_action_item',
          related_entity_type: 'conference_note',
          related_entity_id: 'note_1',
        }),
      }),
    );
  });

  it('rejects unsupported status filters before resolving assignment scope', async () => {
    const response = await GET(createRequest('http://localhost/api/tasks?status=bad_status'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it('creates an operational task', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        description: '折返し対応',
        priority: 'high',
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: { source: 'self_report', severity: 'high' },
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: { source: 'self_report', severity: 'high' },
      }),
    });
  });

  it('rejects non-object create payloads before resolving assignment scope', async () => {
    const response = await POST(createRequest('http://localhost/api/tasks', []));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before resolving assignment scope', async () => {
    const response = await POST(createMalformedJsonRequest('http://localhost/api/tasks'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects creation for an unassigned related patient before write', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者B: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'patient',
        related_entity_id: 'patient_unassigned',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });
});
