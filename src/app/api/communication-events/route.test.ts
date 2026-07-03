import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  communicationEventFindManyMock,
  communicationEventCreateMock,
  fileAssetFindManyMock,
  careReportFindManyMock,
  visitRecordFindManyMock,
  patientFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  learnContactProfileFromCommunicationMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationEventFindManyMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  fileAssetFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
      findFirst: vi.fn(),
    },
    fileAsset: {
      findMany: fileAssetFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  learnContactProfileFromCommunication: learnContactProfileFromCommunicationMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(query = 'patient_id=patient_1') {
  return new NextRequest(`http://localhost/api/communication-events?${query}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communication-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/communication-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"event_type":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/communication-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationEventFindManyMock.mockResolvedValue([{ id: 'event_1', event_type: 'fax' }]);
    fileAssetFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    visitRecordFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    communicationEventCreateMock.mockResolvedValue({
      id: 'event_2',
      counterpart_name: undefined,
      counterpart_contact: undefined,
      channel: 'fax',
      direction: 'outbound',
      occurred_at: new Date('2026-03-30T01:00:00.000Z'),
    });
    learnContactProfileFromCommunicationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationEvent: {
          create: communicationEventCreateMock,
        },
        fileAsset: {
          findMany: fileAssetFindManyMock,
        },
        careReport: {
          findMany: careReportFindManyMock,
        },
        visitRecord: {
          findMany: visitRecordFindManyMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
      }),
    );
  });

  it('lists communication events', async () => {
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(communicationEventFindManyMock.mock.calls[0][0].where).not.toHaveProperty('AND');
    expect(communicationEventFindManyMock.mock.calls[0][0].orderBy).toEqual([
      { occurred_at: 'desc' },
      { id: 'desc' },
    ]);
    expect(communicationEventFindManyMock.mock.calls[0][0].select).toMatchObject({
      attachments: true,
    });
  });

  it('treats omitted optional filters as absent when listing communication events', async () => {
    const response = (await GET(createGetRequest('')))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
      }),
    );
    const where = communicationEventFindManyMock.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('patient_id');
    expect(where).not.toHaveProperty('event_type');
    expect(where).not.toHaveProperty('AND');
  });

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
    [`patient_id=${'a'.repeat(101)}`, 'patient_id', '患者IDの形式が不正です'],
    ['event_type=%20%20', 'event_type', 'イベントタイプを指定してください'],
    ['event_type=fax%20', 'event_type', 'イベントタイプの形式が不正です'],
    [`event_type=${'a'.repeat(101)}`, 'event_type', 'イベントタイプの形式が不正です'],
  ])(
    'rejects blank or padded communication event filter query "%s" before assignment scope',
    async (query, fieldName, message) => {
      const response = (await GET(createGetRequest(query)))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [message],
        },
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(communicationEventFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
    ['event_type=fax&event_type=', 'event_type'],
  ])(
    'rejects duplicate communication event filter query "%s" before assignment scope',
    async (query, fieldName) => {
      const response = (await GET(createGetRequest(query)))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(communicationEventFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('returns a sanitized no-store 500 when communication event listing fails unexpectedly', async () => {
    communicationEventFindManyMock.mockRejectedValueOnce(
      new Error('raw communication event patient counterpart secret'),
    );

    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient counterpart secret');
  });

  it('lets an org-wide role create an event for any in-org case without assignment scoping', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_2',
        case_id: 'case_2',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(communicationEventCreateMock).toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalled();
  });

  it('rejects non-object request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createPostRequest(['unexpected'])))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('creates a communication event', async () => {
    const response = (await POST(
      createPostRequest({
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(communicationEventCreateMock).toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      counterpartName: undefined,
      counterpartContact: undefined,
      channel: 'fax',
      occurredAt: expect.anything(),
      markSuccess: true,
    });
  });

  it('returns a sanitized no-store 500 when communication event creation fails unexpectedly', async () => {
    communicationEventCreateMock.mockRejectedValueOnce(
      new Error('田中 花子 ケアマネ raw communication event create failure'),
    );

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        subject: '患者宅の状況共有',
        content: '田中 花子さんの服薬状況を相談',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('田中 花子');
    expect(bodyText).not.toContain('ケアマネ');
    expect(bodyText).not.toContain('raw communication event create failure');
    expect(bodyText).not.toContain('患者宅');
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('creates a communication event with validated patient-scoped attachments', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        purpose: 'prescription',
        original_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        status: 'uploaded',
        patient_id: 'patient_1',
        visit_record_id: null,
        report_id: null,
        completed_at: new Date('2026-03-30T01:05:00.000Z'),
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(fileAssetFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['11111111-1111-4111-8111-111111111111'] },
          org_id: 'org_1',
        },
      }),
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: [
            {
              file_id: '11111111-1111-4111-8111-111111111111',
              file_name: 'prescription.pdf',
              mime_type: 'application/pdf',
              size_bytes: 1024,
              uploaded_at: '2026-03-30T01:05:00.000Z',
              purpose: 'prescription',
            },
          ],
        }),
      }),
    );
  });

  it('allows report attachments when the report belongs to the event case patient', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        purpose: 'report',
        original_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        status: 'uploaded',
        patient_id: null,
        visit_record_id: null,
        report_id: 'report_1',
        completed_at: new Date('2026-03-30T01:10:00.000Z'),
      },
    ]);
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
      },
    ]);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        event_type: 'care_manager_report',
        channel: 'email',
        direction: 'outbound',
        attachments: [{ file_id: '22222222-2222-4222-8222-222222222222' }],
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'case_1',
          org_id: 'org_1',
        },
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['report_1'] },
          org_id: 'org_1',
        },
      }),
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              file_id: '22222222-2222-4222-8222-222222222222',
              purpose: 'report',
            }),
          ],
        }),
      }),
    );
  });

  it('allows visit-photo attachments when the visit record belongs to the event case patient', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        purpose: 'visit-photo',
        original_name: 'visit-photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 3072,
        status: 'uploaded',
        patient_id: null,
        visit_record_id: 'visit_record_1',
        report_id: null,
        completed_at: new Date('2026-03-30T01:15:00.000Z'),
      },
    ]);
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_record_1',
        patient_id: 'patient_1',
        schedule: {
          case_id: 'case_1',
        },
      },
    ]);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        event_type: 'visit_photo',
        channel: 'email',
        direction: 'outbound',
        attachments: [{ file_id: '55555555-5555-4555-8555-555555555555' }],
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['visit_record_1'] },
          org_id: 'org_1',
        },
      }),
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              file_id: '55555555-5555-4555-8555-555555555555',
              purpose: 'visit-photo',
            }),
          ],
        }),
      }),
    );
  });

  it('rejects visit-photo attachments from a different case before creating the event', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '66666666-6666-4666-8666-666666666666',
        purpose: 'visit-photo',
        original_name: 'other-case.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 3072,
        status: 'uploaded',
        patient_id: null,
        visit_record_id: 'visit_record_2',
        report_id: null,
        completed_at: new Date('2026-03-30T01:15:00.000Z'),
      },
    ]);
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_record_2',
        patient_id: 'patient_1',
        schedule: {
          case_id: 'case_2',
        },
      },
    ]);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        event_type: 'visit_photo',
        channel: 'email',
        direction: 'outbound',
        attachments: [{ file_id: '66666666-6666-4666-8666-666666666666' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['添付ファイルが患者またはケースに紐づいていません'],
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects missing attachment files before creating the event', async () => {
    fileAssetFindManyMock.mockResolvedValue([]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '77777777-7777-4777-8777-777777777777' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['添付ファイルが見つかりません'],
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects pending uploads before creating the event', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '88888888-8888-4888-8888-888888888888',
        purpose: 'prescription',
        original_name: 'pending.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        status: 'pending_upload',
        patient_id: 'patient_1',
        visit_record_id: null,
        report_id: null,
        completed_at: null,
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '88888888-8888-4888-8888-888888888888' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['添付ファイルがアップロード完了していません'],
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects case and patient mismatches before loading attachment files', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_2',
        case_id: 'case_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '99999999-9999-4999-8999-999999999999' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['添付先の患者とケースが一致しません'],
      },
    });
    expect(fileAssetFindManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects attachments owned by a different patient before creating the event', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        purpose: 'prescription',
        original_name: 'other-patient.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        status: 'uploaded',
        patient_id: 'patient_2',
        visit_record_id: null,
        report_id: null,
        completed_at: new Date('2026-03-30T01:05:00.000Z'),
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '33333333-3333-4333-8333-333333333333' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['添付ファイルが患者またはケースに紐づいていません'],
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported file purposes before creating the event', async () => {
    fileAssetFindManyMock.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        purpose: 'set-photo',
        original_name: 'set-photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        status: 'uploaded',
        patient_id: null,
        visit_record_id: null,
        report_id: null,
        completed_at: new Date('2026-03-30T01:05:00.000Z'),
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
        attachments: [{ file_id: '44444444-4444-4444-8444-444444444444' }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        attachments: ['通信イベントに添付できないファイル種別です'],
      },
    });
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });
});
