import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientInsuranceFindFirstMock,
  patientInsuranceUpdateMock,
  patientInsuranceDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  patientInsuranceUpdateMock: vi.fn(),
  patientInsuranceDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PUT } from './route';

describe('/api/patients/[id]/insurance/[insuranceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientInsuranceFindFirstMock.mockResolvedValue({ id: 'insurance_1' });
    patientInsuranceUpdateMock.mockResolvedValue({ id: 'insurance_1', is_active: false });
    patientInsuranceDeleteMock.mockResolvedValue({ id: 'insurance_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientInsurance: {
          update: patientInsuranceUpdateMock,
          delete: patientInsuranceDeleteMock,
        },
      }),
    );
  });

  it('updates an insurance record', async () => {
    const response = await PUT(
      {
        json: async () => ({ is_active: false }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'insurance_1' },
      data: { is_active: false },
    });
  });

  it('deletes an insurance record', async () => {
    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceDeleteMock).toHaveBeenCalledWith({
      where: { id: 'insurance_1' },
    });
    await expect(response.json()).resolves.toMatchObject({
      id: 'insurance_1',
      deleted: true,
    });
  });

  it('DELETE returns 404 when insurance belongs to a different org (cross-tenant)', async () => {
    // findFirst returns null because org_id does not match
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_other_org' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('DELETE returns 404 when insurance id does not exist', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'nonexistent_id' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('PUT returns 403 when user lacks canVisit permission', async () => {
    // clerk role does not have canVisit permission
    requireAuthContextMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '患者保険情報の更新権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = await PUT(
      {
        json: async () => ({ is_active: false }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('DELETE returns 403 when user lacks canVisit permission', async () => {
    // clerk role does not have canVisit permission
    requireAuthContextMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '患者保険情報の削除権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('PUT returns 400 when request body fails validation', async () => {
    const response = await PUT(
      {
        json: async () => ({
          copay_ratio: 150, // exceeds max of 100
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 400 when request body is not valid JSON', async () => {
    const response = await PUT(
      {
        json: async () => {
          throw new Error('invalid json');
        },
      } as unknown as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when insurance belongs to a different org (cross-tenant)', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      {
        json: async () => ({ is_active: false }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_other_org' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when insurance id does not exist', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      {
        json: async () => ({ is_active: false }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'nonexistent_id' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });
});
