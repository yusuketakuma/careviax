import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: string;
};

const { careCaseFindFirstMock, patientFindFirstMock, findExternalProfessionalSuggestionsMock } =
  vi.hoisted(() => ({
    careCaseFindFirstMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    findExternalProfessionalSuggestionsMock: vi.fn(),
  }));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/contact-profiles', () => ({
  findExternalProfessionalSuggestions: findExternalProfessionalSuggestionsMock,
}));

import { GET } from './route';

function createRequest(search = '') {
  const req = new NextRequest(`http://localhost/api/external-professionals/suggestions${search}`);
  return Object.assign(req, {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  }) as AuthenticatedTestRequest;
}

describe('/api/external-professionals/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    findExternalProfessionalSuggestionsMock.mockResolvedValue([
      {
        id: 'external_1',
        name: '山田 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '居宅支援A',
        department: null,
        phone: '03-1111-2222',
        email: null,
        fax: '03-1111-3333',
        preferred_contact_method: 'fax',
        preferred_contact_time: '平日 14:00-17:00',
        last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        last_success_channel: 'fax',
        recommended_channels: ['fax', 'phone'],
        is_primary: true,
      },
    ]);
  });

  it('returns external professional suggestions for patient/case context', async () => {
    const response = (await GET(createRequest('?patient_id=patient_1&case_id=case_1')))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    expect(findExternalProfessionalSuggestionsMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        patientId: 'patient_1',
        caseId: 'case_1',
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'external_1',
          last_contacted_at: '2026-03-30T00:00:00.000Z',
          recommended_channels: ['fax', 'phone'],
        },
      ],
    });
  });

  it('rejects requests without patient or case context', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(400);
  });

  it('returns empty suggestions when the requested case is outside assignment scope', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest('?patient_id=patient_1&case_id=case_other')))!;

    expect(response.status).toBe(200);
    expect(findExternalProfessionalSuggestionsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: [] });
  });
});
