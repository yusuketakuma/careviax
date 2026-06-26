import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, patientFindFirstMock, listPatientStructuredCareMock } = vi.hoisted(
  () => ({
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    listPatientStructuredCareMock: vi.fn(),
  }),
);

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

vi.mock('@/server/services/patient-structured-care-list', () => ({
  listPatientStructuredCare: listPatientStructuredCareMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/patients/patient_1/structured-care') {
  return new NextRequest(url);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/structured-care GET', () => {
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
    listPatientStructuredCareMock.mockResolvedValue({
      procedures: [],
      narcotics: [],
    });
  });

  it('returns structured care data with no-store headers', async () => {
    listPatientStructuredCareMock.mockResolvedValue({
      procedures: [{ id: 'procedure_1', kind: 'home_oxygen', is_active: true }],
      narcotics: [],
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(listPatientStructuredCareMock).toHaveBeenCalledWith(
      { patient: { findFirst: patientFindFirstMock } },
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        includeEnded: false,
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        procedures: [{ id: 'procedure_1', kind: 'home_oxygen' }],
        narcotics: [],
      },
    });
  });

  it('passes includeEnded when requested', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/structured-care?include_ended=true'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(listPatientStructuredCareMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeEnded: true }),
    );
  });

  it('rejects blank patient ids before patient or structured care reads', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/%20%20/structured-care'),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 when the patient is inaccessible', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when structured care reads fail', async () => {
    const rawError = '患者A HOT モルヒネ structured care read failure';
    listPatientStructuredCareMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('モルヒネ');
  });
});
