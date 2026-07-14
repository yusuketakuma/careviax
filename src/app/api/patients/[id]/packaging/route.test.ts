import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  recordPhiReadAuditForRequestMock,
  prismaMock,
  withOrgContextMock,
  txMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  prismaMock: {
    patient: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  txMock: {
    patientPackagingProfile: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/packaging', {
    method: body === undefined ? 'GET' : 'PUT',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedJsonPutRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/packaging', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"default_packaging_method":',
  });
}

describe('/api/patients/[id]/packaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      rateLimit: { allowed: true, remaining: 10, resetAt: Number.MAX_SAFE_INTEGER },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('returns exact packaging values and audits the authoritative patient once', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_authoritative',
      packaging_profile: {
        default_packaging_method: 'medication_box',
        medication_box_color: '赤',
        notes: '昼は別袋',
        special_instructions: '夕食後薬は手渡し',
        cognitive_note: '飲み忘れが続くと家族へ連絡',
        updated_at: new Date('2026-03-28T10:00:00.000Z'),
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        packaging_profile: {
          default_packaging_method: 'medication_box',
          medication_box_color: '赤',
          notes: '昼は別袋',
          special_instructions: '夕食後薬は手渡し',
          cognitive_note: '飲み忘れが続くと家族へ連絡',
          updated_at: '2026-03-28T10:00:00.000Z',
        },
        effective_summary: 'お薬BOX / BOX色:赤 / 昼は別袋',
      },
    });
    expect(prismaMock.patient.findFirst).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      {
        patientId: 'patient_authoritative',
        view: 'patient_packaging',
      },
    );
    expect(prismaMock.patient.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      recordPhiReadAuditForRequestMock.mock.invocationCallOrder[0]!,
    );
  });

  it('audits an empty successful packaging profile read exactly once', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_1',
      packaging_profile: null,
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        packaging_profile: null,
        effective_summary: null,
      },
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('returns an authorization rejection without reading or auditing', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before loading packaging data', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 without auditing when the patient is inaccessible', async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(prismaMock.patient.findFirst).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when packaging reads fail', async () => {
    const rawError = '患者A 一包化 medication box read failure';
    prismaMock.patient.findFirst.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('一包化');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing packaging payloads or upserting', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.patientPackagingProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-object packaging payloads before loading the patient', async () => {
    const response = await PUT(createRequest([]), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.patientPackagingProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON packaging payloads before loading the patient', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.patientPackagingProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects archived patients before upserting packaging profile', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PUT(
      createRequest({
        default_packaging_method: 'unit_dose',
        notes: '朝だけ別包',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.patientPackagingProfile.upsert).not.toHaveBeenCalled();
  });

  it('upserts the patient packaging profile', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient_1' });
    txMock.patientPackagingProfile.upsert.mockResolvedValue({
      default_packaging_method: 'unit_dose',
      medication_box_color: null,
      notes: '朝だけ別包',
      special_instructions: '朝食前薬は別袋',
      cognitive_note: '朝の声かけが必要',
      updated_at: new Date('2026-03-28T11:00:00.000Z'),
    });

    const response = await PUT(
      createRequest({
        default_packaging_method: 'unit_dose',
        notes: '朝だけ別包',
        special_instructions: '朝食前薬は別袋',
        cognitive_note: '朝の声かけが必要',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.patientPackagingProfile.upsert).toHaveBeenCalledWith({
      where: { patient_id: 'patient_1' },
      create: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        default_packaging_method: 'unit_dose',
        medication_box_color: null,
        notes: '朝だけ別包',
        special_instructions: '朝食前薬は別袋',
        cognitive_note: '朝の声かけが必要',
      },
      update: {
        default_packaging_method: 'unit_dose',
        medication_box_color: null,
        notes: '朝だけ別包',
        special_instructions: '朝食前薬は別袋',
        cognitive_note: '朝の声かけが必要',
      },
      select: {
        default_packaging_method: true,
        medication_box_color: true,
        notes: true,
        special_instructions: true,
        cognitive_note: true,
        updated_at: true,
      },
    });
    const payload = await response.json();
    expect(Object.keys(payload)).toEqual(['data']);
    expect(payload).toMatchObject({
      data: {
        packaging_profile: {
          default_packaging_method: 'unit_dose',
          notes: '朝だけ別包',
          updated_at: '2026-03-28T11:00:00.000Z',
        },
        effective_summary: expect.any(String),
      },
    });
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
  });
});
