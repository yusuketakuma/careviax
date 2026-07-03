import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  communicationRequestFindManyMock,
  communicationRequestFindFirstMock,
  communicationRequestCreateMock,
  careReportFindFirstMock,
  tracingReportFindFirstMock,
  patientFindFirstMock,
  patientFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  findLatestPrescriberInstitutionSuggestionMock,
  pickCommunicationRecipientCandidateMock,
  advisoryLockMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindManyMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  findLatestPrescriberInstitutionSuggestionMock: vi.fn(),
  pickCommunicationRecipientCandidateMock: vi.fn(),
  advisoryLockMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest & { role?: string }) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: (req.role ?? 'pharmacist') as 'pharmacist',
      });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findMany: communicationRequestFindManyMock,
      findFirst: communicationRequestFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
    },
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
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

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: advisoryLockMock,
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: findLatestPrescriberInstitutionSuggestionMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  pickCommunicationRecipientCandidate: pickCommunicationRecipientCandidateMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const CARE_REPORT_UPDATED_AT = new Date('2026-06-18T01:02:03.000Z');
const CARE_REPORT_UPDATED_AT_ISO = CARE_REPORT_UPDATED_AT.toISOString();

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/communication-requests${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communication-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/communication-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"request_type":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/communication-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationRequestFindManyMock.mockResolvedValue([{ id: 'request_1', status: 'draft' }]);
    communicationRequestFindFirstMock.mockResolvedValue(null);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_2', status: 'draft' });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_record_1',
      updated_at: CARE_REPORT_UPDATED_AT,
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue(null);
    pickCommunicationRecipientCandidateMock.mockResolvedValue(null);
    advisoryLockMock.mockResolvedValue(undefined);
    // reply/queue dedup の存在チェックは tx 内で行うため、tx クライアントにも findFirst を提供する。
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          findFirst: communicationRequestFindFirstMock,
          create: communicationRequestCreateMock,
        },
      }),
    );
  });

  it('lists communication requests', async () => {
    const response = (await GET(
      createGetRequest('?status=draft&request_type=care_report_reply_request'),
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    // 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
    // buildCommunicationRequestAssignmentWhere が null を返し、WHERE に AND の担当割当句は付与されない。
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'draft',
          request_type: 'care_report_reply_request',
        }),
      }),
    );
    expect(communicationRequestFindManyMock.mock.calls[0][0].where).not.toHaveProperty('AND');
  });

  it('rejects care report request lists when the caller cannot send reports', async () => {
    const response = (await GET(
      Object.assign(createGetRequest('?related_entity_type=care_report'), { role: 'clerk' }),
    ))!;

    expect(response.status).toBe(403);
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('excludes care report request rows from broad lists for report-only callers', async () => {
    const response = (await GET(Object.assign(createGetRequest(), { role: 'clerk' })))!;

    expect(response.status).toBe(200);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { related_entity_type: 'care_report' },
        }),
      }),
    );
  });

  it('uses stable cursor pagination when listing communication requests', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce([
      { id: 'request_2', requested_at: new Date('2026-06-18T00:01:00.000Z') },
      { id: 'request_1', requested_at: new Date('2026-06-18T00:00:00.000Z') },
    ]);

    const response = (await GET(createGetRequest('?limit=1&cursor=request_cursor')))!;

    expect(response.status).toBe(200);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 'request_cursor' },
        skip: 1,
        orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'request_2' }],
      hasMore: true,
      nextCursor: 'request_2',
    });
  });

  it('returns a validation error for a stale pagination cursor', async () => {
    communicationRequestFindManyMock.mockRejectedValueOnce({ code: 'P2025' });

    const response = (await GET(createGetRequest('?limit=1&cursor=deleted_request')))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ページカーソルが不正です',
      details: {
        cursor: ['指定されたカーソルの連携依頼が見つかりません'],
      },
    });
  });

  it('returns a sanitized no-store 500 when list lookup fails unexpectedly', async () => {
    communicationRequestFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 raw communication request content context snapshot'),
    );

    const response = (await GET(createGetRequest('?status=draft')))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw communication request');
    expect(JSON.stringify(body)).not.toContain('context snapshot');
  });

  it('trims scoped search filters before listing communication requests', async () => {
    const response = (await GET(
      createGetRequest(
        '?status=%20draft%20&request_type=%20tracing_report%20&patient_id=%20patient_1%20&related_entity_type=%20tracing_report%20&related_entity_id=%20tracing_1%20',
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'draft',
          request_type: 'tracing_report',
          patient_id: 'patient_1',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing_1',
        }),
      }),
    );
  });

  it.each([
    ['status', '?status=', { status: ['ステータスを指定してください'] }],
    ['blank status', '?status=%20%20', { status: ['ステータスを指定してください'] }],
    ['request_type', '?request_type=', { request_type: ['依頼種別を指定してください'] }],
    [
      'blank request_type',
      '?request_type=%20%20',
      { request_type: ['依頼種別を指定してください'] },
    ],
    ['patient_id', '?patient_id=', { patient_id: ['患者IDを指定してください'] }],
    ['blank patient_id', '?patient_id=%20%20', { patient_id: ['患者IDを指定してください'] }],
    [
      'related_entity_type',
      '?related_entity_type=',
      { related_entity_type: ['関連種別を指定してください'] },
    ],
    [
      'blank related_entity_type',
      '?related_entity_type=%20%20',
      { related_entity_type: ['関連種別を指定してください'] },
    ],
    [
      'related_entity_id',
      '?related_entity_id=',
      { related_entity_id: ['関連IDを指定してください'] },
    ],
    [
      'blank related_entity_id',
      '?related_entity_id=%20%20',
      { related_entity_id: ['関連IDを指定してください'] },
    ],
  ])('rejects explicitly empty %s filters before listing', async (_label, query, details) => {
    const response = (await GET(createGetRequest(query)))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details,
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid status filter', async () => {
    const response = (await GET(createGetRequest('?status=foo')))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a communication request', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_type: '疑義照会',
        requested_by: 'user_1',
        context_snapshot: {},
      }),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
  });

  it('detects a concurrently-created reply request inside the transaction and skips insert (TOCTOU guard)', async () => {
    // レース: tx 外の dedup 窓を塞ぎ、advisory lock 取得後の tx 内 re-read で既存の
    // open reply が見つかった場合は create せず 409 を返す。X06 の回帰確認。
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_racing',
      status: 'sent',
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: 'care_report_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        subject: '返信依頼',
        content: '報告書の確認をお願いします',
        status: 'sent',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'この相手への返信依頼は既に起票されています',
      details: { request_id: 'request_racing', status: 'sent' },
    });
    // advisory lock は tx 内・re-read 前に取得され、dedup は tx クライアント上で行われる。
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'communication_request_reply_dedup',
      expect.any(String),
    );
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('normalizes request identity and text fields before assignment checks and persistence', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: ' patient_1 ',
        case_id: ' case_1 ',
        request_type: ' 疑義照会 ',
        template_key: ' template_a ',
        recipient_name: ' 在宅主治医 ',
        recipient_role: ' physician ',
        related_entity_type: ' care_report ',
        related_entity_id: ' report_1 ',
        subject: ' 確認事項 ',
        content: ' 処方内容を確認したいです ',
        status: ' sent ',
        due_date: ' 2026-03-31 ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: '疑義照会',
        template_key: 'template_a',
        recipient_name: '在宅主治医',
        recipient_role: 'physician',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        subject: '確認事項',
        content: '処方内容を確認したいです',
        status: 'sent',
        due_date: new Date('2026-03-31'),
      }),
    });
  });

  it('normalizes care report communication scope from the linked report', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: '疑義照会',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        visit_record_id: true,
        updated_at: true,
      },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
      }),
    });
  });

  it('creates interprofessional care-report reply requests when the expected report version matches', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: 'care_report_reply_request',
        template_key: 'interprofessional_share_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        context_snapshot: {
          source: 'interprofessional_share',
          report_id: 'report_1',
        },
        subject: '返信依頼',
        content: '報告書の確認をお願いします',
        status: 'sent',
        expected_report_updated_at: CARE_REPORT_UPDATED_AT_ISO,
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(communicationRequestFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        request_type: 'care_report_reply_request',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
      }),
      select: { id: true, status: true },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        template_key: 'interprofessional_share_reply_request',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        context_snapshot: {
          source: 'interprofessional_share',
          report_id: 'report_1',
        },
      }),
    });
    expect(communicationRequestCreateMock.mock.calls[0][0].data).not.toHaveProperty(
      'expected_report_updated_at',
    );
  });

  it('requires a report version for interprofessional care-report reply requests', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: 'care_report_reply_request',
        template_key: 'interprofessional_share_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        context_snapshot: {
          source: 'interprofessional_share',
          report_id: 'report_1',
        },
        subject: '返信依頼',
        content: '報告書の確認をお願いします',
        status: 'sent',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書の版情報は必須です',
      details: {
        expected_report_updated_at: ['報告書の版情報は必須です'],
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects stale interprofessional care-report reply requests before duplicate checks', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: 'care_report_reply_request',
        template_key: 'interprofessional_share_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        context_snapshot: {
          source: 'interprofessional_share',
          report_id: 'report_1',
        },
        subject: '返信依頼',
        content: '報告書の確認をお願いします',
        status: 'sent',
        expected_report_updated_at: '2026-06-18T00:00:00.000Z',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '報告書が更新されています。再読み込みしてから返信依頼を起票してください',
      details: {
        report_id: 'report_1',
        current_report_updated_at: CARE_REPORT_UPDATED_AT_ISO,
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('requires a related care report id before creating care report communication requests', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: '疑義照会',
        related_entity_type: 'care_report',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects missing linked care reports before request creation', async () => {
    careReportFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createPostRequest({
        request_type: '疑義照会',
        related_entity_type: 'care_report',
        related_entity_id: 'report_missing',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched care report communication patient or case scope', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_other',
        case_id: 'case_1',
        request_type: '疑義照会',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        related_entity_id: ['関連報告書と患者またはケースが一致しません'],
      },
    });
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects care report communication request creation when the caller cannot send reports', async () => {
    const response = (await POST(
      Object.assign(
        createPostRequest({
          patient_id: 'patient_1',
          request_type: '疑義照会',
          related_entity_type: 'care_report',
          related_entity_id: 'report_1',
          subject: '確認事項',
          content: '処方内容を確認したいです',
        }),
        { role: 'clerk' },
      ),
    ))!;

    expect(response.status).toBe(403);
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate open care-report reply requests before creating another request', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_existing',
      status: 'sent',
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: 'care_report_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        subject: '返信依頼',
        content: '報告書の確認をお願いします',
        status: 'sent',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この相手への返信依頼は既に起票されています',
      details: {
        request_id: 'request_existing',
        status: 'sent',
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        request_type: 'care_report_reply_request',
        patient_id: 'patient_1',
        case_id: 'case_1',
        recipient_role: 'care_manager',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        status: {
          in: ['draft', 'sent', 'received', 'in_progress', 'responded', 'escalated'],
        },
      }),
      select: { id: true, status: true },
    });
    // dedup チェックは tx 内で advisory lock 取得後に行われるため withOrgContext は呼ばれる。
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'communication_request_reply_dedup',
      expect.any(String),
    );
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate open patient-share reply requests before creating another request', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'patient_request_existing',
      status: 'in_progress',
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: 'patient_share_reply_request',
        recipient_role: 'care_manager',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        subject: '返信依頼',
        content: '患者共有の確認をお願いします',
        status: 'sent',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        request_id: 'patient_request_existing',
        status: 'in_progress',
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        request_type: 'patient_share_reply_request',
        patient_id: 'patient_1',
        case_id: null,
        recipient_role: 'care_manager',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
      select: { id: true, status: true },
    });
    // dedup チェックは tx 内で advisory lock 取得後に行われるため withOrgContext は呼ばれる。
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'communication_request_reply_dedup',
      expect.any(String),
    );
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('reuses an active workflow emergency draft instead of creating a duplicate', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_existing',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: null,
      request_type: 'emergency_physician',
      template_key: 'emergency_physician',
      recipient_name: '青葉医師',
      recipient_role: 'physician',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      context_snapshot: {
        source: 'communication_queue',
        template_key: 'emergency_physician',
      },
      status: 'draft',
      subject: '佐藤花子 の緊急連絡',
      content: '急変時共有をお願いします',
      requested_by: 'user_1',
      requested_at: new Date('2026-06-18T00:00:00.000Z'),
      due_date: null,
      created_at: new Date('2026-06-18T00:00:00.000Z'),
      updated_at: new Date('2026-06-18T00:00:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: 'emergency_physician',
        template_key: 'emergency_physician',
        recipient_name: '青葉医師',
        recipient_role: 'physician',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        context_snapshot: {
          source: 'communication_queue',
          template_key: 'emergency_physician',
        },
        status: 'draft',
        subject: '佐藤花子 の緊急連絡',
        content: '急変時共有をお願いします',
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'request_existing',
        status: 'draft',
      },
      reused_existing_draft: true,
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        request_type: 'emergency_physician',
        patient_id: 'patient_1',
        case_id: null,
        template_key: 'emergency_physician',
        recipient_role: 'physician',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        status: {
          in: ['draft', 'sent', 'received', 'in_progress', 'responded', 'escalated'],
        },
        context_snapshot: { path: ['source'], equals: 'communication_queue' },
      },
      select: expect.objectContaining({
        id: true,
        context_snapshot: true,
        status: true,
      }),
      orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
    });
    // queue draft の再利用判定も tx 内で advisory lock 取得後に行われる。
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'communication_request_queue_dedup',
      expect.any(String),
    );
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before recipient suggestions or request creation', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(409);
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank required request fields before assignment checks or suggestions', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: '   ',
        subject: '   ',
        content: '   ',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional fields before writing standalone requests', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: '   ',
        case_id: '   ',
        request_type: '疑義照会',
        template_key: '   ',
        recipient_name: '   ',
        recipient_role: '   ',
        related_entity_type: '   ',
        related_entity_id: '   ',
        subject: '確認事項',
        content: '処方内容を確認したいです',
        due_date: '   ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: null,
        case_id: null,
        template_key: null,
        recipient_name: null,
        recipient_role: null,
        related_entity_type: null,
        related_entity_id: null,
        due_date: null,
      }),
    });
  });

  it('returns a sanitized no-store 500 when request creation fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw communication request creation detail'),
    );

    const response = (await POST(
      createPostRequest({
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);

    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw communication request creation detail');
  });

  it('rejects non-object request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createPostRequest(['unexpected'])))!;

    expect(response.status).toBe(400);
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('allows an in-org case for org-wide roles even without a per-assignment match', async () => {
    // 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)。
    // 担当割当が無くても、同一組織内のケース/患者であれば作成は許可される。
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_2',
        case_id: 'case_2',
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_2',
        case_id: 'case_2',
        request_type: '疑義照会',
        requested_by: 'user_1',
      }),
    });
  });

  it('derives patient and case from an accessible linked tracing report', async () => {
    const response = (await POST(
      createPostRequest({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
      },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
      }),
    });
  });

  it('rejects a cross-case tracing report link before create side effects', async () => {
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_2',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '関連トレーシングレポートと患者またはケースが一致しません',
    });
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('allows a linked in-org tracing report for org-wide roles regardless of assignment', async () => {
    // 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)。
    // 同一組織内のトレーシングレポートは担当割当の有無に関わらずアクセス可能。
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
      }),
    });
  });

  it('fills the recipient from the latest prescriber institution when missing', async () => {
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      address: '東京都港区1-1-1',
      prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
      prescriber_name: '田中 一郎',
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: '疑義照会',
        context_snapshot: {
          draft_note: undefined,
          explicit_null: null,
        },
        subject: '処方確認',
        content: '用量の確認をお願いします',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(findLatestPrescriberInstitutionSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
      },
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_name: '田中 一郎',
        recipient_role: '処方元医療機関',
        context_snapshot: {
          explicit_null: null,
          prescriber_institution_id: 'institution_1',
          prescriber_institution_name: 'みなとクリニック',
        },
      }),
    });
    expect(
      (
        communicationRequestCreateMock.mock.calls[0][0].data.context_snapshot as Record<
          string,
          unknown
        >
      ).draft_note,
    ).toBeUndefined();
  });

  it('falls back to an external professional when no institution suggestion exists', async () => {
    pickCommunicationRecipientCandidateMock.mockResolvedValue({
      id: 'external_1',
      name: '山田 ケアマネ',
      profession_type: 'care_manager',
      organization_name: '居宅支援A',
      department: null,
      phone: '03-4444-5555',
      email: null,
      fax: '03-4444-6666',
      preferred_contact_method: 'fax',
      preferred_contact_time: '平日 14:00-17:00',
      last_contacted_at: null,
      last_success_channel: 'fax',
      recommended_channels: ['fax', 'phone'],
      is_primary: true,
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: 'care_manager_coordination',
        subject: '訪問日調整',
        content: '来週の訪問日を相談したいです',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(pickCommunicationRecipientCandidateMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
        requestType: 'care_manager_coordination',
      },
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_name: '山田 ケアマネ',
        recipient_role: '居宅支援A',
        context_snapshot: {
          external_professional_id: 'external_1',
          external_professional_name: '山田 ケアマネ',
          external_professional_profession_type: 'care_manager',
          preferred_contact_method: 'fax',
          preferred_contact_time: '平日 14:00-17:00',
          recommended_channels: ['fax', 'phone'],
        },
      }),
    });
  });
});
