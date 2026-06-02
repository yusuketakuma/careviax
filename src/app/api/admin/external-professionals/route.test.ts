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

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role: string },
    ) => Promise<Response>,
  ) => handler,
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
  return Object.assign(new NextRequest(url, init), {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  });
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

describe('/api/admin/external-professionals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindManyMock.mockResolvedValue([
      {
        id: 'external_1',
        profession_type: 'nurse',
        name: '訪問 看護',
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
      },
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
    ))!;

    expect(response.status).toBe(200);
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
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'external_1',
          facility_name: 'さくら荘',
          patient_count: 2,
        },
      ],
    });
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
    const response = (await POST(createJsonAuthRequest([])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before facility validation', async () => {
    const response = (await POST(createMalformedJsonAuthRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalCreateMock).not.toHaveBeenCalled();
  });
});
