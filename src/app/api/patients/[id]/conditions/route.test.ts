import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientCondition: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createGetRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'GET',
    headers,
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'corg1234567890123456789012',
    },
    body: '{"conditions":',
  });
}

describe('/api/patients/[id]/conditions PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    createManyMock.mockResolvedValue({ count: 2 });
    findManyMock.mockResolvedValue([{ id: 'condition_1', name: '高血圧' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientCondition: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      }),
    );
  });

  it('rejects blank patient ids before loading conditions', async () => {
    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing condition payloads or replacing conditions', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object condition payloads before loading the patient', async () => {
    const response = await PUT(createRequest([], { 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON condition payloads before loading the patient', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('replaces patient conditions and normalizes dates', async () => {
    const response = await PUT(
      createRequest(
        {
          conditions: [
            {
              condition_type: 'disease',
              name: '高血圧',
              is_primary: true,
              is_active: true,
              noted_at: '2026-03-01',
              notes: '内服継続',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'corg1234567890123456789012', patient_id: 'patient_1' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          condition_type: 'disease',
          name: '高血圧',
          is_primary: true,
          is_active: true,
          noted_at: new Date('2026-03-01'),
          notes: '内服継続',
        },
      ],
    });
  });

  it('returns 404 when patient is not assigned to the requesting user', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      createRequest({ conditions: [] }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_unknown' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });
});
