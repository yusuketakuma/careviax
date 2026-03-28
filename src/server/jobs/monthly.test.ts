import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindManyMock,
  prescriptionIntakeFindManyMock,
  visitRecordGroupByMock,
  runJobMock,
} = vi.hoisted(() => ({
  visitRecordFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  visitRecordGroupByMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
      groupBy: visitRecordGroupByMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
  },
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { generateMonthlyMetrics, generateMonthlyVisitReport } from './monthly';

describe('generateMonthlyVisitReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns under/within/over limit summaries per org', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `medical_${index}`,
        org_id: 'org_1',
        patient_id: 'patient_over',
        schedule: {
          visit_type: 'regular',
          case_: {
            patient: {
              id: 'patient_over',
              name: 'Over',
              medical_insurance_number: 'med_1',
              care_insurance_number: null,
            },
          },
        },
      })),
      {
        id: 'care_under',
        org_id: 'org_1',
        patient_id: 'patient_under',
        schedule: {
          visit_type: 'regular',
          case_: {
            patient: {
              id: 'patient_under',
              name: 'Under',
              medical_insurance_number: null,
              care_insurance_number: 'care_1',
            },
          },
        },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `both_${index}`,
        org_id: 'org_1',
        patient_id: 'patient_within',
        schedule: {
          visit_type: 'regular',
          case_: {
            patient: {
              id: 'patient_within',
              name: 'Within',
              medical_insurance_number: 'med_2',
              care_insurance_number: 'care_2',
            },
          },
        },
      })),
    ]);

    const result = await generateMonthlyVisitReport();

    expect(result).toMatchObject({
      processedCount: 3,
      patientSummaries: {
        org_1: {
          totalPatients: 3,
          overLimit: [
            expect.objectContaining({
              patientId: 'patient_over',
              count: 5,
              monthlyLimit: 4,
            }),
          ],
          underLimit: [
            expect.objectContaining({
              patientId: 'patient_under',
              count: 1,
              monthlyLimit: 2,
            }),
          ],
          withinLimit: [
            expect.objectContaining({
              patientId: 'patient_within',
              count: 4,
              monthlyLimit: 4,
            }),
          ],
        },
      },
    });
  });
});

describe('generateMonthlyMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns month snapshots for concentration and visit counts', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      { org_id: 'org_1', prescriber_institution: 'clinic_a' },
      { org_id: 'org_1', prescriber_institution: 'clinic_a' },
      { org_id: 'org_1', prescriber_institution: 'clinic_b' },
    ]);
    visitRecordGroupByMock.mockResolvedValue([
      { org_id: 'org_1', _count: 12 },
    ]);

    const result = await generateMonthlyMetrics();

    expect(result).toMatchObject({
      processedCount: 2,
      concentrationRates: {
        org_1: 67,
      },
      homeVisitCounts: {
        org_1: 12,
      },
    });
  });
});
