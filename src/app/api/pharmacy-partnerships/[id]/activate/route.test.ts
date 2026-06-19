import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  pharmacyPartnershipUpdateManyMock,
  pharmacyPartnershipFindUniqueOrThrowMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  pharmacyPartnershipUpdateManyMock: vi.fn(),
  pharmacyPartnershipFindUniqueOrThrowMock: vi.fn(),
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

const routeContext = { params: Promise.resolve({ id: 'partnership_1' }) };

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-partnerships/partnership_1/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-partnerships/[id]/activate POST', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'draft',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: null,
      approved_by_partner: null,
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    pharmacyPartnershipUpdateManyMock.mockResolvedValue({ count: 1 });
    pharmacyPartnershipFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findFirst: pharmacyPartnershipFindFirstMock,
          updateMany: pharmacyPartnershipUpdateManyMock,
          findUniqueOrThrow: pharmacyPartnershipFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('activates a draft partnership with both pharmacy approvals', async () => {
    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(pharmacyPartnershipUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'partnership_1',
        org_id: 'org_1',
        status: { in: ['draft', 'suspended'] },
        partner_pharmacy: { status: 'active' },
      },
      data: {
        status: 'active',
        approved_by_base: 'base_manager',
        approved_by_partner: 'partner_manager',
        approved_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_by: 'user_1',
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_partnership_activated',
        targetType: 'PharmacyPartnership',
        targetId: 'partnership_1',
        changes: expect.objectContaining({
          previous_status: 'draft',
          status: 'active',
          base_approved: true,
          partner_approved: true,
        }),
      }),
    );
  });

  it('rejects activation without partner approval before update or audit side effects', async () => {
    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects inactive partner pharmacies before update or audit side effects', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'draft',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: null,
      approved_by_partner: null,
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'inactive' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns an already active partnership without writing another audit entry', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
