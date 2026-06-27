import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyVisitRequestFindManyMock,
  patientShareCaseFindFirstMock,
  pharmacyContractFindFirstMock,
  pharmacyContractVersionFindFirstMock,
  pharmacyVisitRequestCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyVisitRequestFindManyMock: vi.fn(),
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

describe('/api/pharmacy-visit-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
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
    });
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
          findMany: pharmacyVisitRequestFindManyMock,
          create: pharmacyVisitRequestCreateMock,
        },
      }),
    );
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
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      }),
    );
    expect(JSON.stringify(where.share_case.is)).toContain('"revoked_at":null');
    expect(JSON.stringify(where.share_case.is)).toContain('"valid_until":null');
    const responseText = JSON.stringify(await response.json());
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
    const responseText = JSON.stringify(await response.json());
    expect(responseText).toContain('has_request_reason');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('血圧確認');
    expect(responseText).not.toContain('1234');
  });

  it('rejects inactive share cases before create or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'consent_pending',
      starts_at: null,
      ends_at: null,
      partnership_id: 'partnership_1',
      partnership: {
        status: 'active',
        effective_from: null,
        effective_to: null,
        partner_pharmacy_id: 'partner_pharmacy_1',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '訪問依頼',
      }),
    );

    expect(response.status).toBe(409);
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
