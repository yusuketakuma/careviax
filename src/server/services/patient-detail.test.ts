import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { getPatientReadinessData } from './patient-detail';

function buildDb(overrides?: Partial<Record<string, unknown>>) {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    consentRecord: {
      findFirst: vi.fn(),
    },
    managementPlan: {
      findFirst: vi.fn(),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
    },
    firstVisitDocument: {
      findFirst: vi.fn(),
    },
    ...overrides,
  } as never;
}

describe('getPatientReadinessData', () => {
  it('returns not_started when no onboarding case exists', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          contacts: [],
          cases: [],
        }),
      },
    });

    const result = await getPatientReadinessData(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
    });

    expect(result).toEqual({
      applicable: false,
      overall_status: 'not_started',
      completed_count: 0,
      total_count: 0,
      current_case: null,
      items: [],
    });
  });

  it('flags missing onboarding items for the current case', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          contacts: [{ is_emergency_contact: false }],
          cases: [
            {
              id: 'case_1',
              status: 'assessment',
              care_team_links: [],
            },
          ],
        }),
      },
      consentRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      managementPlan: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({ id: 'intake_1' }),
      },
      firstVisitDocument: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await getPatientReadinessData(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
    });

    expect(result).toMatchObject({
      applicable: true,
      overall_status: 'action_required',
      completed_count: 1,
      total_count: 6,
      current_case: {
        id: 'case_1',
        status: 'assessment',
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          key: 'visit_consent',
          completed: false,
        }),
        expect.objectContaining({
          key: 'emergency_contact',
          completed: false,
        }),
        expect.objectContaining({
          key: 'primary_physician',
          completed: false,
        }),
        expect.objectContaining({
          key: 'prescription_intake',
          completed: true,
        }),
      ]),
    });
  });
});
