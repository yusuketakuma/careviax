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

function createMalformedJsonPatchRequest(id = 'external_1') {
  return new NextRequest(`http://localhost/api/admin/external-professionals/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

function createDeleteRequest(id = 'external_1') {
  return new NextRequest(`http://localhost/api/admin/external-professionals/${id}`, {
    method: 'DELETE',
  } satisfies NextRequestInit);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expectSensitiveNoStore(response);
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
        phone: ' 03-1111-2222 ',
        fax: '   ',
      }),
      {
        params: Promise.resolve({ id: 'external_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
        fax: null,
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

  it('does not clear contact numbers when PATCH omits them', async () => {
    const response = (await PATCH(
      createPatchRequest({
        notes: '連携先メモ',
      }),
      {
        params: Promise.resolve({ id: 'external_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(externalProfessionalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
      data: expect.objectContaining({
        notes: '連携先メモ',
      }),
      include: {
        facility: {
          select: {
            name: true,
          },
        },
      },
    });
    expect(externalProfessionalUpdateMock.mock.calls[0][0].data).not.toHaveProperty('phone');
    expect(externalProfessionalUpdateMock.mock.calls[0][0].data).not.toHaveProperty('fax');
  });

  it('rejects malformed contact numbers before loading the external professional', async () => {
    const response = (await PATCH(
      createPatchRequest({
        phone: '03-ABCD-2222',
        fax: 'FAX-3333',
      }),
      {
        params: Promise.resolve({ id: 'external_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        phone: ['電話番号形式が不正です'],
        fax: ['FAX番号形式が不正です'],
      },
    });
    expect(externalProfessionalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before loading the external professional', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(externalProfessionalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the external professional', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(externalProfessionalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(externalProfessionalUpdateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when updates fail unexpectedly', async () => {
    const rawError = '他職種A 03-1111-2222 external professional update failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await PATCH(
      createPatchRequest({
        name: '訪問 看護',
        phone: '03-1111-2222',
      }),
      {
        params: Promise.resolve({ id: 'external_1' }),
      },
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('他職種A');
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
  });

  it('deletes an external professional row', async () => {
    externalProfessionalFindFirstMock.mockResolvedValueOnce({
      id: 'external_1',
      _count: { care_team_links: 0 },
    });

    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(externalProfessionalDeleteMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
    });
  });

  it('returns 409 before deleting an external professional linked to patients', async () => {
    externalProfessionalFindFirstMock.mockResolvedValueOnce({
      id: 'external_1',
      _count: { care_team_links: 2 },
    });

    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '担当患者に紐づく他職種マスターは削除できません',
      details: { linked_patient_count: 2 },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(externalProfessionalDeleteMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when deletes fail unexpectedly', async () => {
    const rawError = '他職種A 03-1111-2222 external professional delete failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('他職種A');
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
  });
});
