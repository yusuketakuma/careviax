import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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
    const body = await response.json();
    expect(body).toMatchObject({
      data: [{ id: 'request_2' }],
      meta: {
        limit: 1,
        has_more: true,
        next_cursor: 'request_2',
      },
    });
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
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
});
