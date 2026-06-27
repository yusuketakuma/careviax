import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { taskCommentFindManyMock, userFindManyMock } = vi.hoisted(() => ({
  taskCommentFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    taskComment: { findMany: taskCommentFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/comments/recent', {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/comments/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only comments authored by or mentioning the viewer, with derived flags', async () => {
    taskCommentFindManyMock.mockResolvedValue([
      {
        id: 'c_1',
        entity_type: 'care_report',
        entity_id: 'report_1',
        content: '報告書の文言を直しました',
        author_id: 'user_1',
        mentions: [],
        created_at: new Date('2026-06-26T01:00:00.000Z'),
      },
      {
        id: 'c_2',
        entity_type: 'visit_record',
        entity_id: 'visit_1',
        content: '確認お願いします',
        author_id: 'user_2',
        mentions: ['user_1'],
        created_at: new Date('2026-06-26T00:00:00.000Z'),
      },
    ]);
    userFindManyMock.mockResolvedValue([
      { id: 'user_1', name: '山田 太郎' },
      { id: 'user_2', name: '鈴木 花子' },
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    expectNoStore(res!);
    const json = await res!.json();

    // viewer の関与条件で絞り込んでいる(author=自分 OR mentions に自分)
    expect(taskCommentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [{ author_id: 'user_1' }, { mentions: { has: 'user_1' } }],
        }),
      }),
    );

    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: 'c_1',
      author_name: '山田 太郎',
      authored_by_me: true,
      mentions_me: false,
    });
    expect(json.data[1]).toMatchObject({
      id: 'c_2',
      author_name: '鈴木 花子',
      authored_by_me: false,
      mentions_me: true,
    });
  });

  it('returns an empty list without loading authors when there are no comments', async () => {
    taskCommentFindManyMock.mockResolvedValue([]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    expectNoStore(res!);
    const json = await res!.json();
    expect(json.data).toEqual([]);
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when recent comment loading fails', async () => {
    taskCommentFindManyMock.mockRejectedValueOnce(
      new Error('raw patient comment recent feed secret'),
    );

    const res = await GET(createRequest(), { params: Promise.resolve({}) });

    expect(res!.status).toBe(500);
    expectNoStore(res!);
    const bodyText = await res!.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient comment recent feed secret');
  });
});
