import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  conferenceNoteFindFirstMock,
  conferenceNoteLockMock,
  taskUpsertMock,
  conferenceNoteUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
  authContextFailureMock,
} = vi.hoisted(() => ({
  conferenceNoteFindFirstMock: vi.fn(),
  conferenceNoteLockMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  authContextFailureMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const failure = authContextFailureMock();
      if (failure) return Promise.reject(failure);

      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    conferenceNote: {
      findFirst: conferenceNoteFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/conference-notes/note_1/tasks', {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/conference-notes/note_1/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/conference-notes/[id]/tasks POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextFailureMock.mockReset();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      title: '定期カンファレンス',
      case_id: 'case_1',
      patient_id: 'patient_1',
      action_items: [
        { title: '服薬確認', assignee: '薬剤師' },
        { title: '医師へ共有', assignee: '管理者', legacy_debug: undefined },
      ],
    });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    conferenceNoteUpdateMock.mockResolvedValue({ id: 'note_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        $queryRaw: conferenceNoteLockMock,
        task: {
          upsert: taskUpsertMock,
        },
        conferenceNote: {
          findFirst: conferenceNoteFindFirstMock,
          update: conferenceNoteUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('creates an operational task from a conference action item and stamps the note', async () => {
    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(conferenceNoteLockMock).toHaveBeenCalledTimes(1);
    expect(conferenceNoteLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      conferenceNoteFindFirstMock.mock.invocationCallOrder[0],
    );
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_dedupe_key: {
            org_id: 'org_1',
            dedupe_key: 'conference-action-item:note_1:1',
          },
        },
        select: {
          id: true,
        },
      }),
    );
    expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data: {
        action_items: expect.arrayContaining([
          expect.objectContaining({
            title: '医師へ共有',
            converted_task_id: 'task_1',
          }),
        ]),
      },
    });
    const updatedActionItems = conferenceNoteUpdateMock.mock.calls[0][0].data.action_items as Array<
      Record<string, unknown>
    >;
    expect(updatedActionItems[1].legacy_debug).toBeUndefined();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: 'patient_1',
        action: 'conference_note.action_item_converted',
        target_type: 'conference_note',
        target_id: 'note_1',
        changes: {
          conference_note: {
            action_item_index: 1,
            task_id: 'task_1',
            case_id: 'case_1',
          },
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
    const body = await response.json();
    expect(body).toMatchObject({ data: { task_id: 'task_1' } });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('定期カンファレンス');
    expect(serialized).not.toContain('医師へ共有');
    expect(serialized).not.toContain('conference-action-item');
  });

  it('rejects blank note ids before loading the note or creating a task', async () => {
    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録IDが不正です',
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the note or creating a task', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the note or creating a task', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('returns no-store not-found before creating a task', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: 'note_missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録が見つかりません',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(conferenceNoteLockMock).toHaveBeenCalledTimes(1);
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('returns no-store validation when the action item is missing', async () => {
    const response = await POST(createRequest({ action_item_index: 99 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '指定されたアクションアイテムが見つかりません',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(conferenceNoteLockMock).toHaveBeenCalledTimes(1);
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('returns an existing task id without rewriting an already converted action item', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce({
      id: 'note_1',
      title: '定期カンファレンス',
      case_id: 'case_1',
      patient_id: 'patient_1',
      action_items: [
        {
          title: '服薬確認',
          assignee: '薬剤師',
          converted_task_id: 'task_existing',
          converted_at: '2026-03-30T10:00:00.000Z',
        },
      ],
    });

    const response = await POST(createRequest({ action_item_index: 0 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { task_id: 'task_existing' },
    });
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('preserves other converted action-item stamps from the locked transaction row', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce({
      id: 'note_1',
      title: '定期カンファレンス',
      case_id: 'case_1',
      patient_id: 'patient_1',
      action_items: [
        {
          title: '医師へ共有',
          assignee: '管理者',
          converted_task_id: 'task_existing',
          converted_at: '2026-03-30T10:00:00.000Z',
        },
        { title: '医師へ共有', assignee: '管理者' },
      ],
    });
    taskUpsertMock.mockResolvedValueOnce({ id: 'task_2' });

    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    const updatedActionItems = conferenceNoteUpdateMock.mock.calls[0][0].data.action_items as Array<
      Record<string, unknown>
    >;
    expect(updatedActionItems[0]).toMatchObject({
      converted_task_id: 'task_existing',
    });
    expect(updatedActionItems[1]).toMatchObject({
      converted_task_id: 'task_2',
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_dedupe_key: {
            org_id: 'org_1',
            dedupe_key: 'conference-action-item:note_1:1',
          },
        },
      }),
    );
  });

  it('sanitizes unexpected task conversion failures and keeps sensitive responses no-store', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw note_1 patient action item conversion failure'),
    );

    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('note_1');
    expect(serialized).not.toContain('patient');
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('sanitizes auth plumbing failures before loading the note', async () => {
    authContextFailureMock.mockReturnValueOnce(
      new Error('raw auth note_1 patient task conversion failure'),
    );

    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('note_1');
    expect(serialized).not.toContain('patient');
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
  });
});
