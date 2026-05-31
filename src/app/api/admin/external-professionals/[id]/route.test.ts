import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  externalProfessionalFindFirstMock,
  externalProfessionalUpdateMock,
  externalProfessionalDeleteMock,
  withOrgContextMock,
  assertFacilityReferenceMock,
} = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  externalProfessionalUpdateMock: vi.fn(),
  externalProfessionalDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assertFacilityReferenceMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
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

import { DELETE, GET, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createDetailRequest(id = 'external_1') {
  return new NextRequest(`http://localhost/api/admin/external-professionals/${id}`);
}

function createPatchRequest(body: unknown, id = 'external_1') {
  return new NextRequest(`http://localhost/api/admin/external-professionals/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createDeleteRequest(id = 'external_1') {
  return new NextRequest(`http://localhost/api/admin/external-professionals/${id}`, {
    method: 'DELETE',
  } satisfies NextRequestInit);
}

describe('/api/admin/external-professionals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({ id: 'external_1' });
    externalProfessionalUpdateMock.mockResolvedValue({
      id: 'external_1',
      profession_type: 'nurse',
      name: '訪問 看護',
      facility_id: 'facility_1',
      facility: { name: 'さくら荘' },
      organization_name: 'あおば訪看',
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
      _count: {
        care_team_links: 1,
      },
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    externalProfessionalDeleteMock.mockResolvedValue({ id: 'external_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          update: externalProfessionalUpdateMock,
          delete: externalProfessionalDeleteMock,
        },
      }),
    );
  });

  it('returns an external professional detail row', async () => {
    externalProfessionalFindFirstMock.mockResolvedValueOnce({
      id: 'external_1',
      profession_type: 'nurse',
      name: '訪問 看護',
      facility_id: 'facility_1',
      facility: { name: 'さくら荘' },
      organization_name: 'あおば訪看',
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
      _count: {
        care_team_links: 3,
      },
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });

    const response = (await GET(createDetailRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'external_1',
        facility_name: 'さくら荘',
        patient_count: 3,
      },
    });
  });

  it('updates an external professional row', async () => {
    const response = (await PATCH(
      createPatchRequest({
        profession_type: 'nurse',
        name: '訪問 看護',
        facility_id: 'facility_1',
        organization_name: 'あおば訪看',
        phone: '03-1111-2222',
      }),
      {
        params: Promise.resolve({ id: 'external_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(assertFacilityReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProfessional: expect.any(Object),
      }),
      'org_1',
      'facility_1',
    );
    expect(externalProfessionalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
      data: expect.objectContaining({
        profession_type: 'nurse',
        name: '訪問 看護',
        facility_id: 'facility_1',
        organization_name: 'あおば訪看',
        phone: '03-1111-2222',
      }),
      include: {
        facility: {
          select: {
            name: true,
          },
        },
      },
    });
  });

  it('deletes an external professional row', async () => {
    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalDeleteMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
    });
  });
});
