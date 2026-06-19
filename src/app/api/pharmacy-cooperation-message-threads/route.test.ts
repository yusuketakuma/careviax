import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  pharmacyVisitRequestFindFirstMock,
  threadFindManyMock,
  threadFindFirstMock,
  threadCreateMock,
  threadUpdateMock,
  messageCreateMock,
  createAuditLogEntryMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  pharmacyVisitRequestFindFirstMock: vi.fn(),
  threadFindManyMock: vi.fn(),
  threadFindFirstMock: vi.fn(),
  threadCreateMock: vi.fn(),
  threadUpdateMock: vi.fn(),
  messageCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
          actorSiteId: 'site_1',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-cooperation-message-threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-cooperation-message-threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      base_patient_id: 'patient_1',
    });
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      share_case_id: 'share_case_1',
      requested_by: 'requester_1',
      share_case: {
        id: 'share_case_1',
        base_patient_id: 'patient_1',
      },
    });
    threadFindManyMock.mockResolvedValue([
      {
        id: 'thread_1',
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        visit_request_id: null,
        context_type: 'patient_share_case',
        status: 'open',
        created_by: 'user_1',
        last_message_at: new Date('2026-06-19T01:00:00.000Z'),
        created_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_at: new Date('2026-06-19T01:00:00.000Z'),
        messages: [
          {
            id: 'message_1',
            org_id: 'org_1',
            thread_id: 'thread_1',
            sender_user_id: 'user_1',
            sender_side: 'base_pharmacy',
            body: '患者名 山田花子: A薬の確認をお願いします',
            created_at: new Date('2026-06-19T01:00:00.000Z'),
            updated_at: new Date('2026-06-19T01:00:00.000Z'),
          },
        ],
      },
    ]);
    threadFindFirstMock.mockResolvedValue(null);
    threadCreateMock.mockResolvedValue({
      id: 'thread_1',
      org_id: 'org_1',
      share_case_id: 'share_case_1',
      visit_request_id: 'visit_request_1',
      context_type: 'visit_request',
      status: 'open',
      created_by: 'user_1',
      last_message_at: null,
      created_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    messageCreateMock.mockResolvedValue({
      id: 'message_1',
      org_id: 'org_1',
      thread_id: 'thread_1',
      sender_user_id: 'user_1',
      sender_side: 'base_pharmacy',
      body: '患者名 山田花子: A薬の確認をお願いします',
      created_at: new Date('2026-06-19T01:00:00.000Z'),
      updated_at: new Date('2026-06-19T01:00:00.000Z'),
    });
    threadUpdateMock.mockResolvedValue({
      id: 'thread_1',
      org_id: 'org_1',
      share_case_id: 'share_case_1',
      visit_request_id: 'visit_request_1',
      context_type: 'visit_request',
      status: 'open',
      created_by: 'user_1',
      last_message_at: new Date('2026-06-19T01:00:00.000Z'),
      created_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_at: new Date('2026-06-19T01:00:00.000Z'),
      messages: [
        {
          id: 'message_1',
          org_id: 'org_1',
          thread_id: 'thread_1',
          sender_user_id: 'user_1',
          sender_side: 'base_pharmacy',
          body: '患者名 山田花子: A薬の確認をお願いします',
          created_at: new Date('2026-06-19T01:00:00.000Z'),
          updated_at: new Date('2026-06-19T01:00:00.000Z'),
        },
      ],
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    dispatchNotificationEventMock.mockResolvedValue([{ id: 'notification_1' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: { findFirst: patientShareCaseFindFirstMock },
        pharmacyVisitRequest: { findFirst: pharmacyVisitRequestFindFirstMock },
        pharmacyCooperationMessageThread: {
          findMany: threadFindManyMock,
          findFirst: threadFindFirstMock,
          create: threadCreateMock,
          update: threadUpdateMock,
        },
        pharmacyCooperationMessage: { create: messageCreateMock },
      }),
    );
  });

  it('lists patient-share-case threads through active share-case access and writes a compact read audit', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/pharmacy-cooperation-message-threads?share_case_id=share_case_1',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(patientShareCaseFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'share_case_1',
        org_id: 'org_1',
        status: 'active',
      }),
      select: { id: true, base_patient_id: true },
    });
    expect(JSON.stringify(patientShareCaseFindFirstMock.mock.calls[0]?.[0]?.where)).toContain(
      '"revoked_at":null',
    );
    expect(threadFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          share_case_id: 'share_case_1',
          visit_request_id: null,
        },
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_cooperation_messages_viewed',
        targetType: 'PharmacyCooperationMessageThread',
        targetId: 'thread_1',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          share_case_id: 'share_case_1',
          message_count: 1,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('A薬');

    const body = JSON.stringify(await response.json());
    expect(body).toContain('患者名 山田花子');
  });

  it('creates a visit-request message with safe audit and notification content', async () => {
    const response = await POST(
      createPostRequest({
        share_case_id: 'share_case_1',
        visit_request_id: 'visit_request_1',
        body: '患者名 山田花子: A薬の確認をお願いします',
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(pharmacyVisitRequestFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_request_1',
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        share_case: {
          is: expect.objectContaining({
            org_id: 'org_1',
            status: 'active',
          }),
        },
      }),
      select: expect.any(Object),
    });
    expect(messageCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        thread_id: 'thread_1',
        sender_user_id: 'user_1',
        sender_side: 'base_pharmacy',
        body: '患者名 山田花子: A薬の確認をお願いします',
      }),
      select: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_cooperation_message_created',
        targetType: 'PharmacyCooperationMessage',
        targetId: 'message_1',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          thread_id: 'thread_1',
          share_case_id: 'share_case_1',
          visit_request_id: 'visit_request_1',
          body_length: expect.any(Number),
        }),
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'pharmacy_cooperation_message_created',
        type: 'business',
        title: '薬局間連携メッセージ',
        message: 'アプリで詳細を確認してください',
        link: '/workflow/pharmacy-cooperation?share_case_id=share_case_1&visit_request_id=visit_request_1',
        explicitUserIds: ['requester_1'],
        metadata: expect.objectContaining({
          thread_id: 'thread_1',
          message_id: 'message_1',
          share_case_id: 'share_case_1',
          visit_request_id: 'visit_request_1',
        }),
      }),
    );

    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    const notificationText = JSON.stringify(dispatchNotificationEventMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('A薬');
    expect(notificationText).not.toContain('山田花子');
    expect(notificationText).not.toContain('A薬');

    const body = JSON.stringify(await response.json());
    expect(body).toContain('患者名 山田花子');
  });

  it('rejects inactive or inaccessible share cases before thread side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        share_case_id: 'share_case_1',
        body: 'メッセージ',
      }),
    );

    expect(response.status).toBe(404);
    expect(threadCreateMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('rejects invalid body without opening an org transaction', async () => {
    const response = await POST(
      createPostRequest({
        share_case_id: 'share_case_1',
        body: '',
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
