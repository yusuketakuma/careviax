import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withOrgContextMock, partnerPharmacyCreateMock, createAuditLogEntryMock } = vi.hoisted(
  () => ({
    withOrgContextMock: vi.fn(),
    partnerPharmacyCreateMock: vi.fn(),
    createAuditLogEntryMock: vi.fn(),
  }),
);

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
import { partnerPharmacyRowSchema } from '@/lib/pharmacy-cooperation/api-contracts';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/partner-pharmacies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/partner-pharmacies POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    partnerPharmacyCreateMock.mockResolvedValue({
      id: 'partner_pharmacy_1',
      name: '連携薬局',
      pharmacy_code: 'EXT-001',
      tel: null,
      status: 'active',
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        partnerPharmacy: {
          create: partnerPharmacyCreateMock,
        },
      }),
    );
  });

  it('creates a partner pharmacy under org context and writes compact audit metadata', async () => {
    const response = await POST(
      createRequest({
        pharmacy_code: ' EXT-001 ',
        name: ' 連携薬局 ',
        address: '東京都中央区1-1-1',
        available_services: ['home_visit', 'night_on_call'],
        contact_channels: { line: true },
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(partnerPharmacyRowSchema.safeParse(body).success).toBe(true);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(partnerPharmacyCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        pharmacy_code: 'EXT-001',
        name: '連携薬局',
        available_services: ['home_visit', 'night_on_call'],
        created_by: 'user_1',
        updated_by: 'user_1',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'partner_pharmacy_created',
        targetType: 'PartnerPharmacy',
        targetId: 'partner_pharmacy_1',
        changes: {
          status: 'active',
          pharmacy_code: 'EXT-001',
          available_service_count: 2,
        },
      },
    );
  });

  it('rejects non-object payloads before transaction side effects', async () => {
    const response = await POST(createRequest([]));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerPharmacyCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
