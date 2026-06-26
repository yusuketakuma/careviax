import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  externalProfessionalFindManyMock,
  externalProfessionalCreateMock,
  withOrgContextMock,
  assertFacilityReferenceMock,
} = vi.hoisted(() => ({
  externalProfessionalFindManyMock: vi.fn(),
  externalProfessionalCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assertFacilityReferenceMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'admin',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, authContext, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findMany: externalProfessionalFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  assertFacilityReference: assertFacilityReferenceMock,
}));

import { GET, POST } from './route';

function createAuthRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

function createJsonAuthRequest(body: unknown) {
  return createAuthRequest('http://localhost/api/admin/external-professionals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonAuthRequest() {
  return createAuthRequest('http://localhost/api/admin/external-professionals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

function createExternalProfessionalFixture(id: string, name = '訪問 看護') {
  return {
    id,
    profession_type: 'nurse',
    name,
    facility_id: 'facility_1',
    facility: { name: 'さくら荘' },
    organization_name: 'あおば訪看',
    department: null,
    phone: null,
    email: null,
    fax: null,
    preferred_contact_method: null,
    preferred_contact_time: null,
    last_contacted_at: null,
    last_success_channel: null,
    address: null,
    notes: null,
    _count: {
      care_team_links: 2,
    },
    created_at: new Date('2026-03-28T00:00:00.000Z'),
    updated_at: new Date('2026-03-28T00:00:00.000Z'),
  };
}

describe('/api/admin/external-professionals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindManyMock.mockResolvedValue([
      createExternalProfessionalFixture('external_1'),
    ]);
    externalProfessionalCreateMock.mockResolvedValue({
      id: 'external_2',
      profession_type: 'care_manager',
      name: '山田 ケアマネ',
      facility_id: 'facility_1',
      facility: { name: 'さくら荘' },
      organization_name: '居宅支援A',
      department: null,
      phone: '03-1111-2222',
      email: null,
      fax: null,
      preferred_contact_method: null,
      preferred_contact_time: null,
      last_contacted_at: null,
      last_success_channel: null,
      address: null,
      notes: null,
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          create: externalProfessionalCreateMock,
        },
      }),
    );
  });

  it('lists external professionals with query filters', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/admin/external-professionals?q=訪看&profession_type=nurse&facility_id=facility_1',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        profession_type: 'nurse',
        facility_id: 'facility_1',
        OR: [
          { name: { contains: '訪看', mode: 'insensitive' } },
          { organization_name: { contains: '訪看', mode: 'insensitive' } },
          { facility: { name: { contains: '訪看', mode: 'insensitive' } } },
        ],
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            care_team_links: true,
          },
        },
      },
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
      take: 501,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'external_1',
          facility_name: 'さくら荘',
          patient_count: 2,
        },
      ],
      meta: {
        limit: 500,
        has_more: false,
      },
    });
  });

  it('preserves the complete full selector list when q is absent', async () => {
    externalProfessionalFindManyMock.mockResolvedValue([
      createExternalProfessionalFixture('external_1', '訪問 看護'),
      createExternalProfessionalFixture('external_2', '山田 ケアマネ'),
    ]);

    const response = (await GET(
      createAuthRequest('http://localhost/api/admin/external-professionals'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    const query = externalProfessionalFindManyMock.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      where: { org_id: 'org_1' },
      include: expect.any(Object),
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
    });
    expect(query).not.toHaveProperty('take');
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body).not.toHaveProperty('meta');
  });

  it('treats blank q as an unfiltered full-list request', async () => {
    const response = (await GET(
      createAuthRequest('http://localhost/api/admin/external-professionals?q=%20%20'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('rejects invalid profession_type before querying external professionals', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/admin/external-professionals?profession_type=invalid',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        profession_type: ['不正な値です'],
      },
    });
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects trimmed invalid profession_type before querying external professionals', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/admin/external-professionals?profession_type=%20invalid%20',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        profession_type: ['不正な値です'],
      },
    });
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid preferred_contact_method before querying external professionals', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/admin/external-professionals?preferred_contact_method=ph_os_share',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        preferred_contact_method: ['不正な値です'],
      },
    });
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank facility_id before querying external professionals', async () => {
    const response = (await GET(
      createAuthRequest('http://localhost/api/admin/external-professionals?facility_id=%20%20'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        facility_id: ['施設IDが不正です'],
      },
    });
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
  });

  it('applies valid trimmed filters without q pagination metadata', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/admin/external-professionals?profession_type=%20nurse%20&facility_id=%20facility_1%20&preferred_contact_method=%20phone%20',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        profession_type: 'nurse',
        facility_id: 'facility_1',
        preferred_contact_method: 'phone',
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            care_team_links: true,
          },
        },
      },
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
    });
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('trims q-filtered results and reports has_more', async () => {
    externalProfessionalFindManyMock.mockResolvedValue([
      createExternalProfessionalFixture('external_1', '訪問 看護'),
      createExternalProfessionalFixture('external_2', '訪看 ステーション'),
      createExternalProfessionalFixture('external_3', '訪看 連携室'),
    ]);

    const response = (await GET(
      createAuthRequest('http://localhost/api/admin/external-professionals?q=訪看&limit=2'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'external_1' }, { id: 'external_2' }],
      meta: {
        limit: 2,
        has_more: true,
      },
    });
  });

  it.each([
    ['9999', 501],
    ['0', 2],
    ['abc', 501],
  ])('bounds q-filtered limit "%s" to take %i', async (limit, expectedTake) => {
    const response = (await GET(
      createAuthRequest(`http://localhost/api/admin/external-professionals?q=訪看&limit=${limit}`),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('creates an external professional master row', async () => {
    const response = (await POST(
      createJsonAuthRequest({
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        facility_id: 'facility_1',
        organization_name: '居宅支援A',
        phone: ' 03-1111-2222 ',
        fax: ' 03-1111-3333 ',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(assertFacilityReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProfessional: expect.any(Object),
      }),
      'org_1',
      'facility_1',
    );
    expect(externalProfessionalCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        facility_id: 'facility_1',
        organization_name: '居宅支援A',
        department: null,
        phone: '03-1111-2222',
        fax: '03-1111-3333',
        email: null,
        preferred_contact_method: null,
        preferred_contact_time: null,
        address: null,
        notes: null,
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
      },
    });
  });

  it('normalizes blank optional contact fields to null on create', async () => {
    const response = (await POST(
      createJsonAuthRequest({
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        phone: '   ',
        fax: '\t',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(externalProfessionalCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        facility_id: null,
        organization_name: null,
        department: null,
        phone: null,
        email: null,
        fax: null,
        preferred_contact_method: null,
        preferred_contact_time: null,
        address: null,
        notes: null,
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
      },
    });
  });

  it('rejects malformed contact numbers before facility validation', async () => {
    const response = (await POST(
      createJsonAuthRequest({
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        phone: '03-ABCD-2222',
        fax: 'FAX-3333',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        phone: ['電話番号形式が不正です'],
        fax: ['FAX番号形式が不正です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before facility validation', async () => {
    const response = (await POST(createJsonAuthRequest([]), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before facility validation', async () => {
    const response = (await POST(createMalformedJsonAuthRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalCreateMock).not.toHaveBeenCalled();
  });
});
