import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const getPatientRiskSummaryMock = vi.hoisted(() => vi.fn());
const getPatientVisitBriefMock = vi.hoisted(() => vi.fn());
const getPatientHomeCareFeatureSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: getPatientRiskSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: getPatientVisitBriefMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: getPatientHomeCareFeatureSummaryMock,
}));

import { getPatientHeaderSummary } from './patient-detail';
import { buildDb } from './patient-detail.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  getPatientRiskSummaryMock.mockResolvedValue({
    level: 'low',
    score: 0,
    factors: [],
  });
  getPatientVisitBriefMock.mockResolvedValue(null);
  getPatientHomeCareFeatureSummaryMock.mockResolvedValue({
    states: [],
    highlights: [],
  });
});

describe('getPatientHeaderSummary', () => {
  function headerPatient(overrides: Record<string, unknown> = {}) {
    return {
      id: 'patient_1',
      name: '患者 太郎',
      name_kana: 'カンジャ タロウ',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
      allergy_info: null,
      updated_at: new Date('2026-07-22T00:00:00.000Z'),
      primary_pharmacist_id: null,
      backup_pharmacist_id: null,
      primary_staff_id: null,
      backup_staff_id: null,
      residences: [],
      scheduling_preference: null,
      conditions: [],
      cases: [],
      ...overrides,
    };
  }

  function expectedHeaderSummary(overrides: Record<string, unknown> = {}) {
    return {
      patient_id: 'patient_1',
      patient_updated_at: '2026-07-22T00:00:00.000Z',
      intake_edit_target: null,
      name: '患者 太郎',
      name_kana: 'カンジャ タロウ',
      birth_date: '1940-01-01T00:00:00.000Z',
      gender: 'male',
      gender_label: '男性',
      care_level: null,
      care_level_label: null,
      home_status_label: null,
      residence_label: null,
      primary_diagnosis: null,
      intervention_start_date: null,
      primary_pharmacist_name: null,
      backup_pharmacist_name: null,
      primary_staff_name: null,
      backup_staff_name: null,
      first_visit_date: null,
      last_prescribed_date: null,
      next_prescription_expected_date: null,
      safety: {
        allergy: null,
        renal: null,
        handling_tags: [],
        swallowing: null,
        cautions: [],
        safety_tags: [],
        visible_safety_tags: [],
        hidden_safety_tag_count: 0,
      },
      ...overrides,
    };
  }

  it('returns read-only header dates and resolved patient-level care team names within the scoped cases', async () => {
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(
      headerPatient({
        primary_pharmacist_id: 'pharmacist_1',
        backup_pharmacist_id: 'pharmacist_2',
        primary_staff_id: 'staff_1',
        backup_staff_id: 'staff_2',
        residences: [{ facility_id: 'facility_1', unit_name: '201号室' }],
        scheduling_preference: {
          care_level: 'care_3',
          swallowing_route: '錠剤OK・大きい錠は半割',
        },
        conditions: [
          {
            condition_type: 'disease',
            name: '2型糖尿病',
            is_primary: true,
            is_active: true,
            noted_at: new Date('2026-05-01T00:00:00.000Z'),
            notes: null,
          },
          {
            condition_type: 'problem',
            name: 'ふらつき',
            is_primary: false,
            is_active: true,
            noted_at: new Date('2026-06-05T00:00:00.000Z'),
            notes: '経過観察',
          },
        ],
        allergy_info: [{ drug_name: 'セフェム系', noted_year: 2019 }],
        cases: [
          {
            id: 'case_1',
            version: 7,
            status: 'completed',
            start_date: new Date('2026-01-01T00:00:00.000Z'),
          },
          { id: 'case_2', version: 8, status: 'active', start_date: null },
        ],
      }),
    );
    db.user.findMany.mockResolvedValue([
      { id: 'pharmacist_1', name: '薬剤師 花子' },
      { id: 'pharmacist_2', name: '薬剤師 太郎' },
      { id: 'staff_1', name: '事務 ひかり' },
      { id: 'staff_2', name: '事務 まこと' },
    ]);
    db.visitRecord.findFirst.mockResolvedValue({
      visit_date: new Date('2026-01-05T09:00:00.000Z'),
    });
    db.prescriptionIntake.findFirst.mockResolvedValue({
      prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
      lines: [
        {
          packaging_instruction_tags: ['cold_storage', 'narcotic'],
          dispensing_method: 'unit_dose',
        },
      ],
    });
    db.patientLabObservation.findFirst.mockResolvedValue({
      value_numeric: 38,
      value_text: null,
      measured_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const result = await getPatientHeaderSummary(
      db as unknown as Parameters<typeof getPatientHeaderSummary>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    expect(result).toEqual(
      expectedHeaderSummary({
        intake_edit_target: {
          care_case_id: 'case_2',
          expected_care_case_version: 8,
        },
        residence_label: '施設 / 201号室',
        care_level: 'care_3',
        care_level_label: '要介護 3',
        primary_diagnosis: '2型糖尿病',
        intervention_start_date: '2026-01-01T00:00:00.000Z',
        primary_pharmacist_name: '薬剤師 花子',
        backup_pharmacist_name: '薬剤師 太郎',
        primary_staff_name: '事務 ひかり',
        backup_staff_name: '事務 まこと',
        first_visit_date: '2026-01-05T09:00:00.000Z',
        last_prescribed_date: '2026-06-01T00:00:00.000Z',
        safety: {
          allergy: 'セフェム系(2019)',
          renal: 'eGFR 38(2026年6月1日)',
          handling_tags: ['narcotic', 'cold_storage', 'unit_dose'],
          swallowing: '錠剤OK・大きい錠は半割',
          cautions: ['ふらつき(6/5〜経過観察)'],
          safety_tags: ['narcotic', 'cold_storage', 'unit_dose', 'renal', 'swallowing', 'allergy'],
          visible_safety_tags: ['narcotic', 'cold_storage', 'allergy'],
          hidden_safety_tag_count: 3,
        },
      }),
    );
    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'patient_1',
          org_id: 'org_1',
        }),
        select: expect.objectContaining({
          id: true,
          name: true,
          name_kana: true,
          birth_date: true,
          gender: true,
          allergy_info: true,
          updated_at: true,
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
          primary_staff_id: true,
          backup_staff_id: true,
          residences: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
            select: {
              facility_id: true,
              unit_name: true,
            },
          },
          scheduling_preference: {
            select: {
              swallowing_route: true,
              care_level: true,
            },
          },
          conditions: {
            orderBy: [{ is_primary: 'desc' }, { noted_at: 'desc' }, { created_at: 'desc' }],
            select: {
              condition_type: true,
              name: true,
              is_primary: true,
              is_active: true,
              noted_at: true,
              notes: true,
            },
          },
          cases: expect.objectContaining({
            where: expect.objectContaining({
              org_id: 'org_1',
            }),
            orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              version: true,
              status: true,
              start_date: true,
            },
          }),
        }),
      }),
    );
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['pharmacist_1', 'pharmacist_2', 'staff_1', 'staff_2'] },
      },
      select: { id: true, name: true },
    });
    expect(db.visitRecord.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        schedule: { case_id: { in: ['case_1', 'case_2'] } },
      },
      orderBy: [{ visit_date: 'asc' }, { created_at: 'asc' }],
      select: { visit_date: true },
    });
    expect(db.prescriptionIntake.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle: {
          patient_id: 'patient_1',
          case_id: { in: ['case_1', 'case_2'] },
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      select: {
        prescribed_date: true,
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            packaging_instruction_tags: true,
            dispensing_method: true,
          },
        },
      },
    });
    expect(db.patientLabObservation.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        analyte_code: 'egfr',
      },
      orderBy: { measured_at: 'desc' },
      select: {
        value_numeric: true,
        value_text: true,
        measured_at: true,
      },
    });
  });

  it('formats the renal safety label from the Asia/Tokyo calendar date even when the server runtime timezone is UTC', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const db = buildDb();
      db.patient.findFirst.mockResolvedValue(headerPatient());
      db.user.findMany.mockResolvedValue([]);
      db.visitRecord.findFirst.mockResolvedValue(null);
      db.prescriptionIntake.findFirst.mockResolvedValue(null);
      // 2026-06-30T15:30:00.000Z is 2026-07-01T00:30 JST — just after the JST
      // midnight boundary. date-fns `format(measured_at, 'M/d')` under
      // TZ=UTC would render this as 6/30 (previous day). The shared
      // formatter must resolve the Asia/Tokyo calendar date (7/1).
      db.patientLabObservation.findFirst.mockResolvedValue({
        value_numeric: 38,
        value_text: null,
        measured_at: new Date('2026-06-30T15:30:00.000Z'),
      });

      const result = await getPatientHeaderSummary(
        db as unknown as Parameters<typeof getPatientHeaderSummary>[0],
        {
          orgId: 'org_1',
          patientId: 'patient_1',
          role: 'pharmacist',
          userId: 'user_1',
        },
      );

      expect(result?.safety.renal).toBe('eGFR 38(2026年7月1日)');
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });

  it('returns null when the patient is outside the readable scope', async () => {
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(null);

    await expect(
      getPatientHeaderSummary(db as unknown as Parameters<typeof getPatientHeaderSummary>[0], {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).resolves.toBeNull();
    expect(db.visitRecord.findFirst).not.toHaveBeenCalled();
    expect(db.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates assigned user lookups and leaves missing assigned names null', async () => {
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(
      headerPatient({
        primary_pharmacist_id: 'shared_user',
        backup_pharmacist_id: 'shared_user',
        primary_staff_id: 'missing_staff',
        backup_staff_id: null,
        cases: [{ id: 'case_1', version: 3, status: 'completed', start_date: null }],
      }),
    );
    db.user.findMany.mockResolvedValue([{ id: 'shared_user', name: '薬剤師 花子' }]);
    db.visitRecord.findFirst.mockResolvedValue(null);
    db.prescriptionIntake.findFirst.mockResolvedValue(null);

    await expect(
      getPatientHeaderSummary(db as unknown as Parameters<typeof getPatientHeaderSummary>[0], {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).resolves.toEqual(
      expectedHeaderSummary({
        intake_edit_target: {
          care_case_id: 'case_1',
          expected_care_case_version: 3,
        },
        primary_pharmacist_name: '薬剤師 花子',
        backup_pharmacist_name: '薬剤師 花子',
        primary_staff_name: null,
        backup_staff_name: null,
      }),
    );
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['shared_user', 'missing_staff'] },
      },
      select: { id: true, name: true },
    });
  });

  it('keeps optional header fields null when no scoped source data exists', async () => {
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(
      headerPatient({
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        cases: [],
      }),
    );

    await expect(
      getPatientHeaderSummary(db as unknown as Parameters<typeof getPatientHeaderSummary>[0], {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).resolves.toEqual(expectedHeaderSummary());
    expect(db.visitRecord.findFirst).not.toHaveBeenCalled();
    expect(db.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.patientLabObservation.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        analyte_code: 'egfr',
      },
      orderBy: { measured_at: 'desc' },
      select: {
        value_numeric: true,
        value_text: true,
        measured_at: true,
      },
    });
  });

  it('does not fall back to case-level assignments when patient-level care team fields are empty', async () => {
    const db = buildDb();
    db.patient.findFirst.mockResolvedValue(
      headerPatient({
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        cases: [
          {
            id: 'case_latest',
            version: 5,
            status: 'completed',
            start_date: null,
          },
          {
            id: 'case_old',
            version: 4,
            status: 'cancelled',
            start_date: null,
          },
        ],
      }),
    );
    db.visitRecord.findFirst.mockResolvedValue(null);
    db.prescriptionIntake.findFirst.mockResolvedValue(null);

    await expect(
      getPatientHeaderSummary(db as unknown as Parameters<typeof getPatientHeaderSummary>[0], {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).resolves.toEqual(
      expectedHeaderSummary({
        intake_edit_target: {
          care_case_id: 'case_latest',
          expected_care_case_version: 5,
        },
      }),
    );
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
