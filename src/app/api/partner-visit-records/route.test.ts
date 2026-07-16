import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authPlumbingFailureRef,
  withOrgContextMock,
  acquireAdvisoryTxLockMock,
  partnerVisitRecordFindManyMock,
  partnerVisitRecordCountMock,
  partnerVisitRecordGroupByMock,
  pharmacyVisitRequestFindFirstMock,
  pharmacyVisitRequestUpdateManyMock,
  sourceVisitRecordFindFirstMock,
  partnerVisitRecordFindFirstMock,
  partnerVisitRecordCreateMock,
  partnerVisitRecordUpdateManyMock,
  partnerVisitRecordFindUniqueOrThrowMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authPlumbingFailureRef: { current: null as Error | null },
  withOrgContextMock: vi.fn(),
  acquireAdvisoryTxLockMock: vi.fn(),
  partnerVisitRecordFindManyMock: vi.fn(),
  partnerVisitRecordCountMock: vi.fn(),
  partnerVisitRecordGroupByMock: vi.fn(),
  pharmacyVisitRequestFindFirstMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  sourceVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordCreateMock: vi.fn(),
  partnerVisitRecordUpdateManyMock: vi.fn(),
  partnerVisitRecordFindUniqueOrThrowMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) => {
      if (authPlumbingFailureRef.current) {
        throw authPlumbingFailureRef.current;
      }
      return handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: acquireAdvisoryTxLockMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/partner-visit-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/partner-visit-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/partner-visit-records${query}`);
}

describe('/api/partner-visit-records', () => {
  const patientSafeRelation = {
    display_id: 'PT-0001',
    name: '山田 花子',
    name_kana: 'ヤマダ ハナコ',
    birth_date: new Date('1950-01-02T00:00:00.000Z'),
    updated_at: new Date('2026-06-18T00:00:00.000Z'),
  };

  const withPatientSafeRelation = <T extends object>(row: T) => ({
    ...row,
    share_case: { base_patient: patientSafeRelation },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authPlumbingFailureRef.current = null;
    acquireAdvisoryTxLockMock.mockResolvedValue(undefined);
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'accepted',
      share_case_id: 'share_case_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      share_case: {
        status: 'active',
        base_patient_id: 'patient_1',
      },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    sourceVisitRecordFindFirstMock.mockResolvedValue({ id: 'visit_record_1' });
    partnerVisitRecordFindFirstMock.mockResolvedValue(null);
    partnerVisitRecordCreateMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      revision_no: 1,
      status: 'draft',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      record_content: {
        medication_adherence: '患者名 山田花子: 飲み忘れあり',
        remaining_medications: 'A薬 10錠',
      },
      attachments: [{ file_id: 'file_1' }],
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
      claim_note: null,
    });
    partnerVisitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      revision_no: 1,
      status: 'draft',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
      claim_note: null,
    });
    partnerVisitRecordFindManyMock.mockResolvedValue([
      {
        id: 'partner_visit_record_1',
        org_id: 'org_1',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_pharmacy_1',
        source_visit_record_id: 'visit_record_1',
        revision_no: 1,
        status: 'submitted',
        pharmacist_id: 'pharmacist_1',
        pharmacist_name: '協力 太郎',
        visit_at: new Date('2026-06-20T01:30:00.000Z'),
        submitted_at: new Date('2026-06-20T02:00:00.000Z'),
        confirmed_at: null,
        confirmed_by: null,
        returned_at: null,
        returned_by: null,
        created_at: new Date('2026-06-20T01:30:00.000Z'),
        updated_at: new Date('2026-06-20T02:00:00.000Z'),
        record_content: {
          medication_adherence: '患者名 山田花子: 飲み忘れあり',
          remaining_medications: 'A薬 10錠',
        },
        attachments: [{ file_id: 'file_1' }],
        returned_reason: null,
        base_confirmation_snapshot: null,
        owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
        visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
        claim_note: null,
      },
    ]);
    partnerVisitRecordCountMock.mockResolvedValue(1);
    partnerVisitRecordGroupByMock.mockResolvedValue([{ status: 'submitted', _count: { _all: 1 } }]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyVisitRequest: {
          findFirst: pharmacyVisitRequestFindFirstMock,
          updateMany: pharmacyVisitRequestUpdateManyMock,
        },
        visitRecord: {
          findFirst: sourceVisitRecordFindFirstMock,
        },
        partnerVisitRecord: {
          findMany: async (...args: unknown[]) =>
            ((await partnerVisitRecordFindManyMock(...args)) as object[]).map(
              withPatientSafeRelation,
            ),
          count: partnerVisitRecordCountMock,
          groupBy: partnerVisitRecordGroupByMock,
          findFirst: partnerVisitRecordFindFirstMock,
          create: async (...args: unknown[]) =>
            withPatientSafeRelation((await partnerVisitRecordCreateMock(...args)) as object),
          updateMany: partnerVisitRecordUpdateManyMock,
          findUniqueOrThrow: async (...args: unknown[]) =>
            withPatientSafeRelation(
              (await partnerVisitRecordFindUniqueOrThrowMock(...args)) as object,
            ),
        },
      }),
    );
  });

  it('lists records only through active patient share cases with active consent', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/partner-visit-records?share_case_id=share_case_1&status=submitted',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    const where = partnerVisitRecordFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'submitted',
        share_case_id: 'share_case_1',
      }),
    );
    expect(where.share_case.is).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'active',
        revoked_at: null,
        ended_at: null,
        partnership: expect.objectContaining({
          status: 'active',
          partner_pharmacy: { status: 'active' },
        }),
      }),
    );
    expect(JSON.stringify(where.share_case.is)).toContain('"revoked_at":null');
    expect(JSON.stringify(where.share_case.is)).toContain('"valid_until":null');
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      data: [expect.objectContaining({ id: 'partner_visit_record_1', status: 'submitted' })],
      meta: { has_more: false, next_cursor: null },
    });
    expect(responseBody).not.toHaveProperty('hasMore');
    expect(responseBody).not.toHaveProperty('nextCursor');
    const responseText = JSON.stringify(responseBody);
    expect(responseText).toContain('has_record_content');
    expect(responseText).toContain('attachment_count');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('A薬');
  });

  it('lists records without optional predicates when filters are omitted', async () => {
    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(200);
    const where = partnerVisitRecordFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
      }),
    );
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('visit_request_id');
    expect(where).not.toHaveProperty('share_case_id');
    expect(partnerVisitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 9,
      }),
    );
  });

  it('returns exact workflow counts and filter echoes on every cursor page', async () => {
    partnerVisitRecordCountMock.mockResolvedValueOnce(9);
    partnerVisitRecordGroupByMock.mockResolvedValueOnce([
      { status: 'submitted', _count: { _all: 9 } },
    ]);

    const response = await GET(
      createGetRequest(
        '?limit=8&cursor=partner_visit_record_09&status=submitted&visit_request_id=visit_request_1&share_case_id=share_case_1&view_context=pharmacy_cooperation_workflow',
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta).toEqual({
      has_more: false,
      next_cursor: null,
      returned_count: 1,
      total_count: 9,
      count_basis: 'filtered_query_exact',
      filters_applied: {
        id: null,
        status: 'submitted',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
      },
      request_cursor: 'partner_visit_record_09',
      status_counts: {
        draft: 0,
        submitted: 9,
        confirmed: 0,
        returned: 0,
        superseded: 0,
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('applies an authorized exact partner visit record ID inside the active share scope', async () => {
    const response = await GET(
      createGetRequest(
        '?limit=8&id=%20partner_visit_record_1%20&view_context=pharmacy_cooperation_workflow',
      ),
    );

    expect(response.status).toBe(200);
    expect(partnerVisitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'partner_visit_record_1',
          org_id: 'org_1',
          share_case: expect.any(Object),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        filters_applied: { id: 'partner_visit_record_1' },
        request_cursor: null,
      },
    });
  });

  it('keeps the public API cursor response free of workflow-only exact metadata', async () => {
    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta).toEqual({ has_more: false, next_cursor: null });
    expect(partnerVisitRecordCountMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordGroupByMock).not.toHaveBeenCalled();
  });

  it('trims and applies valid status and id filters', async () => {
    const response = await GET(
      createGetRequest(
        '?status=%20submitted%20&visit_request_id=%20visit_request_1%20&share_case_id=%20share_case_1%20',
      ),
    );

    expect(response.status).toBe(200);
    const where = partnerVisitRecordFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'submitted',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
      }),
    );
  });

  it.each([
    ['?id=', 'id', '協力訪問記録IDを指定してください'],
    ['?status=', 'status', 'ステータスを指定してください'],
    ['?status=%20%20', 'status', 'ステータスを指定してください'],
    ['?visit_request_id=', 'visit_request_id', '訪問依頼IDを指定してください'],
    ['?share_case_id=%20%20', 'share_case_id', '患者共有ケースIDを指定してください'],
  ])('rejects blank filter query "%s" before loading records', async (query, field, message) => {
    const response = await GET(createGetRequest(query));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { [field]: [message] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects an exact partner visit record ID combined with a continuation cursor', async () => {
    const response = await GET(
      createGetRequest('?id=partner_visit_record_1&cursor=partner_visit_record_8'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cursor: ['協力訪問記録ID検索ではカーソルを指定できません'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported status values before loading records', async () => {
    const response = await GET(createGetRequest('?status=deleted'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { status: ['対応していないステータスです'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when partner visit record listing fails unexpectedly', async () => {
    partnerVisitRecordFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田花子 raw partner visit record home note'),
    );

    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('raw partner visit record');
    expect(JSON.stringify(body)).not.toContain('home note');
  });

  it('creates a partner-owned draft record for an accepted request without auditing clinical content', async () => {
    const response = await POST(
      createRequest({
        visit_request_id: ' visit_request_1 ',
        pharmacist_id: 'pharmacist_1',
        pharmacist_name: '協力 太郎',
        visit_at: '2026-06-20T01:30:00.000Z',
        source_visit_record_id: 'visit_record_1',
        record_content: {
          medication_adherence: '患者名 山田花子: 飲み忘れあり',
          remaining_medications: 'A薬 10錠',
          suspected_adverse_effects: '眠気',
          storage_status: '冷蔵庫保管',
          proposals: '医師へ減量提案',
        },
        attachments: [{ file_id: 'file_1' }],
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(pharmacyVisitRequestFindFirstMock).toHaveBeenCalledTimes(2);
    for (const [call] of pharmacyVisitRequestFindFirstMock.mock.calls) {
      expect(call.where).toEqual(
        expect.objectContaining({
          id: 'visit_request_1',
          org_id: 'org_1',
          share_case: {
            is: expect.objectContaining({
              org_id: 'org_1',
              status: 'active',
              revoked_at: null,
              ended_at: null,
            }),
          },
        }),
      );
      expect(call.where.share_case.is.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            consents: { some: expect.objectContaining({ revoked_at: null }) },
          }),
        ]),
      );
    }
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'patient_share_case_consent',
      'org_1:share_case_1',
    );
    expect(pharmacyVisitRequestFindFirstMock.mock.invocationCallOrder[0]).toBeLessThan(
      acquireAdvisoryTxLockMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(acquireAdvisoryTxLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      pharmacyVisitRequestFindFirstMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
    expect(pharmacyVisitRequestFindFirstMock.mock.invocationCallOrder[1]).toBeLessThan(
      partnerVisitRecordCreateMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(sourceVisitRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'visit_record_1', org_id: 'org_1', patient_id: 'patient_1' },
      select: { id: true },
    });
    expect(partnerVisitRecordCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_pharmacy_1',
        revision_no: 1,
        status: 'draft',
      }),
      include: expect.any(Object),
    });
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: { in: ['accepted', 'returned'] },
        share_case: { is: expect.objectContaining({ org_id: 'org_1', status: 'active' }) },
      },
      data: { status: 'recording' },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'partner_visit_record_created',
        targetType: 'PartnerVisitRecord',
        targetId: 'partner_visit_record_1',
        changes: expect.objectContaining({
          visit_request_status_before: 'accepted',
          visit_request_status_after: 'recording',
          record_content_keys: [
            'medication_adherence',
            'proposals',
            'remaining_medications',
            'storage_status',
            'suspected_adverse_effects',
          ],
          attachment_count: 1,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('飲み忘れ');
    expect(auditText).not.toContain('A薬');
    const responseBody = await response.json();
    expect(responseBody).not.toHaveProperty('id');
    expect(responseBody).not.toHaveProperty('status');
    expect(responseBody).not.toHaveProperty('visit_request_id');
    expect(responseBody).toMatchObject({
      data: {
        id: 'partner_visit_record_1',
        status: 'draft',
        has_record_content: true,
        attachment_count: 1,
        has_returned_reason: false,
        has_base_confirmation_snapshot: false,
      },
    });
    const responseText = JSON.stringify(responseBody);
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('A薬');
  });

  it('fails closed when active consent changes after target resolution and lock acquisition', async () => {
    pharmacyVisitRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'visit_request_1',
        status: 'accepted',
        share_case_id: 'share_case_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        share_case: { status: 'active', base_patient_id: 'patient_1' },
        partnership: { status: 'active', partner_pharmacy: { status: 'active' } },
      })
      .mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledOnce();
    expect(sourceVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCreateMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rolls back when the visit request status CAS loses after the draft write', async () => {
    pharmacyVisitRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問依頼はすでに更新されています',
    });
    expect(partnerVisitRecordCreateMock).toHaveBeenCalledOnce();
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledOnce();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects invalid draft payloads with no-store headers before loading records', async () => {
    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: 'invalid-visit-at',
        record_content: {},
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects unaccepted visit requests before record or audit side effects', async () => {
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'requested',
      share_case_id: 'share_case_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      share_case: { status: 'active', base_patient_id: 'patient_1' },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(partnerVisitRecordCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects submitted records before draft overwrite side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'submitted',
      revision_no: 1,
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
    });

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when partner visit record save fails unexpectedly', async () => {
    partnerVisitRecordCreateMock.mockRejectedValueOnce(
      new Error('raw partner_visit_record_1 patient 山田花子 token secret clinical content'),
    );

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '患者名 山田花子: 飲み忘れあり' },
      }),
    );

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('partner_visit_record_1');
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('token secret');
    expect(serialized).not.toContain('clinical content');
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when POST auth plumbing fails before parsing body', async () => {
    authPlumbingFailureRef.current = new Error(
      'raw auth partner_visit_record_1 patient 山田花子 token secret',
    );

    const response = await POST(createMalformedPostRequest());

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('raw auth');
    expect(serialized).not.toContain('partner_visit_record_1');
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
