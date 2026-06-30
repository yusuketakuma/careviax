import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { feedbackFindManyMock, feedbackCreateMock, withOrgContextMock, createAuditLogEntryMock } =
  vi.hoisted(() => ({
    feedbackFindManyMock: vi.fn(),
    feedbackCreateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    createAuditLogEntryMock: vi.fn(),
  }));

const emptyRouteContext = { params: Promise.resolve({}) };
type UatFeedbackRow = {
  id: string;
  org_id: string;
  submitted_by: string;
  priority: string;
  status: string;
  owner_user_id: string | null;
  feedback: string;
  checklist_progress: string | null;
  checked_items: string[] | null;
  source: string | null;
  linked_work_item: string | null;
  due_date: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function buildFeedbackRow(overrides: Partial<UatFeedbackRow> = {}): UatFeedbackRow {
  return {
    id: 'feedback_1',
    org_id: 'org_1',
    submitted_by: 'user_1',
    priority: 'high',
    status: 'open',
    owner_user_id: null,
    feedback: '訪問後の戻る導線を改善したい',
    checklist_progress: '4/7',
    checked_items: ['flow_patient_to_report'],
    source: 'pilot_pharmacy',
    linked_work_item: null,
    due_date: null,
    resolved_at: null,
    created_at: new Date('2026-03-28T12:00:00.000Z'),
    updated_at: new Date('2026-03-28T12:00:00.000Z'),
    ...overrides,
  };
}

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'admin' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    uatFeedback: {
      findMany: feedbackFindManyMock,
      create: feedbackCreateMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET, POST } from './route';

function createAuthRequest(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest('http://localhost/api/admin/uat-feedback', init);
}

function createJsonAuthRequest(body: unknown) {
  return createAuthRequest({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonAuthRequest() {
  return createAuthRequest({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

describe('/api/admin/uat-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        uatFeedback: {
          create: feedbackCreateMock,
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    feedbackFindManyMock.mockResolvedValue([buildFeedbackRow()]);
    feedbackCreateMock.mockResolvedValue({
      id: 'feedback_2',
      org_id: 'org_1',
      submitted_by: 'user_1',
      priority: 'medium',
      status: 'open',
      owner_user_id: null,
      feedback: '帳票の余白が広い',
      checklist_progress: '5/7',
      checked_items: ['check_mobile'],
      source: 'pilot_pharmacy',
      linked_work_item: null,
      due_date: null,
      resolved_at: null,
      created_at: new Date('2026-03-28T13:00:00.000Z'),
      updated_at: new Date('2026-03-28T13:00:00.000Z'),
    });
  });

  it('lists persisted UAT feedback', async () => {
    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(feedbackFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: [{ created_at: 'desc' }],
      take: 101,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'feedback_1',
          checked_items: ['flow_patient_to_report'],
          created_at: '2026-03-28T12:00:00.000Z',
          updated_at: '2026-03-28T12:00:00.000Z',
        },
      ],
      meta: { limit: 100, has_more: false },
    });
  });

  it('reports overflow without returning more than the fixed list limit', async () => {
    feedbackFindManyMock.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) =>
        buildFeedbackRow({
          id: `feedback_${index + 1}`,
          created_at: new Date(`2026-03-28T12:${String(index % 60).padStart(2, '0')}:00.000Z`),
          updated_at: new Date(`2026-03-28T12:${String(index % 60).padStart(2, '0')}:00.000Z`),
        }),
      ),
    );

    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(100);
    expect(payload.data.at(-1).id).toBe('feedback_100');
    expect(payload.meta).toEqual({ limit: 100, has_more: true });
  });

  it('returns a sensitive no-store internal error without leaking raw list failures', async () => {
    const rawErrorMessage = 'raw uat feedback list failure';
    feedbackFindManyMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.text()).resolves.not.toContain(rawErrorMessage);
  });

  it('stores feedback with checklist state', async () => {
    const response = await POST(
      createJsonAuthRequest({
        priority: 'medium',
        feedback: '帳票の余白が広い',
        checklist_progress: '5/7',
        checked_items: ['check_mobile'],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(feedbackCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        submitted_by: 'user_1',
        priority: 'medium',
        status: 'open',
        owner_user_id: null,
        feedback: '帳票の余白が広い',
        checklist_progress: '5/7',
        checked_items: ['check_mobile'],
        source: 'pilot_pharmacy',
        linked_work_item: null,
        due_date: null,
        resolved_at: null,
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uatFeedback: expect.any(Object),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      expect.objectContaining({
        action: 'uat_feedback_created',
        targetType: 'UatFeedback',
        targetId: 'feedback_2',
        changes: expect.objectContaining({
          priority: 'medium',
          status: 'open',
          source: 'pilot_pharmacy',
          checklist_progress: '5/7',
          checked_items_count: 1,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls[0]?.[2])).not.toContain(
      '帳票の余白が広い',
    );
  });

  it('rejects non-object POST payloads before feedback creation', async () => {
    const response = await POST(createJsonAuthRequest([]), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(feedbackCreateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST payloads before feedback creation', async () => {
    const response = await POST(createMalformedJsonAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(feedbackCreateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sensitive no-store internal error without leaking raw create failures', async () => {
    const rawErrorMessage = 'raw uat feedback create failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = await POST(
      createJsonAuthRequest({
        priority: 'medium',
        feedback: '帳票の余白が広い',
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.text()).resolves.not.toContain(rawErrorMessage);
  });
});
