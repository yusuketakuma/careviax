import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  baseSiteFindFirstMock,
  partnerPharmacyFindFirstMock,
  pharmacyPartnershipCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  baseSiteFindFirstMock: vi.fn(),
  partnerPharmacyFindFirstMock: vi.fn(),
  pharmacyPartnershipCreateMock: vi.fn(),
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

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-partnerships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-partnerships POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseSiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    partnerPharmacyFindFirstMock.mockResolvedValue({ id: 'partner_pharmacy_1', status: 'active' });
    pharmacyPartnershipCreateMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'draft',
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacySite: {
          findFirst: baseSiteFindFirstMock,
        },
        partnerPharmacy: {
          findFirst: partnerPharmacyFindFirstMock,
        },
        pharmacyPartnership: {
          create: pharmacyPartnershipCreateMock,
        },
      }),
    );
  });

  it('creates a draft partnership after validating base site and partner pharmacy', async () => {
    const response = await POST(
      createRequest({
        base_site_id: ' site_1 ',
        partner_pharmacy_id: ' partner_pharmacy_1 ',
        available_services: ['home_visit'],
        contact_snapshot: { contact_name: 'Ops' },
        effective_from: '2026-06-01',
        effective_to: '2026-12-31',
      }),
    );

    expect(response.status).toBe(201);
    expect(baseSiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'site_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(partnerPharmacyFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'partner_pharmacy_1', org_id: 'org_1' },
      select: { id: true, status: true },
    });
    expect(pharmacyPartnershipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        status: 'draft',
        available_services: ['home_visit'],
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        created_by: 'user_1',
        updated_by: 'user_1',
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_partnership_created',
        targetType: 'PharmacyPartnership',
        targetId: 'partnership_1',
      }),
    );
  });

  it('rejects archived partner pharmacies before create or audit side effects', async () => {
    partnerPharmacyFindFirstMock.mockResolvedValue({
      id: 'partner_pharmacy_1',
      status: 'archived',
    });

    const response = await POST(
      createRequest({
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    );

    expect(response.status).toBe(400);
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
