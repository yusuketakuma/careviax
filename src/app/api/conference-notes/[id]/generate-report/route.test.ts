import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  conferenceNoteFindFirstMock,
  conferenceNoteUpdateMock,
  conferenceNoteQueryRawMock,
  careCaseFindFirstMock,
  careReportFindManyMock,
  careReportCreateManyMock,
  deliveryRecordFindManyMock,
  deliveryRecordCreateManyMock,
  auditLogCreateMock,
  withOrgContextMock,
  authContextFailureMock,
} = vi.hoisted(() => ({
  conferenceNoteFindFirstMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  conferenceNoteQueryRawMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateManyMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  deliveryRecordCreateManyMock: vi.fn(),
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
  return new NextRequest('http://localhost/api/conference-notes/note_1/generate-report', {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/conference-notes/note_1/generate-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"report_type":',
  });
}

describe('/api/conference-notes/[id]/generate-report POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextFailureMock.mockReset();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      case_id: 'case_1',
      patient_id: 'patient_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '本文サマリー',
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      participants: [
        {
          name: '佐藤CM',
          role: 'care_manager',
          attended: true,
          is_report_recipient: true,
          email: 'cm@example.com',
        },
      ],
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: null,
      generated_report_id: null,
      action_items: [],
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
    });
    careReportFindManyMock.mockImplementation(
      async (args?: { where?: { report_type?: { in?: string[] } } }) => {
        if (args?.where?.report_type?.in?.length) {
          return [{ id: 'report_cm_1', report_type: args.where.report_type.in[0] }];
        }
        return [];
      },
    );
    careReportCreateManyMock.mockResolvedValue({ count: 1 });
    deliveryRecordFindManyMock.mockResolvedValue([]);
    deliveryRecordCreateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    conferenceNoteUpdateMock.mockResolvedValue({
      id: 'note_1',
      generated_report_id: 'report_cm_1',
    });
    conferenceNoteQueryRawMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        $queryRaw: conferenceNoteQueryRawMock,
        conferenceNote: {
          findFirst: conferenceNoteFindFirstMock,
          update: conferenceNoteUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        careReport: {
          findMany: careReportFindManyMock,
          createMany: careReportCreateManyMock,
        },
        deliveryRecord: {
          findMany: deliveryRecordFindManyMock,
          createMany: deliveryRecordCreateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('creates a care manager report draft and queues draft delivery records', async () => {
    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(careReportCreateManyMock).toHaveBeenCalledTimes(1);
    expect(conferenceNoteQueryRawMock).toHaveBeenCalledTimes(1);
    expect(deliveryRecordCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            report_id: 'report_cm_1',
            channel: 'email',
            recipient_name: '佐藤CM',
            recipient_contact: 'cm@example.com',
            delivery_intent_key: 'conf_delivery_59e3fb760b54be256c152688bd6cd282',
            status: 'draft',
          }),
        ]),
        skipDuplicates: true,
      }),
    );
    expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data: {
        generated_report_id: 'report_cm_1',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: 'patient_1',
        action: 'conference_note.report_generated',
        target_type: 'conference_note',
        target_id: 'note_1',
        changes: {
          conference_note: {
            note_type: 'service_manager',
            report_type: 'care_manager_report',
            report_draft_ids: ['report_cm_1'],
            queued_recipient_count: 1,
          },
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });

    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        report_draft_count: 1,
        queued_recipient_count: 1,
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('cm@example.com');
    expect(serialized).not.toContain('佐藤CM');
    expect(serialized).not.toContain('report_cm_1');
  });

  it('rejects blank note ids before loading the note or generating drafts', async () => {
    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
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
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the note or generating drafts', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the note or generating drafts', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('returns no-store not-found before generating drafts', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
      params: Promise.resolve({ id: 'note_missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録が見つかりません',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(conferenceNoteQueryRawMock).toHaveBeenCalledTimes(1);
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('validates report type against the locked current note before generating drafts', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce({
      id: 'note_1',
      case_id: 'case_1',
      patient_id: 'patient_1',
      note_type: 'care_team',
      title: '薬剤師間カンファレンス',
      content: '本文サマリー',
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      participants: [
        {
          name: '佐藤CM',
          role: 'care_manager',
          attended: true,
          is_report_recipient: true,
          email: 'cm@example.com',
        },
      ],
      structured_content: {
        template: 'care_team',
        sections: [{ key: 'case_review', label: '症例検討', body: '服薬状況の確認' }],
      },
      metadata: null,
      generated_report_id: null,
      action_items: [],
    });

    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'この会議種別では指定された報告書種別を生成できません',
    });
    expect(conferenceNoteQueryRawMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected report generation failures and keeps sensitive responses no-store', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw patient_1 cm@example.com conference report failure'),
    );

    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
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
    expect(serialized).not.toContain('patient_1');
    expect(serialized).not.toContain('cm@example.com');
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
  });

  it('sanitizes auth plumbing failures before loading the note', async () => {
    authContextFailureMock.mockReturnValueOnce(
      new Error('raw auth patient_1 cm@example.com conference report failure'),
    );

    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
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
    expect(serialized).not.toContain('patient_1');
    expect(serialized).not.toContain('cm@example.com');
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('keeps empty request bodies as default report generation', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(conferenceNoteFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'note_1',
          org_id: 'org_1',
        },
      }),
    );
    expect(careReportCreateManyMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        report_draft_count: 1,
      },
    });
  });

  it('does not create duplicate delivery drafts when the same recipient is already queued', async () => {
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        report_id: 'report_cm_1',
        channel: 'email',
        recipient_contact: 'cm@example.com',
      },
    ]);

    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        queued_recipient_count: 0,
      },
    });
  });

  it('does not create duplicate delivery drafts when the delivery intent key already exists', async () => {
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        report_id: 'report_cm_1',
        channel: 'email',
        recipient_contact: 'cm@example.com',
        delivery_intent_key: 'conf_delivery_59e3fb760b54be256c152688bd6cd282',
      },
    ]);

    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        queued_recipient_count: 0,
      },
    });
  });

  it('can generate a report without structured content in the body', async () => {
    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        include_structured_content: false,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            content: expect.objectContaining({
              body: '',
              sections: [],
              disclosure_scope: expect.objectContaining({
                audience: 'care_manager_report',
                sanitized: true,
                included_section_keys: [],
              }),
            }),
          }),
        ]),
      }),
    );
  });

  it('generates a report for a patient-scoped conference note without a case', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce({
      id: 'note_patient_only',
      case_id: null,
      patient_id: 'patient_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '本文サマリー',
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      participants: [],
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: null,
      generated_report_id: null,
      action_items: [],
    });

    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
      params: Promise.resolve({ id: 'note_patient_only' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            patient_id: 'patient_1',
            case_id: null,
            report_type: 'care_manager_report',
          }),
        ]),
      }),
    );
  });
});
