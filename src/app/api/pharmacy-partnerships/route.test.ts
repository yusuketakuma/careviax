import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  withOrgContextMock,
  baseSiteFindFirstMock,
  partnerPharmacyFindFirstMock,
  pharmacyPartnershipFindManyMock,
  pharmacyPartnershipCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  baseSiteFindFirstMock: vi.fn(),
  partnerPharmacyFindFirstMock: vi.fn(),
  pharmacyPartnershipFindManyMock: vi.fn(),
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

import { GET as rawGET, POST as rawPOST } from './route';
import { pharmacyPartnershipRowSchema } from '@/lib/pharmacy-cooperation/api-contracts';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/pharmacy-partnerships${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-partnerships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectErrorEnvelope(
  response: Response,
  status: number,
  expected: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expectSensitiveNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject(expected);
  expect(body).not.toHaveProperty('data');
  return body as Record<string, unknown>;
}

describe('/api/pharmacy-partnerships GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyPartnershipFindManyMock.mockResolvedValue([
      {
        id: 'partnership_1',
        status: 'active',
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: null,
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '連携薬局', status: 'active' },
        org_id: 'org_1',
        contact_snapshot: { contact_name: 'private ops contact' },
        approved_by_base: 'base_manager',
        approved_by_partner: 'partner_manager',
        approved_at: new Date('2026-03-01T00:00:00.000Z'),
        created_by: 'user_creator',
        updated_by: 'user_updater',
        created_at: new Date('2026-03-01T00:00:00.000Z'),
        updated_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findMany: pharmacyPartnershipFindManyMock,
        },
      }),
    );
  });

  it('lists partnerships without optional predicates when filters are omitted', async () => {
    const response = await GET(createGetRequest('?limit=20'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'partnership_1',
          status: 'active',
          base_site_id: 'site_1',
          partner_pharmacy_id: 'partner_pharmacy_1',
          effective_from: '2026-06-01T00:00:00.000Z',
          effective_to: null,
          base_site: { id: 'site_1', name: '基幹薬局' },
          partner_pharmacy: { id: 'partner_pharmacy_1', name: '連携薬局', status: 'active' },
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
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('org_id');
    expect(responseText).not.toContain('contact_snapshot');
    expect(responseText).not.toContain('private ops contact');
    expect(responseText).not.toContain('created_by');
    expect(responseText).not.toContain('updated_by');
    expect(responseText).not.toContain('approved_by_base');
    expect(responseText).not.toContain('approved_by_partner');
    expect(responseText).not.toContain('approved_at');
    expect(responseText).not.toContain('created_at');
    expect(responseText).not.toContain('updated_at');
    expect(pharmacyPartnershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1' },
        take: 21,
      }),
    );
  });

  it('trims and applies valid status and id filters', async () => {
    const response = await GET(
      createGetRequest(
        '?status=%20active%20&base_site_id=%20site_1%20&partner_pharmacy_id=%20partner_pharmacy_1%20&limit=20',
      ),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacyPartnershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'active',
          base_site_id: 'site_1',
          partner_pharmacy_id: 'partner_pharmacy_1',
        },
        take: 21,
      }),
    );
  });

  it.each([
    ['?status=', 'status', 'ステータスを指定してください'],
    ['?status=%20%20', 'status', 'ステータスを指定してください'],
    ['?base_site_id=', 'base_site_id', '基準薬局店舗IDを指定してください'],
    ['?partner_pharmacy_id=%20%20', 'partner_pharmacy_id', '協力薬局IDを指定してください'],
  ])(
    'rejects blank filter query "%s" before loading partnerships',
    async (query, field, message) => {
      const response = await GET(createGetRequest(query));

      await expectErrorEnvelope(response, 400, {
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: { [field]: [message] },
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pharmacyPartnershipFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported status values before loading partnerships', async () => {
    const response = await GET(createGetRequest('?status=deleted'));

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { status: ['対応していないステータスです'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyPartnershipFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when partnership listing fails unexpectedly', async () => {
    pharmacyPartnershipFindManyMock.mockRejectedValueOnce(
      new Error('raw pharmacy partnership contact snapshot secret'),
    );

    const response = await GET(createGetRequest('?limit=20'));

    const body = await expectErrorEnvelope(response, 500, {
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw pharmacy partnership');
    expect(JSON.stringify(body)).not.toContain('contact snapshot');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

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
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      org_id: 'org_1',
      contact_snapshot: { contact_name: 'private ops contact' },
      approved_by_base: null,
      approved_by_partner: null,
      approved_at: null,
      created_by: 'user_creator',
      updated_by: 'user_updater',
      created_at: new Date('2026-06-19T10:00:00.000Z'),
      updated_at: new Date('2026-06-19T10:00:00.000Z'),
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '連携薬局', status: 'active' },
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
          findMany: pharmacyPartnershipFindManyMock,
          create: pharmacyPartnershipCreateMock,
        },
      }),
    );
  });

  it('creates a draft partnership after validating base site and partner pharmacy', async () => {
    const response = await POST(
      createPostRequest({
        base_site_id: ' site_1 ',
        partner_pharmacy_id: ' partner_pharmacy_1 ',
        available_services: ['home_visit'],
        contact_snapshot: { contact_name: 'Ops' },
        effective_from: '2026-06-01',
        effective_to: '2026-12-31',
      }),
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data']);
    expect(pharmacyPartnershipRowSchema.safeParse(body.data).success).toBe(true);
    expect(body.data).not.toHaveProperty('approved_by_base');
    expect(body.data).not.toHaveProperty('approved_by_partner');
    expect(body.data).not.toHaveProperty('approved_at');
    expect(body.data).not.toHaveProperty('updated_by');
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('org_id');
    expect(responseText).not.toContain('contact_snapshot');
    expect(responseText).not.toContain('private ops contact');
    expect(responseText).not.toContain('created_by');
    expect(responseText).not.toContain('updated_by');
    expect(responseText).not.toContain('created_at');
    expect(responseText).not.toContain('updated_at');
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

  it('rejects invalid create payloads before reading or writing partnership data', async () => {
    const response = await POST(
      createPostRequest({
        base_site_id: '',
        partner_pharmacy_id: '',
        effective_from: '2026-12-31',
        effective_to: '2026-06-01',
      }),
    );

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        base_site_id: ['基準薬局店舗IDは必須です'],
        partner_pharmacy_id: ['協力薬局IDは必須です'],
        effective_to: ['終了日は開始日以降を指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found when the base site is outside the organization scope', async () => {
    baseSiteFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        base_site_id: 'site_404',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    );

    await expectErrorEnvelope(response, 404, {
      code: 'WORKFLOW_NOT_FOUND',
      message: '基準薬局店舗が見つかりません',
    });
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found when the partner pharmacy is outside the organization scope', async () => {
    partnerPharmacyFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_404',
      }),
    );

    await expectErrorEnvelope(response, 404, {
      code: 'WORKFLOW_NOT_FOUND',
      message: '協力薬局が見つかりません',
    });
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects archived partner pharmacies before create or audit side effects', async () => {
    partnerPharmacyFindFirstMock.mockResolvedValue({
      id: 'partner_pharmacy_1',
      status: 'archived',
    });

    const response = await POST(
      createPostRequest({
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    );

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        partner_pharmacy_id: ['アーカイブ済み協力薬局は連携先に指定できません'],
      },
    });
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when partnership creation fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw partnership create failure patient=患者A token=secret'),
    );

    const response = await POST(
      createPostRequest({
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      }),
    );

    const body = await expectErrorEnvelope(response, 500, {
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw partnership create failure');
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('token=secret');
    expect(pharmacyPartnershipCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
