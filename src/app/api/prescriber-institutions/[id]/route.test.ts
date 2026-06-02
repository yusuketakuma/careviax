import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  prescriberInstitutionFindFirstMock,
  prescriberInstitutionUpdateMock,
  prescriberInstitutionDeleteMock,
  prescriptionIntakeUpdateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  prescriberInstitutionFindFirstMock: vi.fn(),
  prescriberInstitutionUpdateMock: vi.fn(),
  prescriberInstitutionDeleteMock: vi.fn(),
  prescriptionIntakeUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriberInstitution: {
      findFirst: prescriberInstitutionFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/prescriber-institutions/institution_1', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/prescriber-institutions/institution_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

function createDeleteRequest() {
  return new NextRequest('http://localhost/api/prescriber-institutions/institution_1', {
    method: 'DELETE',
  });
}

function expectNoInstitutionMutation() {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(prescriberInstitutionUpdateMock).not.toHaveBeenCalled();
  expect(prescriptionIntakeUpdateManyMock).not.toHaveBeenCalled();
  expect(prescriberInstitutionDeleteMock).not.toHaveBeenCalled();
}

describe('/api/prescriber-institutions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    prescriberInstitutionFindFirstMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      institution_code: '1234567',
      address: '東京都港区1-1-1',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      notes: null,
      _count: {
        prescription_intakes: 2,
      },
      prescription_intakes: [
        {
          id: 'intake_1',
          prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
          cycle_id: 'cycle_1',
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
            case_: {
              patient: {
                name: '山田 太郎',
              },
            },
          },
        },
      ],
      created_at: new Date('2026-03-20T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    prescriberInstitutionUpdateMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなと在宅クリニック',
      institution_code: '1234567',
      address: '東京都港区1-1-1',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      notes: '更新',
      created_at: new Date('2026-03-20T00:00:00.000Z'),
      updated_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriberInstitution: {
          update: prescriberInstitutionUpdateMock,
          delete: prescriberInstitutionDeleteMock,
        },
        prescriptionIntake: {
          updateMany: prescriptionIntakeUpdateManyMock,
        },
      }),
    );
  });

  it('returns institution detail with recent prescriptions', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '  institution_1  ' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(prescriberInstitutionFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'institution_1', org_id: 'org_1' },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'institution_1',
        prescription_count: 2,
        recent_prescriptions: [
          {
            intake_id: 'intake_1',
            patient_name: '山田 太郎',
          },
        ],
      },
    });
  });

  it('rejects blank institution ids before loading recent prescriptions', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '医療機関IDが不正です',
    });
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expectNoInstitutionMutation();
  });

  it('updates an institution row', async () => {
    const response = await PATCH(
      createRequest({
        name: 'みなと在宅クリニック',
        phone: ' 03-2222-3333 ',
        fax: '   ',
        notes: '更新',
      }),
      {
        params: Promise.resolve({ id: 'institution_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(prescriberInstitutionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'institution_1' },
      data: {
        name: 'みなと在宅クリニック',
        phone: '03-2222-3333',
        fax: null,
        notes: '更新',
      },
    });
  });

  it('does not clear contact numbers when PATCH omits them', async () => {
    const response = await PATCH(
      createRequest({
        notes: '更新',
      }),
      {
        params: Promise.resolve({ id: 'institution_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(prescriberInstitutionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'institution_1' },
      data: {
        notes: '更新',
      },
    });
  });

  it('rejects malformed contact numbers before loading the institution', async () => {
    const response = await PATCH(
      createRequest({
        phone: '03-ABCD-2222',
        fax: 'FAX-3333',
      }),
      {
        params: Promise.resolve({ id: 'institution_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        phone: ['電話番号形式が不正です'],
        fax: ['FAX番号形式が不正です'],
      },
    });
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before loading the institution', async () => {
    const response = await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'institution_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank institution ids before parsing or loading update payloads', async () => {
    const response = await PATCH(createRequest({ notes: '更新' }), {
      params: Promise.resolve({ id: '   ' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '医療機関IDが不正です',
    });
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expectNoInstitutionMutation();
  });

  it('rejects malformed JSON before loading the institution', async () => {
    const response = await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'institution_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionUpdateMock).not.toHaveBeenCalled();
  });

  it('clears intake references before deleting an institution row', async () => {
    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'institution_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(prescriptionIntakeUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        prescriber_institution_id: 'institution_1',
      },
      data: {
        prescriber_institution_id: null,
      },
    });
    expect(prescriberInstitutionDeleteMock).toHaveBeenCalledWith({
      where: { id: 'institution_1' },
    });
  });

  it('rejects blank institution ids before clearing intake references or deleting', async () => {
    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '医療機関IDが不正です',
    });
    expect(prescriberInstitutionFindFirstMock).not.toHaveBeenCalled();
    expectNoInstitutionMutation();
  });
});
