import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  pharmacyContractFindFirstMock,
  pharmacyContractFindManyMock,
  pharmacyContractCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  pharmacyContractFindManyMock: vi.fn(),
  pharmacyContractCreateMock: vi.fn(),
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
  return new NextRequest('http://localhost/api/pharmacy-contracts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/pharmacy-contracts${query}`);
}

describe('/api/pharmacy-contracts POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      partner_pharmacy: { status: 'active' },
    });
    pharmacyContractFindFirstMock.mockResolvedValue(null);
    pharmacyContractFindManyMock.mockResolvedValue([]);
    pharmacyContractCreateMock.mockResolvedValue({
      id: 'contract_1',
      partnership_id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      payment_due_rule: { month_offset: 1 },
      partnership: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '連携薬局', status: 'active' },
      },
      versions: [
        {
          id: 'contract_version_1',
          version_no: 1,
          status: 'active',
          terms_snapshot: { note: 'legal text should not be echoed raw in audit' },
          fee_rules: [
            {
              id: 'fee_rule_1',
              billing_model: 'fixed_per_visit',
              unit_price: 5500,
              tax_category: 'taxable',
              tax_rate_bp: 1000,
            },
          ],
        },
      ],
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findFirst: pharmacyPartnershipFindFirstMock,
        },
        pharmacyContract: {
          findFirst: pharmacyContractFindFirstMock,
          findMany: pharmacyContractFindManyMock,
          create: pharmacyContractCreateMock,
        },
      }),
    );
  });

  it('rejects legacy contract status filters before DB reads', async () => {
    const response = await GET(createGetRequest('?status=ended'));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['status', '?status=', { status: ['ステータスを指定してください'] }],
    ['blank status', '?status=%20%20', { status: ['ステータスを指定してください'] }],
    ['partnership_id', '?partnership_id=', { partnership_id: ['薬局間連携IDを指定してください'] }],
    [
      'blank partnership_id',
      '?partnership_id=%20%20',
      { partnership_id: ['薬局間連携IDを指定してください'] },
    ],
  ])('rejects explicitly empty %s filters before DB reads', async (_label, query, details) => {
    const response = await GET(createGetRequest(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractFindManyMock).not.toHaveBeenCalled();
  });

  it('accepts v0.2 terminal contract status filters', async () => {
    const response = await GET(createGetRequest('?status=terminated'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [],
      meta: { has_more: false, next_cursor: null },
    });
    expect(pharmacyContractFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'terminated' }),
      }),
    );
  });

  it('trims valid partnership filters', async () => {
    const response = await GET(createGetRequest('?partnership_id=%20partnership_1%20'));

    expect(response.status).toBe(200);
    expect(pharmacyContractFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partnership_id: 'partnership_1',
        }),
      }),
    );
  });

  it('fails closed when caller-supplied approval strings request active creation', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: '2026-06-01',
        base_approved_by: 'caller-controlled-base',
        partner_approved_by: 'caller-controlled-partner',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      code: 'BILLING_PARTNER_APPROVAL_NOT_IMPLEMENTED',
      message: '認証済みの両薬局による個別承認が実装されるまで契約を有効化できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('fails closed for active creation even when approval strings are omitted', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: '2026-06-01',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(501);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('does not persist caller approval strings on a draft contract', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'draft',
        effective_from: '2026-06-01',
        base_approved_by: 'base-manager',
        partner_approved_by: 'partner-manager',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(501);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('preserves draft creation with null approval evidence', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'draft',
        effective_from: '2026-06-01',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyContractCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'draft',
          base_approved_by: null,
          base_approved_at: null,
          partner_approved_by: null,
          partner_approved_at: null,
          versions: {
            create: expect.objectContaining({
              status: 'draft',
              approved_by_base: null,
              approved_by_partner: null,
              approved_at: null,
            }),
          },
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        changes: expect.objectContaining({ base_approved: false, partner_approved: false }),
      }),
    );
  });

  it('rejects fixed fee rules without a positive unit price before transaction side effects', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'draft',
        effective_from: '2026-06-01',
        fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 0,
          tax_category: 'taxable',
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
