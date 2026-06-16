import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientInsuranceFindFirstMock,
  patientInsuranceOverlapFindFirstMock,
  patientInsuranceUpdateMock,
  patientInsuranceDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  patientInsuranceOverlapFindFirstMock: vi.fn(),
  patientInsuranceUpdateMock: vi.fn(),
  patientInsuranceDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PUT } from './route';

function createPutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance/insurance_1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance/insurance_1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

function createDeleteRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance/insurance_1', {
    method: 'DELETE',
  });
}

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
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_1',
      insurance_type: 'care',
      public_program_code: null,
      valid_from: new Date('2026-04-01'),
      valid_until: new Date('2027-03-31'),
      is_active: true,
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    patientInsuranceOverlapFindFirstMock.mockResolvedValue(null);
    patientInsuranceUpdateMock.mockResolvedValue({ id: 'insurance_1', is_active: false });
    patientInsuranceDeleteMock.mockResolvedValue({ id: 'insurance_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientInsurance: {
          findFirst: patientInsuranceOverlapFindFirstMock,
          update: patientInsuranceUpdateMock,
          delete: patientInsuranceDeleteMock,
        },
      }),
    );
  });

  it('updates an insurance record', async () => {
    const response = await PUT(
      createPutRequest({
        is_active: false,
        application_status: 'confirmed',
        application_submitted_at: '2026-04-10',
        decision_at: '2026-04-20',
        previous_care_level: 'care_1',
        provisional_care_level: null,
        confirmed_care_level: 'care_2',
      }),
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'insurance_1' },
      data: {
        is_active: false,
        application_status: 'confirmed',
        application_submitted_at: new Date('2026-04-10'),
        decision_at: new Date('2026-04-20'),
        previous_care_level: 'care_1',
        provisional_care_level: null,
        confirmed_care_level: 'care_2',
      },
    });
  });

  it('PUT rejects overlapping active insurance before updating duplicate validity windows', async () => {
    patientInsuranceOverlapFindFirstMock.mockResolvedValue({ id: 'insurance_existing' });

    const response = await PUT(
      createPutRequest({
        valid_from: '2026-05-01',
        valid_until: '2027-04-30',
      }),
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ期間に有効な保険情報が既に存在します',
      details: {
        valid_from: ['同一患者・同一保険種別の有効期間が重複しています'],
      },
    });
    expect(patientInsuranceOverlapFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'care',
        is_active: true,
        id: { not: 'insurance_1' },
        AND: [
          { OR: [{ valid_from: null }, { valid_from: { lte: new Date('2027-04-30') } }] },
          { OR: [{ valid_until: null }, { valid_until: { gte: new Date('2026-05-01') } }] },
        ],
      },
      select: { id: true },
    });
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 409 for an archived patient before loading or updating insurance records', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await PUT(createPutRequest({ is_active: false }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'アーカイブ中の患者は復元するまで更新できません',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('deletes an insurance record', async () => {
    const response = await DELETE(createDeleteRequest(), {
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

  it('DELETE returns 409 for an archived patient before deleting insurance records', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('PUT rejects non-object payloads before loading the insurance record', async () => {
    const response = await PUT(createPutRequest([]), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT rejects blank patient ids before parsing payloads or loading insurance records', async () => {
    const response = await PUT(createInvalidJsonRequest(), {
      params: Promise.resolve({ id: '   ', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT rejects blank insurance ids before parsing payloads or loading insurance records', async () => {
    const response = await PUT(createInvalidJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '保険情報IDが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT rejects public subsidy fields when existing insurance is medical', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_1',
      insurance_type: 'medical',
    });

    const response = await PUT(createPutRequest({ public_program_code: '54' }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        public_program_code: ['公費制度コードは公費保険でのみ指定できます'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT rejects change-pending status when existing insurance is medical', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_1',
      insurance_type: 'medical',
    });

    const response = await PUT(createPutRequest({ application_status: 'change_pending' }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        application_status: ['区分変更中は介護保険または公費保険で指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('DELETE returns 404 when insurance belongs to a different org (cross-tenant)', async () => {
    // findFirst returns null because org_id does not match
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_other_org' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('DELETE returns 404 when insurance id does not exist', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'nonexistent_id' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('DELETE rejects blank patient ids before loading or deleting insurance records', async () => {
    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: '\t\n', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('DELETE rejects blank insurance ids before loading or deleting insurance records', async () => {
    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '保険情報IDが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
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

    const response = await PUT(createPutRequest({ is_active: false }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

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

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientInsuranceDeleteMock).not.toHaveBeenCalled();
  });

  it('PUT returns 400 when request body fails validation', async () => {
    const response = await PUT(
      createPutRequest({
        copay_ratio: 150, // exceeds max of 100
      }),
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT rejects invalid date and insurance field combinations before loading records', async () => {
    const response = await PUT(
      createPutRequest({
        insurance_type: 'medical',
        public_program_code: '54',
        valid_from: '2026-02-30',
        valid_until: '2026-01-31',
      }),
      {
        params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 400 when request body is not valid JSON', async () => {
    const response = await PUT(createInvalidJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when insurance belongs to a different org (cross-tenant)', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await PUT(createPutRequest({ is_active: false }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'insurance_other_org' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when insurance id does not exist', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue(null);

    const response = await PUT(createPutRequest({ is_active: false }), {
      params: Promise.resolve({ id: 'patient_1', insuranceId: 'nonexistent_id' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
  });
});
