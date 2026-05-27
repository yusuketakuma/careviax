import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  medicationCycleFindManyMock,
  medicationCycleCountMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  medicationCycleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  medicationCycleFindManyMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  medicationCycleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
      count: medicationCycleCountMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/medication-cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationCycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_1',
        overall_status: 'dispensing',
        prescription_intakes: [],
      },
    ]);
    medicationCycleCountMock.mockResolvedValue(1);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    medicationCycleCreateMock.mockResolvedValue({
      id: 'cycle_2',
      overall_status: 'intake_received',
      version: 1,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          create: medicationCycleCreateMock,
        },
      }),
    );
  });

  it('lists medication cycles with filters', async () => {
    const response = (await GET(
      {
        url: 'http://localhost/api/medication-cycles?status=dispensing&patient_id=patient_1&case_id=case_1',
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          overall_status: 'dispensing',
          case_id: 'case_1',
          patient_id: 'patient_1',
          case_: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      }),
    );
  });

  it.each(['abc', '-10'])('uses a safe offset for malformed cursor %s', async (cursor) => {
    const response = (await GET(
      {
        url: `http://localhost/api/medication-cycles?cursor=${encodeURIComponent(cursor)}`,
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 51,
      }),
    );
  });

  it('creates a medication cycle after org reference validation', async () => {
    const response = (await POST(
      {
        json: async () => ({
          case_id: 'case_1',
          patient_id: 'patient_1',
        }),
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      patient_id: 'patient_1',
    });
    expect(medicationCycleCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        overall_status: 'intake_received',
        version: 1,
      },
    });
  });

  it('rejects an unassigned case before creating a medication cycle', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      {
        json: async () => ({
          case_id: 'case_2',
          patient_id: 'patient_2',
        }),
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expect(medicationCycleCreateMock).not.toHaveBeenCalled();
  });
});
