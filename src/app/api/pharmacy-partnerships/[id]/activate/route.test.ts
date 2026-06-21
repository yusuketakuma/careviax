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
import { pharmacyPartnershipRowSchema } from '@/lib/pharmacy-cooperation/api-contracts';

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
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    pharmacyPartnershipUpdateManyMock.mockResolvedValue({ count: 1 });
    pharmacyPartnershipFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      approved_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_by: 'user_1',
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
        AND: [
          {
            OR: [
              { effective_from: null },
              { effective_from: { lt: new Date('2026-06-20T00:00:00.000Z') } },
            ],
          },
          {
            OR: [
              { effective_to: null },
              { effective_to: { gte: new Date('2026-06-19T00:00:00.000Z') } },
            ],
          },
        ],
      },
      data: {
        status: 'active',
        approved_by_base: 'base_manager',
        approved_by_partner: 'partner_manager',
        approved_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_by: 'user_1',
      },
    });
    const body = await response.json();
    expect(pharmacyPartnershipRowSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('approved_by_base');
    expect(body).not.toHaveProperty('approved_by_partner');
    expect(body).not.toHaveProperty('approved_at');
    expect(body).not.toHaveProperty('updated_by');
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

  it('documents that active no-op requests still require valid approval payloads', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(createRequest({}), routeContext);

    expect(response.status).toBe(400);
    expect(pharmacyPartnershipFindFirstMock).not.toHaveBeenCalled();
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
      base_site: { id: 'site_1', name: '基幹薬局' },
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
      base_site: { id: 'site_1', name: '基幹薬局' },
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
    const body = await response.json();
    expect(pharmacyPartnershipRowSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      id: 'partnership_1',
      status: 'active',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns active partnership when a concurrent activation wins the update race', async () => {
    pharmacyPartnershipUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(pharmacyPartnershipRowSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      id: 'partnership_1',
      status: 'active',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    expect(pharmacyPartnershipFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'partnership_1', org_id: 'org_1' } },
      include: {
        base_site: { select: { id: true, name: true } },
        partner_pharmacy: { select: { id: true, name: true, status: true } },
      },
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects when the partnership leaves the effective date window before update wins', async () => {
    pharmacyPartnershipUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    pharmacyPartnershipFindUniqueOrThrowMock.mockResolvedValueOnce({
      id: 'partnership_1',
      status: 'draft',
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-06-18T00:00:00.000Z'),
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '薬局間連携の終了日を過ぎています',
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
