import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerPharmacyFindManyMock,
  partnerPharmacyCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerPharmacyFindManyMock: vi.fn(),
  partnerPharmacyCreateMock: vi.fn(),
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
import { partnerPharmacyRowSchema } from '@/lib/pharmacy-cooperation/api-contracts';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/partner-pharmacies${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/partner-pharmacies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/partner-pharmacies GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    partnerPharmacyFindManyMock.mockResolvedValue([
      {
        id: 'partner_pharmacy_1',
        name: '連携薬局',
        pharmacy_code: 'EXT-001',
        tel: null,
        status: 'active',
        updated_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        partnerPharmacy: {
          findMany: partnerPharmacyFindManyMock,
        },
      }),
    );
  });

  it('lists partner pharmacies without a status predicate when status is omitted', async () => {
    const response = await GET(createGetRequest('?limit=20'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'partner_pharmacy_1',
          name: '連携薬局',
          pharmacy_code: 'EXT-001',
          tel: null,
          status: 'active',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      meta: {
        limit: 20,
        has_more: false,
        next_cursor: null,
      },
    });
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(partnerPharmacyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1' },
        take: 21,
      }),
    );
  });

  it('trims and applies valid status filters', async () => {
    const response = await GET(createGetRequest('?status=%20active%20&limit=20'));

    expect(response.status).toBe(200);
    expect(partnerPharmacyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', status: 'active' },
        take: 21,
      }),
    );
  });

  it.each(['?status=', '?status=%20%20'])(
    'rejects blank status query "%s" before loading partner pharmacies',
    async (query) => {
      const response = await GET(createGetRequest(query));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: { status: ['ステータスを指定してください'] },
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(partnerPharmacyFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported status values before loading partner pharmacies', async () => {
    const response = await GET(createGetRequest('?status=deleted'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { status: ['対応していないステータスです'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerPharmacyFindManyMock).not.toHaveBeenCalled();
  });
});

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
      createPostRequest({
        pharmacy_code: ' EXT-001 ',
        name: ' 連携薬局 ',
        address: '東京都中央区1-1-1',
        available_services: ['home_visit', 'night_on_call'],
        contact_channels: { line: true },
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      data: {
        id: 'partner_pharmacy_1',
        name: '連携薬局',
        pharmacy_code: 'EXT-001',
        tel: null,
        status: 'active',
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(partnerPharmacyRowSchema.safeParse(body.data).success).toBe(true);
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
    const response = await POST(createPostRequest([]));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerPharmacyCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
