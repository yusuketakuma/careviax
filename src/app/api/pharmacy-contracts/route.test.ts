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

  it('accepts v0.2 terminal contract status filters', async () => {
    const response = await GET(createGetRequest('?status=terminated'));

    expect(response.status).toBe(200);
    expect(pharmacyContractFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'terminated' }),
      }),
    );
  });

  it('creates an active contract with initial active version and fixed-per-visit fee rule', async () => {
    const response = await POST(
      createRequest({
        partnership_id: ' partnership_1 ',
        status: 'active',
        effective_from: '2026-06-01',
        effective_to: '2026-12-31',
        closing_day: 20,
        payment_due_rule: { month_offset: 1, day: 10 },
        terms_snapshot: { liability: 'base-partner agreement text' },
        base_approved_by: 'base-manager',
        partner_approved_by: 'partner-manager',
        fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyPartnershipFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'partnership_1', org_id: 'org_1' },
      select: {
        id: true,
        status: true,
        partner_pharmacy: { select: { status: true } },
      },
    });
    expect(pharmacyContractFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        partnership_id: 'partnership_1',
        status: 'active',
      }),
      select: { id: true },
    });
    expect(pharmacyContractCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        closing_day: 20,
        base_approved_by: 'base-manager',
        partner_approved_by: 'partner-manager',
        created_by: 'user_1',
        versions: {
          create: expect.objectContaining({
            org_id: 'org_1',
            version_no: 1,
            status: 'active',
            effective_from: new Date('2026-06-01T00:00:00.000Z'),
            effective_to: new Date('2026-12-31T00:00:00.000Z'),
            fee_rules: {
              create: expect.objectContaining({
                org_id: 'org_1',
                billing_model: 'fixed_per_visit',
                unit_price: 5500,
                tax_category: 'taxable',
                tax_rate_bp: 1000,
                is_active: true,
              }),
            },
          }),
        },
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_contract_created',
        targetType: 'PharmacyContract',
        targetId: 'contract_1',
        changes: expect.objectContaining({
          partnership_id: 'partnership_1',
          status: 'active',
          version_no: 1,
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('base-partner agreement text');
    await expect(response.json()).resolves.toMatchObject({
      id: 'contract_1',
      has_payment_due_rule: true,
      latest_version: {
        id: 'contract_version_1',
        has_terms_snapshot: true,
        active_fee_rule: {
          id: 'fee_rule_1',
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
        },
      },
    });
  });

  it('rejects active contract creation without both approval records before side effects', async () => {
    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: '2026-06-01',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects overlapping active contracts before create or audit side effects', async () => {
    pharmacyContractFindFirstMock.mockResolvedValue({ id: 'existing_contract' });

    const response = await POST(
      createRequest({
        partnership_id: 'partnership_1',
        status: 'active',
        effective_from: '2026-06-01',
        effective_to: '2026-06-30',
        base_approved_by: 'base-manager',
        partner_approved_by: 'partner-manager',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(409);
    expect(pharmacyContractCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
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
