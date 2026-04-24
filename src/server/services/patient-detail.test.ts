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
          name: '患者 太郎',
          name_kana: 'カンジャ タロウ',
          birth_date: new Date('1940-01-01'),
          gender: 'male',
          phone: null,
          medical_insurance_number: null,
          care_insurance_number: null,
          residences: [],
          scheduling_preference: null,
          insurances: [],
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
          name: '患者 太郎',
          name_kana: 'カンジャ タロウ',
          birth_date: new Date('1940-01-01'),
          gender: 'male',
          phone: null,
          medical_insurance_number: null,
          care_insurance_number: null,
          residences: [],
          scheduling_preference: null,
          insurances: [],
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
      completed_count: 2,
      total_count: 11,
      current_case: {
        id: 'case_1',
        status: 'assessment',
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          key: 'primary_residence',
          completed: false,
        }),
        expect.objectContaining({
          key: 'insurance',
          completed: false,
        }),
        expect.objectContaining({
          key: 'care_team_recipients',
          completed: false,
        }),
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

  it('marks patient master prerequisites as ready when core patient data is complete', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '患者 太郎',
          name_kana: 'カンジャ タロウ',
          birth_date: new Date('1940-01-01'),
          gender: 'male',
          phone: '03-0000-0000',
          medical_insurance_number: 'med_1',
          care_insurance_number: null,
          residences: [{ address: '東京都千代田区1-1-1', facility_id: null, building_id: '山田家' }],
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
            visit_buffer_minutes: null,
            preferred_contact_name: null,
            preferred_contact_phone: null,
            visit_before_contact_required: null,
          },
          insurances: [],
          contacts: [{ is_emergency_contact: true }],
          cases: [
            {
              id: 'case_1',
              status: 'active',
              care_team_links: [
                { role: 'doctor' },
                { role: 'visiting_nurse' },
                { role: 'cm' },
              ],
            },
          ],
        }),
      },
      consentRecord: {
        findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
      },
      managementPlan: {
        findFirst: vi.fn().mockResolvedValue({
          status: 'approved',
          next_review_date: new Date('2099-01-01'),
        }),
      },
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({ id: 'intake_1' }),
      },
      firstVisitDocument: {
        findFirst: vi.fn().mockResolvedValue({ id: 'doc_1' }),
      },
    });

    const result = await getPatientReadinessData(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
    });

    expect(result).toMatchObject({
      applicable: true,
      overall_status: 'ready',
      completed_count: 11,
      total_count: 11,
    });
  });
});
