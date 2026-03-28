import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientVisitBriefMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientVisitBriefMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientVisitBriefMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/patients/[id]/visit-brief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A' },
      context: 'patient',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: null,
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      ai_summary: {
        provider: 'rule',
        is_fallback: true,
        headline: '要点なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
  });

  it('returns patient visit brief', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(patientVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      context: 'patient',
    });
    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        context: 'patient',
      },
    });
  });
});
