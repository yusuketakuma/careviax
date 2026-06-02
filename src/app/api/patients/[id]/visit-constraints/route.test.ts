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

function createMalformedJsonPutRequest(patientId = 'patient_1') {
  return new NextRequest(`http://localhost/api/patients/${patientId}/visit-constraints`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{"preferred_weekdays":',
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

  it('rejects blank patient ids before loading visit constraint data', async () => {
    const response = (await GET(createGetRequest('%20%20'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing visit constraint payloads or upserting', async () => {
    const response = (await PUT(createMalformedJsonPutRequest(''), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(residenceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object visit constraint payloads before loading the patient', async () => {
    const response = (await PUT(createPutRequest([]), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(residenceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON visit constraint payloads before loading the patient', async () => {
    const response = (await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(residenceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed preferred contact phone before loading the patient', async () => {
    const response = (await PUT(
      createPutRequest({
        preferred_contact_name: '長男 山田',
        preferred_contact_phone: '090-ABCD-1234',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        preferred_contact_phone: ['電話番号形式が不正です'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(residenceUpdateMock).not.toHaveBeenCalled();
  });

  it('upserts visit constraints and geocoding fields', async () => {
    const response = (await PUT(
      createPutRequest({
        preferred_weekdays: [1, 3],
        preferred_time_from: '09:00',
        preferred_time_to: '12:00',
        preferred_contact_name: '長男 山田',
        preferred_contact_phone: ' 090-1111-2222 ',
        family_presence_required: true,
        residence_lat: 35.0,
        residence_lng: 139.0,
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: expect.objectContaining({
        preferred_contact_name: '長男 山田',
        preferred_contact_phone: '090-1111-2222',
      }),
      update: expect.objectContaining({
        preferred_contact_name: '長男 山田',
        preferred_contact_phone: '090-1111-2222',
      }),
    });
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
