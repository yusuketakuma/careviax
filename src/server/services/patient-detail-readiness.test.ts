import { describe, expect, it, vi } from 'vitest';
import { getPatientReadinessData } from './patient-detail-readiness';

function buildDb() {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    consentRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    firstVisitDocument: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    managementPlan: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    prescriptionIntake: {
      findFirst: vi.fn().mockResolvedValue({ id: 'intake_1' }),
    },
  };
}

function buildPatient() {
  return {
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
  };
}

describe('getPatientReadinessData', () => {
  it('encodes patientId only in action_href path segments and keeps DB identity raw', async () => {
    const patientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(patientId);
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(buildPatient());

    const result = await getPatientReadinessData(db, {
      orgId: 'org_1',
      patientId,
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: patientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(db.consentRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: patientId,
        }),
      }),
    );
    expect(db.firstVisitDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: patientId,
        }),
      }),
    );

    expect(result?.items.map((item) => [item.key, item.action_href])).toEqual([
      ['patient_profile', `/patients/${encodedPatientId}/edit`],
      ['primary_residence', `/patients/${encodedPatientId}/edit`],
      ['insurance', `/patients/${encodedPatientId}#patient-profile-summary`],
      ['visit_preferences', `/patients/${encodedPatientId}/edit`],
      ['care_team_recipients', `/patients/${encodedPatientId}/collaboration`],
      ['visit_consent', `/patients/${encodedPatientId}/consent`],
      ['emergency_contact', `/patients/${encodedPatientId}`],
      ['primary_physician', `/patients/${encodedPatientId}`],
      ['management_plan', `/patients/${encodedPatientId}/management-plan`],
      ['prescription_intake', `/patients/${encodedPatientId}/prescriptions`],
      ['first_visit_document', `/patients/${encodedPatientId}`],
    ]);
    expect(JSON.stringify(result?.items)).not.toContain(`/patients/${patientId}`);
  });

  it.each(['.', '..'])(
    'rejects exact dot-segment patient id %s that cannot be represented safely in this route',
    async (patientId) => {
      const db = buildDb();
      db.patient.findFirst.mockResolvedValue(buildPatient());

      await expect(
        getPatientReadinessData(db, {
          orgId: 'org_1',
          patientId,
          role: 'pharmacist',
          userId: 'user_1',
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});
