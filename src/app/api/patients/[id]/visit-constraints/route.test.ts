import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientSchedulePreferenceUpsertMock,
  residenceUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientSchedulePreferenceUpsertMock: vi.fn(),
  residenceUpdateMock: vi.fn(),
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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createGetRequest(patientId = 'patient_1') {
  return new NextRequest(`http://localhost/api/patients/${patientId}/visit-constraints`);
}

function createPutRequest(body: unknown, patientId = 'patient_1') {
  return new NextRequest(`http://localhost/api/patients/${patientId}/visit-constraints`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

describe('/api/patients/[id]/visit-constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock
      .mockResolvedValueOnce({
        id: 'patient_1',
        scheduling_preference: null,
        residences: [{ id: 'res_1' }],
      })
      .mockResolvedValueOnce({
        id: 'patient_1',
        residences: [{ id: 'res_1' }],
      });
    patientSchedulePreferenceUpsertMock.mockResolvedValue({ id: 'pref_1' });
    residenceUpdateMock.mockResolvedValue({ id: 'res_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSchedulePreference: {
          upsert: patientSchedulePreferenceUpsertMock,
        },
        residence: {
          update: residenceUpdateMock,
        },
      }),
    );
  });

  it('returns current visit constraint data', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        residence: { id: 'res_1' },
      },
    });
  });

  it('upserts visit constraints and geocoding fields', async () => {
    const response = (await PUT(
      createPutRequest({
        preferred_weekdays: [1, 3],
        preferred_time_from: '09:00',
        preferred_time_to: '12:00',
        family_presence_required: true,
        residence_lat: 35.0,
        residence_lng: 139.0,
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalled();
    expect(residenceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'res_1' },
      data: expect.objectContaining({
        lat: 35,
        lng: 139,
        geocoded_at: expect.any(Date),
      }),
    });
  });
});
