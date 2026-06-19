import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyContractFindFirstMock,
  pharmacyContractVersionFindFirstMock,
  pharmacyContractVersionCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  pharmacyContractVersionFindFirstMock: vi.fn(),
  pharmacyContractVersionCreateMock: vi.fn(),
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

import { POST as rawPOST } from './route';

const routeContext = { params: Promise.resolve({ id: 'contract_1' }) };
const POST = (req: NextRequest) => rawPOST(req, routeContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-contracts/contract_1/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-contracts/[id]/versions POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyContractFindFirstMock.mockResolvedValue({
      id: 'contract_1',
      status: 'active',
      partnership_id: 'partnership_1',
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });
    pharmacyContractVersionFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version_no: 1 });
    pharmacyContractVersionCreateMock.mockResolvedValue({
      id: 'contract_version_2',
      contract_id: 'contract_1',
      version_no: 2,
      status: 'active',
      effective_from: new Date('2026-07-01T00:00:00.000Z'),
      effective_to: null,
      terms_snapshot: { change: 'unit price revision' },
      fee_rules: [
        {
          id: 'fee_rule_2',
          billing_model: 'fixed_per_visit',
          unit_price: 6600,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      ],
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyContract: {
          findFirst: pharmacyContractFindFirstMock,
        },
        pharmacyContractVersion: {
          findFirst: pharmacyContractVersionFindFirstMock,
          create: pharmacyContractVersionCreateMock,
        },
      }),
    );
  });

  it('creates the next active version with a new fee rule without mutating old versions', async () => {
    const response = await POST(
      createRequest({
        status: 'active',
        effective_from: '2026-07-01',
        change_reason: '7月から単価改定',
        terms_snapshot: { change: 'unit price revision' },
        approved_by_base: 'base-manager',
        approved_by_partner: 'partner-manager',
        fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 6600,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyContractFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'contract_1', org_id: 'org_1' },
      select: {
        id: true,
        status: true,
        partnership_id: true,
        partnership: {
          select: {
            status: true,
            partner_pharmacy: { select: { status: true } },
          },
        },
      },
    });
    expect(pharmacyContractVersionFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        org_id: 'org_1',
        contract_id: 'contract_1',
        status: 'active',
      }),
      select: { id: true },
    });
    expect(pharmacyContractVersionFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: { org_id: 'org_1', contract_id: 'contract_1' },
      orderBy: { version_no: 'desc' },
      select: { version_no: true },
    });
    expect(pharmacyContractVersionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        contract_id: 'contract_1',
        version_no: 2,
        status: 'active',
        effective_from: new Date('2026-07-01T00:00:00.000Z'),
        change_reason: '7月から単価改定',
        approved_by_base: 'base-manager',
        approved_by_partner: 'partner-manager',
        created_by: 'user_1',
        fee_rules: {
          create: expect.objectContaining({
            org_id: 'org_1',
            billing_model: 'fixed_per_visit',
            unit_price: 6600,
            tax_category: 'taxable',
            tax_rate_bp: 1000,
            is_active: true,
          }),
        },
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_contract_version_created',
        targetType: 'PharmacyContractVersion',
        targetId: 'contract_version_2',
        changes: expect.objectContaining({
          contract_id: 'contract_1',
          partnership_id: 'partnership_1',
          version_no: 2,
          status: 'active',
          change_reason_length: 8,
          billing_model: 'fixed_per_visit',
          unit_price: 6600,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('unit price revision');
    await expect(response.json()).resolves.toMatchObject({
      id: 'contract_version_2',
      version_no: 2,
      status: 'active',
      has_terms_snapshot: true,
      active_fee_rule: {
        id: 'fee_rule_2',
        billing_model: 'fixed_per_visit',
        unit_price: 6600,
      },
    });
  });

  it('rejects active versions unless the contract and partnership are active', async () => {
    pharmacyContractFindFirstMock.mockResolvedValue({
      id: 'contract_1',
      status: 'suspended',
      partnership_id: 'partnership_1',
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await POST(
      createRequest({
        status: 'active',
        effective_from: '2026-07-01',
        approved_by_base: 'base-manager',
        approved_by_partner: 'partner-manager',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(409);
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects overlapping active versions before create or audit side effects', async () => {
    pharmacyContractVersionFindFirstMock.mockReset();
    pharmacyContractVersionFindFirstMock.mockResolvedValueOnce({ id: 'contract_version_1' });

    const response = await POST(
      createRequest({
        status: 'active',
        effective_from: '2026-06-15',
        approved_by_base: 'base-manager',
        approved_by_partner: 'partner-manager',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(409);
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects active versions without both approval records before transaction side effects', async () => {
    const response = await POST(
      createRequest({
        status: 'active',
        effective_from: '2026-07-01',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
