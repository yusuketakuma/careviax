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

  it('fails closed before persisting caller-supplied approval strings', async () => {
    const response = await POST(
      createRequest({
        status: 'active',
        effective_from: '2026-07-01',
        approved_by_base: 'caller-controlled-base',
        approved_by_partner: 'caller-controlled-partner',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      code: 'BILLING_PARTNER_APPROVAL_NOT_IMPLEMENTED',
      message: '認証済みの両薬局による個別承認が実装されるまで契約版を有効化できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('preserves draft version creation with null approval evidence', async () => {
    pharmacyContractVersionFindFirstMock.mockReset().mockResolvedValue({ version_no: 1 });

    const response = await POST(
      createRequest({
        status: 'draft',
        effective_from: '2026-07-01',
        fee_rule: { billing_model: 'free' },
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyContractVersionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version_no: 2,
          status: 'draft',
          approved_by_base: null,
          approved_by_partner: null,
          approved_at: null,
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

    expect(response.status).toBe(501);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it.each(['expired', 'terminated'] as const)(
    'rejects adding versions to %s contracts before side effects',
    async (status) => {
      pharmacyContractFindFirstMock.mockResolvedValue({
        id: 'contract_1',
        status,
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      });

      const response = await POST(
        createRequest({
          status: 'draft',
          effective_from: '2026-07-01',
          fee_rule: { billing_model: 'free' },
        }),
      );

      expect(response.status).toBe(409);
      expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
      expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    },
  );

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

    expect(response.status).toBe(501);
    expect(withOrgContextMock).not.toHaveBeenCalled();
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

    expect(response.status).toBe(501);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyContractVersionCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
