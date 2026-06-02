import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  conferenceNoteFindFirstMock,
  taskUpsertMock,
  conferenceNoteUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  conferenceNoteFindFirstMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
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

describe('/api/conference-notes/[id]/tasks POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      title: '定期カンファレンス',
      case_id: 'case_1',
      action_items: [
        { title: '服薬確認', assignee: '薬剤師' },
        { title: '医師へ共有', assignee: '管理者', legacy_debug: undefined },
      ],
    });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    conferenceNoteUpdateMock.mockResolvedValue({ id: 'note_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          upsert: taskUpsertMock,
        },
        conferenceNote: {
          update: conferenceNoteUpdateMock,
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
  });

  it('rejects blank note ids before loading the note or creating a task', async () => {
    const response = await POST(createRequest({ action_item_index: 1 }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });
});
