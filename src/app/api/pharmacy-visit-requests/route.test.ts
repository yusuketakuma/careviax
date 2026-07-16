import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  acquireAdvisoryTxLockMock,
  pharmacyVisitRequestFindManyMock,
  pharmacyVisitRequestCountMock,
  pharmacyVisitRequestGroupByMock,
  patientShareCaseFindFirstMock,
  pharmacyContractFindFirstMock,
  pharmacyContractVersionFindFirstMock,
  pharmacyVisitRequestCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  acquireAdvisoryTxLockMock: vi.fn(),
  pharmacyVisitRequestFindManyMock: vi.fn(),
  pharmacyVisitRequestCountMock: vi.fn(),
  pharmacyVisitRequestGroupByMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  pharmacyContractVersionFindFirstMock: vi.fn(),
  pharmacyVisitRequestCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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
        },
        routeContext,
      );
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
  return new NextRequest('http://localhost/api/pharmacy-visit-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/pharmacy-visit-requests${query}`);
}

function activeShareCase() {
  return {
    id: 'share_case_1',
    status: 'active',
    starts_at: new Date('2026-06-01T00:00:00.000Z'),
    ends_at: new Date('2026-12-31T00:00:00.000Z'),
    partnership_id: 'partnership_1',
    partnership: {
      id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      partner_pharmacy_id: 'partner_pharmacy_1',
      partner_pharmacy: { id: 'partner_pharmacy_1', status: 'active', name: '協力薬局' },
      base_site: { id: 'site_1', name: '基幹薬局' },
    },
  };
}

function activeShareCaseMutationWhere(asOf = new Date('2026-06-19T00:00:00.000Z')) {
  return {
    org_id: 'org_1',
    status: 'active',
    revoked_at: null,
    ended_at: null,
    partnership: {
      status: 'active',
      partner_pharmacy: { status: 'active' },
      OR: [{ effective_from: null }, { effective_from: { lte: asOf } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: asOf } }] }],
    },
    OR: [{ starts_at: null }, { starts_at: { lte: asOf } }],
    AND: [
      { OR: [{ ends_at: null }, { ends_at: { gte: asOf } }] },
      {
        consents: {
          some: {
            revoked_at: null,
            consent_date: { lte: asOf },
            OR: [{ valid_until: null }, { valid_until: { gte: asOf } }],
          },
        },
      },
    ],
  };
}

describe('/api/pharmacy-visit-requests', () => {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    acquireAdvisoryTxLockMock.mockResolvedValue(undefined);
    patientShareCaseFindFirstMock.mockResolvedValue(activeShareCase());
    pharmacyContractFindFirstMock.mockResolvedValue({
      id: 'contract_1',
      closing_day: 20,
      payment_due_rule: { month_offset: 1 },
    });
    pharmacyContractVersionFindFirstMock.mockResolvedValue({
      id: 'contract_version_1',
      fee_rules: [
        {
          id: 'fee_rule_1',
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
        },
      ],
    });
    pharmacyVisitRequestCreateMock.mockResolvedValue({
      id: 'visit_request_1',
      share_case_id: 'share_case_1',
      partnership_id: 'partnership_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      status: 'requested',
      urgency: 'urgent',
      visit_type: 'emergency',
      desired_start_at: new Date('2026-06-20T01:00:00.000Z'),
      desired_end_at: new Date('2026-06-20T02:00:00.000Z'),
      estimated_amount: 5500,
      request_reason: '患者名 山田花子: 発熱と残薬確認',
      physician_instruction: '医師指示: 血圧確認',
      carry_items: { medication: ['A薬'] },
      patient_home_notes: '玄関暗証番号 1234',
      decline_reason: null,
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      partnership: { id: 'partnership_1', base_site: { id: 'site_1', name: '基幹薬局' } },
    });
    pharmacyVisitRequestFindManyMock.mockResolvedValue([
      {
        id: 'visit_request_1',
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        partnership_id: 'partnership_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        requested_by: 'user_1',
        urgency: 'normal',
        desired_start_at: new Date('2026-06-20T01:00:00.000Z'),
        desired_end_at: null,
        visit_type: 'regular',
        status: 'requested',
        contract_id: 'contract_1',
        contract_version_id: 'contract_version_1',
        estimated_amount: 5500,
        estimated_snapshot: { estimate_status: 'estimated' },
        accepted_by: null,
        accepted_at: null,
        declined_by: null,
        declined_at: null,
        cancelled_at: null,
        completed_at: null,
        created_at: new Date('2026-06-18T00:00:00.000Z'),
        updated_at: new Date('2026-06-18T00:00:00.000Z'),
        request_reason: '患者名 山田花子: 訪問依頼',
        physician_instruction: '医師指示',
        carry_items: { medication: ['A薬'] },
        patient_home_notes: '玄関暗証番号',
        decline_reason: null,
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
        partnership: { id: 'partnership_1', base_site: { id: 'site_1', name: '基幹薬局' } },
      },
    ]);
    pharmacyVisitRequestCountMock.mockResolvedValue(1);
    pharmacyVisitRequestGroupByMock.mockResolvedValue([
      { status: 'requested', _count: { _all: 1 } },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
        },
        pharmacyContract: {
          findFirst: pharmacyContractFindFirstMock,
        },
        pharmacyContractVersion: {
          findFirst: pharmacyContractVersionFindFirstMock,
        },
        pharmacyVisitRequest: {
          findMany: async (...args: unknown[]) =>
            ((await pharmacyVisitRequestFindManyMock(...args)) as object[]).map(
              withPatientSafeRelation,
            ),
          count: pharmacyVisitRequestCountMock,
          groupBy: pharmacyVisitRequestGroupByMock,
          create: async (...args: unknown[]) =>
            withPatientSafeRelation((await pharmacyVisitRequestCreateMock(...args)) as object),
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists requests only through active patient share cases with active consent', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/pharmacy-visit-requests?share_case_id=share_case_1&status=requested',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const where = pharmacyVisitRequestFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'requested',
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
      data: [expect.objectContaining({ id: 'visit_request_1', status: 'requested' })],
      meta: { has_more: false, next_cursor: null },
    });
    expect(responseBody).not.toHaveProperty('hasMore');
    expect(responseBody).not.toHaveProperty('nextCursor');
    const responseText = JSON.stringify(responseBody);
    expect(responseText).toContain('has_request_reason');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('医師指示');
    expect(responseText).not.toContain('A薬');
  });

  it('lists requests without optional predicates when filters are omitted', async () => {
    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(200);
    const where = pharmacyVisitRequestFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
      }),
    );
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('share_case_id');
    expect(where).not.toHaveProperty('partner_pharmacy_id');
    expect(pharmacyVisitRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 9,
      }),
    );
  });

  it('returns exact workflow counts and filter echoes on every cursor page', async () => {
    pharmacyVisitRequestCountMock.mockResolvedValueOnce(9);
    pharmacyVisitRequestGroupByMock.mockResolvedValueOnce([
      { status: 'requested', _count: { _all: 9 } },
    ]);

    const response = await GET(
      createGetRequest(
        '?limit=8&cursor=visit_request_09&status=requested&share_case_id=share_case_1&partner_pharmacy_id=partner_pharmacy_1&view_context=pharmacy_cooperation_workflow',
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
        status: 'requested',
        share_case_id: 'share_case_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      },
      request_cursor: 'visit_request_09',
      status_counts: {
        draft: 0,
        requested: 9,
        accepted: 0,
        declined: 0,
        scheduled: 0,
        visited: 0,
        recording: 0,
        submitted: 0,
        base_reviewing: 0,
        returned: 0,
        confirmed: 0,
        physician_report_created: 0,
        claim_checked: 0,
        completed: 0,
      },
    });
    expect(pharmacyVisitRequestCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'requested',
        share_case_id: 'share_case_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('keeps the public API cursor response free of workflow-only exact metadata', async () => {
    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta).toEqual({ has_more: false, next_cursor: null });
    expect(pharmacyVisitRequestCountMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestGroupByMock).not.toHaveBeenCalled();
  });

  it('trims and applies valid status and id filters', async () => {
    const response = await GET(
      createGetRequest(
        '?status=%20requested%20&share_case_id=%20share_case_1%20&partner_pharmacy_id=%20partner_pharmacy_1%20',
      ),
    );

    expect(response.status).toBe(200);
    const where = pharmacyVisitRequestFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'requested',
        share_case_id: 'share_case_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    );
  });

  it.each([
    ['?status=', 'status', 'ステータスを指定してください'],
    ['?status=%20%20', 'status', 'ステータスを指定してください'],
    ['?share_case_id=', 'share_case_id', '患者共有ケースIDを指定してください'],
    ['?partner_pharmacy_id=%20%20', 'partner_pharmacy_id', '協力薬局IDを指定してください'],
  ])(
    'rejects blank filter query "%s" before loading visit requests',
    async (query, field, message) => {
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
      expect(pharmacyVisitRequestFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported status values before loading visit requests', async () => {
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
    expect(pharmacyVisitRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when visit request listing fails unexpectedly', async () => {
    pharmacyVisitRequestFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田花子 raw pharmacy visit request home notes'),
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
    expect(JSON.stringify(body)).not.toContain('raw pharmacy visit request');
    expect(JSON.stringify(body)).not.toContain('home notes');
  });

  it('creates a requested visit request with an active contract estimate and compact audit', async () => {
    const response = await POST(
      createRequest({
        share_case_id: ' share_case_1 ',
        urgency: 'urgent',
        desired_start_at: '2026-06-20T01:00:00.000Z',
        desired_end_at: '2026-06-20T02:00:00.000Z',
        visit_type: 'emergency',
        request_reason: '患者名 山田花子: 発熱と残薬確認',
        physician_instruction: '医師指示: 血圧確認',
        patient_home_notes: '玄関暗証番号 1234',
        carry_items: { medication: ['A薬'] },
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(patientShareCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'share_case_1',
          ...activeShareCaseMutationWhere(),
        },
      }),
    );
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'patient_share_case_consent',
      'org_1:share_case_1',
    );
    expect(acquireAdvisoryTxLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      patientShareCaseFindFirstMock.mock.invocationCallOrder[0],
    );
    expect(pharmacyVisitRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        partnership_id: 'partnership_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        requested_by: 'user_1',
        status: 'requested',
        urgency: 'urgent',
        contract_id: 'contract_1',
        contract_version_id: 'contract_version_1',
        estimated_amount: 5500,
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_visit_request_created',
        targetType: 'PharmacyVisitRequest',
        targetId: 'visit_request_1',
        changes: expect.objectContaining({
          request_reason_length: expect.any(Number),
          has_physician_instruction: true,
          has_patient_home_notes: true,
          estimate_status: 'estimated',
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('血圧確認');
    expect(auditText).not.toContain('1234');
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      data: {
        id: 'visit_request_1',
        status: 'requested',
        has_request_reason: true,
        has_physician_instruction: true,
        has_carry_items: true,
        has_patient_home_notes: true,
        has_decline_reason: false,
      },
    });
    expect(responseBody).not.toHaveProperty('id');
    const responseText = JSON.stringify(responseBody);
    expect(responseText).toContain('has_request_reason');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('血圧確認');
    expect(responseText).not.toContain('1234');
  });

  it('evaluates desired visit and contract dates by the Japan business date', async () => {
    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        desired_start_at: '2026-06-20T16:00:00.000Z',
        request_reason: '訪問依頼',
      }),
    );

    expect(response.status).toBe(201);
    const jstDate = new Date('2026-06-21T00:00:00.000Z');
    expect(pharmacyContractFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ effective_from: null }, { effective_from: { lte: jstDate } }],
          AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: jstDate } }] }],
        }),
      }),
    );
    expect(pharmacyContractVersionFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          effective_from: { lte: jstDate },
          OR: [{ effective_to: null }, { effective_to: { gte: jstDate } }],
        }),
      }),
    );
    expect(pharmacyVisitRequestCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estimated_snapshot: expect.objectContaining({ as_of: '2026-06-21' }),
        }),
      }),
    );
  });

  it('returns a sanitized no-store 500 when visit request creation fails unexpectedly', async () => {
    pharmacyVisitRequestCreateMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw pharmacy visit create detail'),
    );

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        urgency: 'urgent',
        desired_start_at: '2026-06-20T01:00:00.000Z',
        desired_end_at: '2026-06-20T02:00:00.000Z',
        visit_type: 'emergency',
        request_reason: '患者名 山田花子: 発熱と残薬確認',
        physician_instruction: '医師指示: 血圧確認',
        patient_home_notes: '玄関暗証番号 1234',
        carry_items: { medication: ['A薬'] },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('raw pharmacy visit create detail');
    expect(bodyText).not.toContain('血圧確認');
    expect(bodyText).not.toContain('1234');
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects visit request creation when current active consent cannot be proven', async () => {
    patientShareCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '患者名 山田花子: 訪問依頼',
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者共有ケースが見つかりません',
    });
    expect(pharmacyContractFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyContractVersionFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('maps serializable consent races to a sanitized retryable conflict', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'raw patient 山田花子 consent serialization failure',
        {
          code: 'P2034',
          clientVersion: 'test',
        },
      ),
    );

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '患者名 山田花子: 訪問依頼',
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '患者共有ケースが更新されています。再読み込みして再試行してください',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('serialization failure');
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('fails safely before eligibility reads when the consent lock cannot be acquired', async () => {
    acquireAdvisoryTxLockMock.mockRejectedValueOnce(
      new Error('raw lock failure patient 山田花子 token secret'),
    );

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '患者名 山田花子: 訪問依頼',
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('token secret');
    expect(patientShareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('hides inactive share cases behind the active-consent not-found boundary', async () => {
    patientShareCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '訪問依頼',
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者共有ケースが見つかりません',
    });
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
