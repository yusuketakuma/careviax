import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  prismaMock,
  withOrgContextMock,
  txMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
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

describe('/api/patients/[id]/packaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      rateLimit: { allowed: true, remaining: 10, resetAt: Number.MAX_SAFE_INTEGER },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('returns the patient packaging profile and effective summary', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_1',
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
    await expect(response.json()).resolves.toMatchObject({
      data: {
        packaging_profile: {
          default_packaging_method: 'medication_box',
          medication_box_color: '赤',
          special_instructions: '夕食後薬は手渡し',
          cognitive_note: '飲み忘れが続くと家族へ連絡',
        },
        effective_summary: 'お薬BOX / BOX色:赤 / 昼は別袋',
      },
    });
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
  });
});
