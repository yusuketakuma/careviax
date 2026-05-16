import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientInsuranceFindManyMock,
  patientInsuranceCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  patientInsuranceCreateMock: vi.fn(),
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
      findMany: patientInsuranceFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(body?: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

const routeParams = { params: Promise.resolve({ id: 'patient_1' }) };
const patientAssignmentLookup = {
  where: {
    id: 'patient_1',
    org_id: 'org_1',
    AND: [
      {
        cases: {
          some: {
            OR: [
              { primary_pharmacist_id: 'pharmacist_1' },
              { backup_pharmacist_id: 'pharmacist_1' },
              { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
            ],
          },
        },
      },
    ],
  },
  select: { id: true },
};

function expectPatientAssignmentLookup() {
  expect(patientFindFirstMock).toHaveBeenCalledWith(patientAssignmentLookup);
}

describe('/api/patients/[id]/insurance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'pharmacist_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientInsuranceFindManyMock.mockResolvedValue([]);
    patientInsuranceCreateMock.mockResolvedValue({ id: 'insurance_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientInsurance: {
          create: patientInsuranceCreateMock,
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET returns classified insurance records for an assigned patient', async () => {
    const currentInsurance = {
      id: 'insurance_current',
      is_active: true,
      valid_from: new Date('2026-04-01'),
      valid_until: new Date('2026-04-30'),
      created_at: new Date('2026-04-01T01:00:00.000Z'),
    };
    const upcomingInsurance = {
      id: 'insurance_upcoming',
      is_active: true,
      valid_from: new Date('2026-05-01'),
      valid_until: new Date('2027-03-31'),
      created_at: new Date('2026-04-02T01:00:00.000Z'),
    };
    const inactiveHistoryInsurance = {
      id: 'insurance_inactive_history',
      is_active: false,
      valid_from: new Date('2025-04-01'),
      valid_until: new Date('2026-03-31'),
      created_at: new Date('2025-04-01T01:00:00.000Z'),
    };
    const expiredHistoryInsurance = {
      id: 'insurance_expired_history',
      is_active: true,
      valid_from: new Date('2025-04-01'),
      valid_until: new Date('2026-03-31'),
      created_at: new Date('2025-04-02T01:00:00.000Z'),
    };
    patientInsuranceFindManyMock.mockResolvedValue([
      currentInsurance,
      upcomingInsurance,
      inactiveHistoryInsurance,
      expiredHistoryInsurance,
    ]);

    const response = await GET({} as unknown as NextRequest, routeParams);

    expect(response.status).toBe(200);
    expectPatientAssignmentLookup();
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith({
      where: { patient_id: 'patient_1', org_id: 'org_1' },
      orderBy: [{ is_active: 'desc' }, { valid_from: 'desc' }, { created_at: 'desc' }],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        current: [{ id: 'insurance_current' }],
        upcoming: [{ id: 'insurance_upcoming' }],
        history: [{ id: 'insurance_inactive_history' }, { id: 'insurance_expired_history' }],
        all: [
          { id: 'insurance_current' },
          { id: 'insurance_upcoming' },
          { id: 'insurance_inactive_history' },
          { id: 'insurance_expired_history' },
        ],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('GET returns 404 for an inaccessible patient without reading insurance records', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET({} as unknown as NextRequest, routeParams);

    expect(response.status).toBe(404);
    expectPatientAssignmentLookup();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST returns 404 for an inaccessible patient without reading or writing insurance records', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        insurer_number: '12345678',
        valid_from: '2026-04-01',
      }),
      routeParams,
    );

    expect(response.status).toBe(404);
    expectPatientAssignmentLookup();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST returns 400 for an invalid body before patient lookup or DB writes', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        valid_from: '2026/04/01',
      }),
      routeParams,
    );

    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST creates insurance with context org, route patient, and Date validity fields', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'care',
        insurer_number: '87654321',
        symbol: 'A-1',
        number: '00001234',
        branch_number: '01',
        copay_ratio: 10,
        valid_from: '2026-04-01',
        valid_until: '2027-03-31',
        is_active: true,
        notes: 'initial registration',
      }),
      routeParams,
    );

    expect(response.status).toBe(200);
    expectPatientAssignmentLookup();
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'care',
        insurer_number: '87654321',
        symbol: 'A-1',
        number: '00001234',
        branch_number: '01',
        copay_ratio: 10,
        is_active: true,
        notes: 'initial registration',
        valid_from: new Date('2026-04-01'),
        valid_until: new Date('2027-03-31'),
      },
    });
  });
});
