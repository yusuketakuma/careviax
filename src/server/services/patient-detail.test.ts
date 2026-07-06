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

import type { Prisma } from '@prisma/client';
import type { ScopedTxRunner } from '@/lib/db/rls';
import {
  getPatientHeaderSummary,
  getPatientDocumentsData,
  getPatientOverview,
  getPatientReadinessData,
  getPatientTimelineData,
  getPatientVisitsData,
  getPatientWorkflowPreviewData,
} from './patient-detail';

/**
 * In-process ScopedTxRunner that runs `work` directly against the injected `db`
 * mock (no real tx). The suite mocks global `@/lib/db/client` as `{}`, so any
 * read that escaped onto the global prisma would throw — proving every timeline
 * read flows through this injected executor.
 */
const runnerFor =
  (db: unknown): ScopedTxRunner =>
  (work) =>
    work(db as Prisma.TransactionClient);

function buildDb<T extends Record<string, unknown> = Record<string, never>>(overrides?: T) {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    task: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    consentRecord: {
      findFirst: vi.fn(),
    },
    managementPlan: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    firstVisitDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    template: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    visitSchedule: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    visitRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    patientMcsMessage: { findMany: vi.fn().mockResolvedValue([]) },
    partnerVisitRecord: { findMany: vi.fn().mockResolvedValue([]) },
    residualMedication: { findMany: vi.fn().mockResolvedValue([]) },
    patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
    externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
    inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
    dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
    conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
    billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([]),
      // buildPatientWorkspace(06_card 集約): 進行中サイクルなし → workspace は null
      findFirst: vi.fn().mockResolvedValue(null),
    },
    patientLabObservation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    patientInsurance: { findMany: vi.fn().mockResolvedValue([]) },
    patientFieldRevision: { findMany: vi.fn().mockResolvedValue([]) },
    jahisSupplementalRecord: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    // first_visit_document の操作履歴は ROW_NUMBER() window query (raw SQL) で取得する。
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

type ConsoleErrorSpy = { mock: { calls: unknown[][] } };

function parseConsoleErrorJson(spy: ConsoleErrorSpy) {
  return spy.mock.calls.flatMap((call) => {
    const [line] = call;
    if (typeof line !== 'string') return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function expectPatientTimelineFailureLog(spy: ConsoleErrorSpy, operation: string): void {
  expect(parseConsoleErrorJson(spy)).toContainEqual(
    expect.objectContaining({
      level: 'error',
      message: 'patient_timeline_source_query_failed',
      service: 'ph-os',
      event: 'patient_timeline_source_query_failed',
      orgId: 'org_1',
      operation,
      error_name: 'Error',
    }),
  );
}

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
          { id: 'case_1', start_date: new Date('2026-01-01T00:00:00.000Z') },
          { id: 'case_2', start_date: null },
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
        cases: [{ id: 'case_1', start_date: null }],
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
            start_date: null,
          },
          {
            id: 'case_old',
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
    ).resolves.toEqual(expectedHeaderSummary());
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe('getPatientOverview', () => {
  function buildOverviewPatient() {
    return {
      id: 'patient_1',
      name: '患者 太郎',
      name_kana: 'カンジャ タロウ',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
      phone: '03-1234-5678',
      medical_insurance_number: 'MED1234567',
      care_insurance_number: 'CARE987654',
      billing_support_flag: false,
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: 'pharmacist_backup',
      primary_staff_id: 'staff_primary',
      backup_staff_id: 'staff_backup',
      allergy_info: null,
      notes: null,
      archived_at: null,
      archived_by: null,
      residences: [{ id: 'residence_1', address: '東京都千代田区1-1-1' }],
      scheduling_preference: null,
      contacts: [],
      conditions: [],
      consents: [],
      cases: [{ id: 'case_1', care_team_links: [] }],
    };
  }

  it('masks PHI fields for external viewers while keeping privacy flags explicit', async () => {
    const patientInsuranceFindManyMock = vi.fn().mockResolvedValue([
      {
        insurance_type: 'public_subsidy',
        application_status: 'confirmed',
        public_program_code: '54',
        copay_ratio: 10,
        valid_from: new Date('2026-04-01T00:00:00.000Z'),
        valid_until: null,
        is_active: true,
        confirmed_care_level: null,
        insurer_number: '21540000',
        number: '54001234',
        symbol: 'A-1',
        branch_number: '01',
        notes: 'raw insurance note',
      },
    ]);
    const patientFieldRevisionFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'rev_phone',
        category: 'basic',
        field_key: 'phone',
        field_label: '電話番号',
        value_label: '090-0000-0000 → 080-1111-2222',
        old_value: '090-0000-0000',
        new_value: '080-1111-2222',
        source: 'free text 080-1111-2222',
        source_visit_record_id: null,
        change_reason: null,
        importance: 'normal',
        confirmed_by: 'checker_1',
        confirmed_at: new Date('2026-06-15T00:00:00.000Z'),
        valid_from: new Date('2026-06-15T00:00:00.000Z'),
        valid_to: null,
        is_current: true,
        updated_by: 'pharmacist_1',
        created_at: new Date('2026-06-15T09:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue(buildOverviewPatient()),
      },
      patientInsurance: {
        findMany: patientInsuranceFindManyMock,
      },
      patientFieldRevision: {
        findMany: patientFieldRevisionFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pharmacist_1', name: '佐藤 薬剤師' },
          { id: 'checker_1', name: '鈴木 管理者' },
        ]),
      },
      jahisSupplementalRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jahis_1',
            record_type: 'insurance',
            record_label: '保険',
            line_number: 12,
            summary: '保険情報',
            payload: { insurer_number: '21540000', recipient_number: '54001234' },
            raw_line: 'JAHIS,21540000,54001234,A-1',
          },
        ]),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'external_viewer',
        userId: 'external_1',
      },
    );

    expect(result).toMatchObject({
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: 'pharmacist_backup',
      primary_staff_id: 'staff_primary',
      backup_staff_id: 'staff_backup',
      phone: '***-****-5678',
      medical_insurance_number: '***-567',
      care_insurance_number: '***-654',
      residences: [expect.objectContaining({ address: '東京都千代田***' })],
      privacy: {
        sensitive_fields_masked: true,
        address_fields_masked: true,
        can_view_detail: false,
      },
    });
    const serializedFoundation = JSON.stringify(result?.foundation);
    expect(serializedFoundation).toContain('公費 54');
    expect(serializedFoundation).not.toMatch(/21540000|54001234|A-1|raw insurance note/);
    expect(serializedFoundation).not.toMatch(/090-0000-0000|080-1111-2222/);
    expect(serializedFoundation).not.toMatch(/insurer_number|"number"|symbol|branch_number|notes/);
    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          meta: expect.objectContaining({
            updated_at: '2026-06-15',
            updated_by_name: null,
            source: '更新元不明',
            confirmed_at: '2026-06-15',
            confirmed_by_name: null,
            confirmation_status: 'confirmed',
            confirmation_detail: '確認済み',
            stale: false,
          }),
        }),
      ]),
    );
    expect(serializedFoundation).not.toMatch(/佐藤 薬剤師|鈴木 管理者/);
    expect(result?.foundation.changes_since_last_visit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updated_by_name: null,
        }),
      ]),
    );
    const foundationInsuranceQuery = patientInsuranceFindManyMock.mock.calls[0]?.[0] as {
      select?: Record<string, unknown>;
    };
    expect(foundationInsuranceQuery.select).toBeDefined();
    expect(foundationInsuranceQuery.select).not.toHaveProperty('insurer_number');
    expect(foundationInsuranceQuery.select).not.toHaveProperty('number');
    expect(foundationInsuranceQuery.select).not.toHaveProperty('symbol');
    expect(foundationInsuranceQuery.select).not.toHaveProperty('branch_number');
    expect(foundationInsuranceQuery.select).not.toHaveProperty('notes');
    const foundationRevisionQuery = patientFieldRevisionFindManyMock.mock.calls[0]?.[0] as {
      select?: Record<string, unknown>;
    };
    expect(foundationRevisionQuery.select).toBeDefined();
    expect(foundationRevisionQuery.select).not.toHaveProperty('old_value');
    expect(foundationRevisionQuery.select).not.toHaveProperty('new_value');
    expect(foundationRevisionQuery.select).not.toHaveProperty('value_label');
    expect(foundationRevisionQuery.select).not.toHaveProperty('change_reason');
    expect(result?.jahis_supplemental_records).toEqual([
      {
        id: 'jahis_1',
        record_type: 'insurance',
        record_label: '保険',
        line_number: 12,
        summary: '保険情報',
      },
    ]);
    expect(JSON.stringify(result?.jahis_supplemental_records)).not.toMatch(
      /21540000|54001234|JAHIS/,
    );
  });

  it('preserves raw PHI fields for pharmacist roles', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
      jahisSupplementalRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jahis_1',
            record_type: 'insurance',
            record_label: '保険',
            line_number: 12,
            summary: '保険情報',
            payload: { insurer_number: '21540000', recipient_number: '54001234' },
            raw_line: 'JAHIS,21540000,54001234,A-1',
          },
        ]),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result).toMatchObject({
      phone: '03-1234-5678',
      medical_insurance_number: 'MED1234567',
      care_insurance_number: 'CARE987654',
      residences: [expect.objectContaining({ address: '東京都千代田区1-1-1' })],
      privacy: {
        sensitive_fields_masked: false,
        address_fields_masked: false,
        can_view_detail: true,
      },
    });
    expect(result?.jahis_supplemental_records).toEqual([
      expect.objectContaining({
        id: 'jahis_1',
        payload: { insurer_number: '21540000', recipient_number: '54001234' },
        raw_line: 'JAHIS,21540000,54001234,A-1',
      }),
    ]);
  });

  it('downgrades ready foundation items when current metadata is unconfirmed', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            visit_before_contact_required: true,
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
      patientFieldRevision: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rev_phone',
            category: 'basic',
            field_key: 'phone',
            field_label: '電話番号',
            source: 'patient_detail_edit',
            confirmed_by: null,
            confirmed_at: null,
            is_current: true,
            updated_by: 'pharmacist_1',
            created_at: new Date('2026-06-15T09:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'pharmacist_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          status: 'needs_confirmation',
          detail: '電話可能な主連絡先または緊急連絡先があります。 / 確認者未設定',
          meta: expect.objectContaining({
            confirmation_status: 'unconfirmed',
            confirmation_detail: '確認者未設定',
            stale: false,
          }),
        }),
      ]),
    );
    expect(result?.foundation.summary.status).toBe('needs_confirmation');
  });

  it('uses confirmed_at instead of updated_at for foundation confirmation freshness', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            visit_before_contact_required: true,
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
      patientFieldRevision: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rev_phone',
            category: 'basic',
            field_key: 'phone',
            field_label: '電話番号',
            source: 'patient_detail_edit',
            confirmed_by: 'checker_1',
            confirmed_at: new Date('2026-06-15T00:00:00.000Z'),
            is_current: true,
            updated_by: 'pharmacist_1',
            created_at: new Date('2025-01-01T09:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pharmacist_1', name: '佐藤 薬剤師' },
          { id: 'checker_1', name: '鈴木 管理者' },
        ]),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          status: 'ready',
          meta: expect.objectContaining({
            confirmed_at: '2026-06-15',
            confirmation_status: 'confirmed',
            stale: false,
          }),
        }),
      ]),
    );
  });

  it('marks foundation metadata stale when confirmation is older than the freshness window', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            visit_before_contact_required: true,
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
      patientFieldRevision: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rev_phone',
            category: 'basic',
            field_key: 'phone',
            field_label: '電話番号',
            source: 'patient_detail_edit',
            confirmed_by: 'checker_1',
            confirmed_at: new Date('2025-01-01T00:00:00.000Z'),
            is_current: true,
            updated_by: 'pharmacist_1',
            created_at: new Date('2026-06-15T09:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pharmacist_1', name: '佐藤 薬剤師' },
          { id: 'checker_1', name: '鈴木 管理者' },
        ]),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          status: 'needs_confirmation',
          detail: '電話可能な主連絡先または緊急連絡先があります。 / 180日超',
          meta: expect.objectContaining({
            confirmation_status: 'stale',
            confirmation_detail: '180日超',
            stale: true,
          }),
        }),
      ]),
    );
  });

  it('surfaces medication risk signals in the patient foundation without extra detail UI logic', async () => {
    getPatientRiskSummaryMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      patient_name: '患者 太郎',
      score: 5,
      level: 'watch',
      reasons: ['薬学的課題が 2 件あります', '訪問同意が未整備です'],
      unresolved_self_reports: 0,
      open_issues: 2,
      disrupted_visits_30d: 0,
      pending_reports: 0,
      open_tasks: 0,
      missing_visit_consent: true,
      missing_management_plan: true,
    });
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.summary.status).toBe('needs_confirmation');
    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'medication_risk',
          label: '薬学リスク',
          status: 'needs_confirmation',
          detail: '薬学的課題2件 / 訪問同意未整備 / 管理計画未整備',
          action_href: '/patients/patient_1/safety-check',
        }),
      ]),
    );
  });

  it('surfaces persisted next-visit preparation progress in the patient foundation', async () => {
    const visitScheduleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'schedule_20260620',
      scheduled_date: new Date('2026-06-20T00:00:00.000Z'),
      preparation: {
        medication_changes_reviewed: true,
        carry_items_confirmed: false,
        previous_issues_reviewed: true,
        route_confirmed: false,
        offline_synced: false,
        prepared_at: null,
      },
    });
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            parking_available: true,
            care_level: '要介護2',
          },
        }),
      },
      visitSchedule: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: visitScheduleFindFirstMock,
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          scheduled_date: expect.objectContaining({ gte: expect.any(Date) }),
          schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
          case_: { patient_id: 'patient_1' },
        }),
      }),
    );
    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'visit_preparation',
          label: '訪問前準備',
          status: 'needs_confirmation',
          detail: '2026-06-20 / 2/5完了 / 未完: 持参物、ルート、オフライン同期',
          action_href: '/schedules?date=2026-06-20',
          action_label: '訪問前準備へ',
        }),
      ]),
    );
  });

  it('keeps the main contact foundation item unready when only a contact name is registered', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: null,
            parking_available: true,
            care_level: '要介護2',
          },
          contacts: [],
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          status: 'needs_confirmation',
          detail: '連絡先名はありますが連絡手段が未確認です。',
        }),
      ]),
    );
    expect(result?.foundation.summary.items).toEqual(expect.arrayContaining(['連絡先未設定']));
  });

  it('uses a phone-capable emergency contact as the main contact foundation signal', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: null,
            preferred_contact_phone: null,
            parking_available: true,
            care_level: '要介護2',
          },
          contacts: [
            {
              is_primary: false,
              is_emergency_contact: true,
              phone: '090-9999-0000',
              email: null,
              fax: null,
            },
          ],
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'contact',
          status: 'ready',
          detail: '電話可能な主連絡先または緊急連絡先があります。',
        }),
      ]),
    );
    expect(JSON.stringify(result?.foundation)).not.toContain('090-9999-0000');
  });

  it('surfaces care-team contact reliability without rendering contact PHI', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            parking_available: true,
            care_level: '要介護2',
          },
          contacts: [
            {
              id: 'contact_1',
              name: '山田 花子',
              phone: null,
              email: null,
              fax: null,
              is_primary: false,
              is_emergency_contact: true,
            },
          ],
          cases: [
            {
              id: 'case_1',
              care_team_links: [
                {
                  role: 'physician',
                  name: '田中 医師',
                  phone: '03-1111-2222',
                  email: null,
                  fax: null,
                },
                {
                  role: 'visiting_nurse',
                  name: '訪問看護 A',
                  phone: null,
                  email: null,
                  fax: null,
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'care_team_reliability',
          label: '連絡先・連携先',
          status: 'needs_confirmation',
          detail:
            '緊急連絡先の電話未確認 / 不足: ケアマネ / 電話未確認: 訪看 / 報告FAX未登録: 医師、訪看',
          action_href: '/patients/patient_1/edit?section=team#intake.care_manager.name',
        }),
      ]),
    );
    expect(result?.foundation.summary.items).toEqual(expect.arrayContaining(['連携先1件']));
    const serializedFoundation = JSON.stringify(result?.foundation);
    expect(serializedFoundation).not.toMatch(
      /090-0000-0000|03-1111-2222|山田 花子|田中 医師|訪問看護 A/,
    );
  });

  it('uses the active case for care-team reliability even when a newer inactive case is first', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          scheduling_preference: {
            preferred_contact_name: '長女',
            preferred_contact_phone: '090-0000-0000',
            parking_available: true,
            care_level: '要介護2',
          },
          contacts: [
            {
              id: 'contact_1',
              name: '山田 花子',
              phone: '090-1111-2222',
              email: null,
              fax: null,
              is_primary: false,
              is_emergency_contact: true,
            },
          ],
          cases: [
            {
              id: 'case_newer_on_hold',
              status: 'on_hold',
              care_team_links: [
                {
                  role: 'physician',
                  name: '休止医師',
                  phone: '03-0000-0001',
                  email: null,
                  fax: '03-0000-0002',
                },
                {
                  role: 'visiting_nurse',
                  name: '休止訪看',
                  phone: '03-0000-0003',
                  email: null,
                  fax: '03-0000-0004',
                },
                {
                  role: 'care_manager',
                  name: '休止CM',
                  phone: '03-0000-0005',
                  email: null,
                  fax: '03-0000-0006',
                },
              ],
            },
            {
              id: 'case_active',
              status: 'active',
              care_team_links: [
                {
                  role: 'doctor',
                  name: '現主治医',
                  phone: '03-1111-2222',
                  email: null,
                  fax: null,
                },
              ],
            },
          ],
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.foundation.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'care_team_reliability',
          status: 'needs_confirmation',
          detail: '緊急連絡先あり / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
        }),
      ]),
    );
  });

  it('encodes patient id only in foundation action href path segments and keeps DB identity raw', async () => {
    const patientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(patientId);
    const patientFindFirstMock = vi.fn().mockResolvedValue({
      ...buildOverviewPatient(),
      scheduling_preference: {
        preferred_contact_name: '長女',
        preferred_contact_phone: '090-0000-0000',
        parking_available: true,
        care_level: '要介護2',
      },
      contacts: [
        {
          is_primary: false,
          is_emergency_contact: true,
          phone: '090-9999-0000',
          email: null,
          fax: null,
        },
      ],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          care_team_links: [
            { role: 'physician', phone: '03-1111-2222', email: null, fax: '03-1111-2223' },
            { role: 'visiting_nurse', phone: '03-2222-3333', email: null, fax: '03-2222-3334' },
            { role: 'care_manager', phone: '03-3333-4444', email: null, fax: null },
          ],
        },
      ],
    });
    const patientInsuranceFindManyMock = vi.fn().mockResolvedValue([]);
    const patientFieldRevisionFindManyMock = vi.fn().mockResolvedValue([]);
    const visitRecordFindManyMock = vi.fn().mockResolvedValue([]);
    const visitScheduleFindFirstMock = vi.fn().mockResolvedValue(null);
    const db = buildDb({
      patient: {
        findFirst: patientFindFirstMock,
      },
      patientInsurance: {
        findMany: patientInsuranceFindManyMock,
      },
      patientFieldRevision: {
        findMany: patientFieldRevisionFindManyMock,
      },
      visitRecord: {
        findMany: visitRecordFindManyMock,
      },
      visitSchedule: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: visitScheduleFindFirstMock,
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId,
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: patientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: patientId,
        }),
      }),
    );
    expect(patientFieldRevisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: patientId,
        }),
      }),
    );
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: patientId,
        }),
      }),
    );
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_: { patient_id: patientId },
        }),
      }),
    );

    expect(result?.foundation.items.map((item) => [item.key, item.action_href])).toEqual([
      ['contact', `/patients/${encodedPatientId}/edit?section=visit#intake.contact_phone`],
      ['parking', `/patients/${encodedPatientId}/edit?section=visit#intake.parking_available`],
      ['care_level', `/patients/${encodedPatientId}/edit?section=care#intake.care_level`],
      [
        'care_team_reliability',
        `/patients/${encodedPatientId}/edit?section=team#intake.care_manager.name`,
      ],
      ['insurance', `/patients/${encodedPatientId}/edit?section=contact#medical_insurance_number`],
      ['medication_risk', `/patients/${encodedPatientId}/safety-check`],
      ['visit_preparation', `/patients/${encodedPatientId}`],
      ['labs', `/patients/${encodedPatientId}/safety-check`],
    ]);
    expect(JSON.stringify(result?.foundation.items)).not.toContain(`/patients/${patientId}`);
  });
});

describe('getPatientVisitsData', () => {
  it('scopes visit schedules, counts, and records to the assigned case ids', async () => {
    const visitScheduleFindManyMock = vi.fn().mockResolvedValue([{ id: 'schedule_1' }]);
    const visitScheduleCountMock = vi.fn().mockResolvedValue(2);
    const visitRecordFindManyMock = vi.fn().mockResolvedValue([{ id: 'record_1' }]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: visitScheduleFindManyMock,
        count: visitScheduleCountMock,
      },
      visitRecord: {
        findMany: visitRecordFindManyMock,
      },
    });

    const result = await getPatientVisitsData(
      db as unknown as Parameters<typeof getPatientVisitsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result).toEqual({
      monthly_visit_count: 2,
      visit_schedules: [{ id: 'schedule_1' }],
      visit_records: [{ id: 'record_1' }],
      home_care_feature_summary: {
        states: [],
        highlights: [],
      },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
          scheduled_date: {
            gte: expect.any(Date),
            lt: expect.any(Date),
          },
        }),
      }),
    );
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          schedule: {
            case_id: { in: ['case_1'] },
          },
        }),
      }),
    );
  });

  it('skips visit fan-out queries when the patient has no assigned cases', async () => {
    const visitScheduleFindManyMock = vi.fn();
    const visitScheduleCountMock = vi.fn();
    const visitRecordFindManyMock = vi.fn();
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [],
        }),
      },
      visitSchedule: {
        findMany: visitScheduleFindManyMock,
        count: visitScheduleCountMock,
      },
      visitRecord: {
        findMany: visitRecordFindManyMock,
      },
    });

    const result = await getPatientVisitsData(
      db as unknown as Parameters<typeof getPatientVisitsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result).toMatchObject({
      monthly_visit_count: 0,
      visit_schedules: [],
      visit_records: [],
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
  });
});

describe('getPatientWorkflowPreviewData', () => {
  it('prefers care-team report targets, falls back to intake targets, and surfaces blockers', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          contacts: [],
          scheduling_preference: {
            preferred_weekdays: [],
            preferred_time_from: null,
            preferred_time_to: null,
            phone_contact_from: null,
            phone_contact_to: null,
            facility_time_from: null,
            facility_time_to: null,
            family_presence_required: false,
            visit_buffer_minutes: null,
            preferred_contact_name: null,
            preferred_contact_phone: null,
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: null,
            first_visit_time_note: null,
            parking_available: null,
            primary_contact_preference: 'mcs',
            mcs_linked: true,
            adl_level: null,
            dementia_level: null,
            swallowing_route: null,
            care_level: null,
            infection_isolation: null,
            notes: null,
          },
          consents: [],
          mcs_link: null,
          cases: [
            {
              id: 'case_1',
              status: 'active',
              required_visit_support: {
                home_visit_intake: {
                  requester: {
                    profession: 'physician',
                    contact_name: '依頼医',
                    organization_name: '依頼医院',
                    phone: '03-1111-2222',
                    preferred_contact_method: 'mcs',
                    pharmacy_decision_due_date: '2026-04-09',
                  },
                  care_manager: {
                    name: '居宅CM',
                    organization_name: '居宅介護',
                    phone: '03-3333-4444',
                  },
                  visiting_nurse: {
                    name: '訪問看護師',
                    organization_name: '訪問看護ST',
                    phone: '03-5555-6666',
                  },
                  primary_disease: '心不全',
                  care_level: 'care_3',
                  visit_before_contact_required: true,
                  mcs_linked: true,
                },
              },
              care_team_links: [
                {
                  id: 'link_physician',
                  role: 'doctor',
                  name: '主治医',
                  organization_name: '主治医クリニック',
                  phone: '03-9999-0000',
                  email: null,
                  fax: null,
                  is_primary: true,
                },
              ],
              management_plans: [],
            },
          ],
        }),
      },
    });

    const result = await getPatientWorkflowPreviewData(
      db as unknown as Parameters<typeof getPatientWorkflowPreviewData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.report_targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'physician_report',
          source: 'care_team',
          recipient_name: '主治医',
        }),
        expect.objectContaining({
          key: 'care_manager_report',
          source: 'intake',
          recipient_name: '居宅CM',
        }),
        expect.objectContaining({
          key: 'nurse_share',
          source: 'intake',
          recipient_name: '訪問看護師',
        }),
      ]),
    );
    expect(result?.visit_preparation.blockers).toEqual(
      expect.arrayContaining([
        '訪問薬剤管理同意が未取得です。',
        '緊急連絡先が未登録です。',
        '承認済み管理計画書がありません。',
        '訪問前連絡が必要ですが連絡先電話が不足しています。',
      ]),
    );
    expect(result?.communication_priority).toMatchObject({
      preferred_contact_method: 'mcs',
      effective_channel: 'collaboration',
      visit_before_contact_required: true,
      pharmacy_decision_due_date: '2026-04-09T00:00:00.000Z',
      warnings: expect.arrayContaining([
        '患者・家族への事前連絡を優先します。',
        'MCS連携フラグはありますが連携先 URL が未登録です。',
      ]),
    });
  });
});

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
      userId: 'user_1',
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
      userId: 'user_1',
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
          residences: [
            { address: '東京都千代田区1-1-1', facility_id: null, building_id: '山田家' },
          ],
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
              care_team_links: [{ role: 'doctor' }, { role: 'visiting_nurse' }, { role: 'cm' }],
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
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      applicable: true,
      overall_status: 'ready',
      completed_count: 11,
      total_count: 11,
    });
  });
});

describe('getPatientTimelineData', () => {
  it('sorts mixed timeline events and preserves representative event DTO fields', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'urgent',
            pharmacist_id: 'pharmacist_1',
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: 2,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: {
              id: 'visit_record_1',
              outcome_status: 'completed',
            },
          },
        ]),
      },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'billing_payment_profile_updated',
            target_type: 'Patient',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: {
              payer_name: '山田花子',
              payment_method: 'bank_transfer',
            },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'communication_1',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: '服薬時間を相談',
            counterpart_name: '長女',
            occurred_at: new Date('2026-04-04T10:00:00.000Z'),
          },
        ]),
      },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'operation_history:audit_1',
      'communication:communication_1',
      'visit_schedule:schedule_1',
      'care_report:report_1',
    ]);
    expect(result?.timeline_events[0]).toMatchObject({
      id: 'operation_history:audit_1',
      event_type: 'operation_history',
      category: 'billing',
      occurred_at: new Date('2026-04-05T11:00:00.000Z'),
      title: '支払設定を更新',
      summary: '支払者 山田花子 / 方法 振込',
      href: '/billing/candidates?patient_id=patient_1',
      action_label: '請求を開く',
      status: 'billing_payment_profile_updated',
      status_label: '支払設定',
      metadata: ['Patient', 'patient_1'],
    });
    expect(result?.timeline_events[2]).toMatchObject({
      id: 'visit_schedule:schedule_1',
      event_type: 'visit_schedule',
      category: 'visit',
      occurred_at: new Date('2026-04-03T09:00:00.000Z'),
      title: '訪問予定を確定',
      summary: '定期訪問 / 訪問日 2026/04/10 / 訪問記録あり',
      href: '/visits/visit_record_1',
      action_label: '訪問記録を開く',
      status: 'confirmed',
      status_label: 'confirmed',
      metadata: ['優先度 至急', 'ルート順 2'],
    });
  });

  it('encodes timeline care report hrefs while preserving raw report identities', async () => {
    const rawReportId = 'report/../x?download=1#frag';
    const rawDeliveryId = 'delivery/1?channel=fax#frag';
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawReportId,
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [
              {
                id: rawDeliveryId,
                channel: 'fax',
                recipient_name: '主治医',
                status: 'sent',
                confirmed_at: null,
                sent_at: new Date('2026-04-03T10:00:00.000Z'),
                created_at: new Date('2026-04-03T09:00:00.000Z'),
              },
            ],
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    const encodedReportHref = `/reports/${encodeURIComponent(rawReportId)}`;
    expect(eventsById.get(`care_report:${rawReportId}`)?.href).toBe(encodedReportHref);
    expect(eventsById.get(`delivery_record:${rawDeliveryId}`)?.href).toBe(encodedReportHref);
    expect(eventsById.has(`care_report:${rawReportId}`)).toBe(true);
    expect(eventsById.has(`delivery_record:${rawDeliveryId}`)).toBe(true);
    expect(JSON.stringify(result?.timeline_events)).not.toContain(`/reports/${rawReportId}`);
  });

  it('encodes timeline visit and prescription hrefs while preserving raw identities', async () => {
    const rawScheduleWithRecordId = 'schedule/with-record?mode=x#frag';
    const rawScheduleRecordId = 'visit-record/from-schedule?mode=x#frag';
    const rawScheduleWithoutRecordId = 'schedule/no-record?mode=entry#frag';
    const rawVisitRecordId = 'visit-record/direct?mode=x#frag';
    const rawPrescriptionIntakeId = 'intake/direct?tab=x#frag';
    const rawDispenseResultId = 'dispense/1?tab=x#frag';
    const rawDispenseIntakeId = 'intake/dispense?tab=x#frag';
    const rawInquiryId = 'inquiry/1?tab=x#frag';
    const rawInquiryIntakeId = 'intake/inquiry?tab=x#frag';
    const rawInquiryWithoutIntakeId = 'inquiry/no-intake?tab=x#frag';
    const rawAuditId = 'audit/prescription?tab=x#frag';
    const rawAuditPrescriptionId = 'intake/audit?tab=x#frag';
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawScheduleWithRecordId,
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: null,
            pharmacist_id: 'user_1',
            confirmed_at: new Date('2026-04-09T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-08T09:00:00.000Z'),
            updated_at: null,
            visit_record: { id: rawScheduleRecordId, outcome_status: 'completed' },
          },
          {
            id: rawScheduleWithoutRecordId,
            visit_type: 'temporary',
            scheduled_date: new Date('2026-04-11T00:00:00.000Z'),
            schedule_status: 'planned',
            priority: null,
            pharmacist_id: 'user_1',
            confirmed_at: null,
            route_order: null,
            created_at: new Date('2026-04-08T10:00:00.000Z'),
            updated_at: null,
            visit_record: null,
          },
        ]),
      },
      visitRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawVisitRecordId,
            pharmacist_id: 'user_1',
            visit_date: new Date('2026-04-12T00:00:00.000Z'),
            outcome_status: 'completed',
            next_visit_suggestion_date: null,
            cancellation_reason: null,
            postpone_reason: null,
            revisit_reason: null,
            created_at: new Date('2026-04-12T09:00:00.000Z'),
          },
        ]),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawPrescriptionIntakeId,
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [],
          },
        ]),
      },
      dispenseResult: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawDispenseResultId,
            actual_drug_name: 'テスト薬',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
            dispensed_by: 'user_1',
            dispensed_at: new Date('2026-04-02T09:00:00.000Z'),
            task: { cycle: { overall_status: 'dispensed' } },
            line: { intake: { id: rawDispenseIntakeId } },
          },
        ]),
      },
      inquiryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawInquiryId,
            reason: '用量確認',
            inquiry_to_physician: '山田医師',
            inquiry_content: '用量を確認しました。',
            result: 'unchanged',
            proposal_origin: 'post_inquiry',
            residual_adjustment: false,
            change_detail: null,
            inquired_at: new Date('2026-04-03T09:00:00.000Z'),
            resolved_at: null,
            created_at: new Date('2026-04-03T08:00:00.000Z'),
            line: { intake: { id: rawInquiryIntakeId } },
          },
          {
            id: rawInquiryWithoutIntakeId,
            reason: '受付未連携',
            inquiry_to_physician: null,
            inquiry_content: null,
            result: null,
            proposal_origin: null,
            residual_adjustment: null,
            change_detail: null,
            inquired_at: null,
            resolved_at: null,
            created_at: new Date('2026-04-03T07:00:00.000Z'),
            line: null,
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawAuditId,
            action: 'prescription_original_management_updated',
            target_type: 'prescription_intake',
            target_id: rawAuditPrescriptionId,
            actor_id: 'user_1',
            changes: { storage_location: 'paper' },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    expect(eventsById.get(`visit_schedule:${rawScheduleWithRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawScheduleRecordId)}`,
    );
    expect(eventsById.get(`visit_schedule:${rawScheduleWithoutRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawScheduleWithoutRecordId)}/record`,
    );
    expect(eventsById.get(`visit_record:${rawVisitRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawVisitRecordId)}`,
    );
    expect(eventsById.get(`prescription_intake:${rawPrescriptionIntakeId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawPrescriptionIntakeId)}`,
    );
    expect(eventsById.get(`dispense_result:${rawDispenseResultId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawDispenseIntakeId)}`,
    );
    expect(eventsById.get(`inquiry:${rawInquiryId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawInquiryIntakeId)}`,
    );
    expect(eventsById.get(`inquiry:${rawInquiryWithoutIntakeId}`)?.href).toBe('/workflow');
    expect(eventsById.get(`operation_history:${rawAuditId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawAuditPrescriptionId)}`,
    );
    for (const eventId of [
      `visit_schedule:${rawScheduleWithRecordId}`,
      `visit_schedule:${rawScheduleWithoutRecordId}`,
      `visit_record:${rawVisitRecordId}`,
      `prescription_intake:${rawPrescriptionIntakeId}`,
      `dispense_result:${rawDispenseResultId}`,
      `inquiry:${rawInquiryId}`,
      `inquiry:${rawInquiryWithoutIntakeId}`,
      `operation_history:${rawAuditId}`,
    ]) {
      expect(eventsById.has(eventId)).toBe(true);
    }
    const serializedEvents = JSON.stringify(result?.timeline_events);
    for (const rawVisitId of [rawScheduleRecordId, rawScheduleWithoutRecordId, rawVisitRecordId]) {
      expect(serializedEvents).not.toContain(`/visits/${rawVisitId}`);
    }
    for (const rawPrescriptionId of [
      rawPrescriptionIntakeId,
      rawDispenseIntakeId,
      rawInquiryIntakeId,
      rawAuditPrescriptionId,
    ]) {
      expect(serializedEvents).not.toContain(`/prescriptions/${rawPrescriptionId}`);
    }
  });

  it.each(['.', '..'])('rejects exact dot-segment timeline report id %s', async (reportId) => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: reportId,
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
    });

    await expect(
      getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).rejects.toThrow(RangeError);
  });

  const dotSegmentTimelineHrefCases: Array<
    [string, (dotSegment: string) => Record<string, unknown>]
  > = [
    [
      'visit schedule linked visit record',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              visit_type: 'regular',
              scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
              schedule_status: 'confirmed',
              priority: null,
              pharmacist_id: 'user_1',
              confirmed_at: new Date('2026-04-09T09:00:00.000Z'),
              route_order: null,
              created_at: new Date('2026-04-08T09:00:00.000Z'),
              updated_at: null,
              visit_record: { id: dotSegment, outcome_status: 'completed' },
            },
          ]),
        },
      }),
    ],
    [
      'visit schedule record entry',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              visit_type: 'regular',
              scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
              schedule_status: 'planned',
              priority: null,
              pharmacist_id: 'user_1',
              confirmed_at: null,
              route_order: null,
              created_at: new Date('2026-04-08T09:00:00.000Z'),
              updated_at: null,
              visit_record: null,
            },
          ]),
        },
      }),
    ],
    [
      'visit record',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              pharmacist_id: 'user_1',
              visit_date: new Date('2026-04-12T00:00:00.000Z'),
              outcome_status: 'completed',
              next_visit_suggestion_date: null,
              cancellation_reason: null,
              postpone_reason: null,
              revisit_reason: null,
              created_at: new Date('2026-04-12T09:00:00.000Z'),
            },
          ]),
        },
      }),
    ],
    [
      'prescription intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        prescriptionIntake: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              source_type: 'fax',
              prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
              prescriber_name: '山田医師',
              prescriber_institution: '山田内科',
              original_collected_by: null,
              created_at: new Date('2026-04-01T09:00:00.000Z'),
              cycle: { overall_status: 'intake_received' },
              lines: [],
            },
          ]),
        },
      }),
    ],
    [
      'dispense result intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'dispense_1',
              actual_drug_name: 'テスト薬',
              actual_quantity: 14,
              actual_unit: '錠',
              carry_type: 'carry',
              dispensed_by: 'user_1',
              dispensed_at: new Date('2026-04-02T09:00:00.000Z'),
              task: { cycle: { overall_status: 'dispensed' } },
              line: { intake: { id: dotSegment } },
            },
          ]),
        },
      }),
    ],
    [
      'inquiry intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        inquiryRecord: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'inquiry_1',
              reason: '用量確認',
              inquiry_to_physician: '山田医師',
              inquiry_content: '用量を確認しました。',
              result: 'unchanged',
              proposal_origin: 'post_inquiry',
              residual_adjustment: false,
              change_detail: null,
              inquired_at: new Date('2026-04-03T09:00:00.000Z'),
              resolved_at: null,
              created_at: new Date('2026-04-03T08:00:00.000Z'),
              line: { intake: { id: dotSegment } },
            },
          ]),
        },
      }),
    ],
    [
      'prescription operation history target',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        auditLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'audit_prescription_1',
              action: 'prescription_original_management_updated',
              target_type: 'prescription_intake',
              target_id: dotSegment,
              actor_id: 'user_1',
              changes: { storage_location: 'paper' },
              created_at: new Date('2026-04-05T11:00:00.000Z'),
            },
          ]),
        },
      }),
    ],
  ];

  it.each(
    dotSegmentTimelineHrefCases.flatMap(([sourceName, buildOverrides]) =>
      ['.', '..'].map((dotSegment) => [sourceName, dotSegment, buildOverrides] as const),
    ),
  )(
    'rejects exact dot-segment timeline href id from %s: %s',
    async (_sourceName, dotSegment, buildOverrides) => {
      const db = buildDb(buildOverrides(dotSegment));

      await expect(
        getPatientTimelineData(runnerFor(db), {
          orgId: 'org_1',
          patientId: 'patient_1',
          role: 'pharmacist',
          userId: 'user_1',
        }),
      ).rejects.toThrow(RangeError);
    },
  );

  it('encodes timeline patient hrefs while preserving raw patient identity queries', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(rawPatientId);
    const encodedPatientQuery = `patient_id=${encodedPatientId}`;
    const patientFindFirstMock = vi.fn().mockResolvedValue({
      id: rawPatientId,
      cases: [{ id: 'case_1' }],
    });
    const externalAccessGrantFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'grant_1',
        granted_to_name: '田中ケアマネ',
        expires_at: new Date('2026-04-30T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-08T00:00:00.000Z'),
      },
    ]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_billing_1',
        action: 'billing_payment_profile_updated',
        target_type: 'Patient',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { payer_name: '山田花子', payment_method: 'cash' },
        created_at: new Date('2026-04-10T10:00:00.000Z'),
      },
      {
        id: 'audit_mcs_1',
        action: 'patient_mcs_profile_updated',
        target_type: 'Patient',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { mcs_enabled: true },
        created_at: new Date('2026-04-10T09:00:00.000Z'),
      },
      {
        id: 'audit_patient_export_1',
        action: 'export',
        target_type: 'medication_history',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { format: 'csv' },
        created_at: new Date('2026-04-10T08:00:00.000Z'),
      },
      {
        id: 'audit_conference_1',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_1',
        actor_id: 'user_1',
        changes: { title: '退院前カンファレンス' },
        created_at: new Date('2026-04-10T07:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: patientFindFirstMock,
      },
      managementPlan: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'plan_1',
            status: 'approved',
            title: '訪問薬剤管理指導計画書',
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            next_review_date: null,
            created_by: 'user_1',
            approved_by: null,
            approved_at: null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: new Date('2026-04-09T00:00:00.000Z'),
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-08T10:00:00.000Z'),
          },
        ]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conference_1',
            note_type: 'discharge_conference',
            title: '退院前カンファレンス',
            conference_date: new Date('2026-04-08T09:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            action_items: [],
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-04-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            exclusion_reason: null,
            updated_at: new Date('2026-04-08T08:00:00.000Z'),
          },
        ]),
      },
      medicationCycle: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'communication_1',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: '服薬時間を相談',
            counterpart_name: '長女',
            occurred_at: new Date('2026-04-07T10:00:00.000Z'),
          },
        ]),
      },
      patientSelfReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'self_report_1',
            subject: '夕方にふらつきあり',
            category: '副作用・体調変化',
            content: '夕方にふらつきます。',
            relation: '本人',
            status: 'submitted',
            reported_by_name: '山田花子',
            requested_callback: true,
            preferred_contact_time: '18:00以降',
            created_at: new Date('2026-04-07T09:00:00.000Z'),
          },
        ]),
      },
      externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: rawPatientId,
      role: 'pharmacist',
      userId: 'user_1',
    });

    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    expect(eventsById.get('management_plan:plan_1')?.href).toBe(
      `/patients/${encodedPatientId}/management-plan`,
    );
    expect(eventsById.get('first_visit_document:doc_1')?.href).toBe(
      `/patients/${encodedPatientId}#patient-documents`,
    );
    expect(eventsById.get('operation_history:audit_mcs_1')?.href).toBe(
      `/patients/${encodedPatientId}/mcs`,
    );
    expect(eventsById.get('operation_history:audit_patient_export_1')?.href).toBe(
      `/patients/${encodedPatientId}`,
    );
    expect(eventsById.get('self_report:self_report_1')?.href).toBe(
      `/patients/${encodedPatientId}/collaboration`,
    );
    expect(eventsById.get('external_share:grant_1')?.href).toBe(
      `/patients/${encodedPatientId}/share`,
    );
    expect(eventsById.get('conference_note:conference_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_billing_1')?.href).toBe(
      `/billing/candidates?${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_conference_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('communication:communication_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('billing_candidate:candidate_1')?.href).toBe(
      `/billing/candidates?billing_month=2026-04-01&${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_patient_export_1')?.metadata).toEqual([
      'medication_history',
      rawPatientId,
    ]);
    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: rawPatientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: rawPatientId,
        }),
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: rawPatientId,
            }),
            expect.objectContaining({
              target_type: {
                in: [
                  'medication_history',
                  'medication_calendar',
                  'visit_record_list',
                  'prescription_history',
                ],
              },
              target_id: rawPatientId,
            }),
          ]),
        }),
      }),
    );
  });

  it('summarizes billing collection history with bill, payment, receipt, invoice, and unpaid evidence', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_collection_1',
            action: 'billing_collection_updated',
            target_type: 'BillingCandidate',
            target_id: 'candidate_1',
            actor_id: 'user_2',
            changes: {
              status_before: 'candidate',
              collection: {
                status: 'partial',
                billed_amount: 3240,
                collected_amount: 2160,
                unpaid_amount: 1080,
                payment_method: 'cash',
                payer_name: '山田花子',
                collected_at: '2026-06-16T10:30:00.000Z',
                receipt_number: 'R20260616-001',
                receipt_issue_status: 'issued',
                invoice_issue_status: 'issued',
                unpaid_reason: '次回訪問時に残額集金',
              },
            },
            created_at: new Date('2026-06-16T11:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const collectionEvent = result?.timeline_events.find(
      (item) => item.id === 'operation_history:audit_collection_1',
    );

    expect(collectionEvent).toMatchObject({
      event_type: 'operation_history',
      category: 'billing',
      title: '集金情報を更新',
      summary:
        '状態 一部入金 / 請求 3,240円 / 入金 2,160円 / 未収 1,080円 / 入金日 2026/06/16 / 入金方法 現金 / 領収証 R20260616-001 / 領収証状態 発行済み / 請求書状態 発行済み / 支払者 山田花子 / 未収理由 次回訪問時に残額集金',
      href: '/billing/candidates?patient_id=patient_1',
      action_label: '請求を開く',
      status: 'billing_collection_updated',
      status_label: '集金更新',
    });
  });

  it('adds generated billing document PDF exports to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_billing_pdf_1',
        action: 'export',
        target_type: 'billing_invoice',
        target_id: 'candidate_1',
        actor_id: 'user_2',
        changes: {
          format: 'pdf',
          record_count: 1,
          filters: {},
          metadata: {},
        },
        created_at: new Date('2026-06-16T12:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'confirmed',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '鈴木 事務' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_billing_pdf_1',
          event_type: 'operation_history',
          category: 'billing',
          title: '請求書PDFを出力',
          summary: 'PDF / 1件',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求を開く',
          status: 'export',
          status_label: '請求書PDF',
          actor_name: '鈴木 事務',
          metadata: ['billing_invoice', 'candidate_1'],
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: { in: ['billing_receipt', 'billing_invoice'] },
              target_id: { in: ['candidate_1'] },
              action: 'export',
            }),
          ]),
        }),
      }),
    );
  });

  it('adds patient-level document exports to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_patient_export_1',
        action: 'export',
        target_type: 'medication_calendar',
        target_id: 'patient_1',
        actor_id: 'user_2',
        changes: {
          format: 'pdf',
          record_count: 1,
          filters: {
            month: '2026-06',
          },
          metadata: {},
        },
        created_at: new Date('2026-06-16T13:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '鈴木 事務' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_patient_export_1',
          event_type: 'operation_history',
          category: 'document',
          title: '服薬カレンダーPDFを出力',
          summary: 'PDF / 1件 / 対象月 2026-06',
          href: '/patients/patient_1',
          action_label: '患者詳細を開く',
          status: 'export',
          status_label: '服薬カレンダー',
          actor_name: '鈴木 事務',
          metadata: ['medication_calendar', 'patient_1'],
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: {
                in: [
                  'medication_history',
                  'medication_calendar',
                  'visit_record_list',
                  'prescription_history',
                ],
              },
              target_id: 'patient_1',
              action: 'export',
            }),
          ]),
        }),
      }),
    );
  });

  it('uses first visit document audit details for document timeline identity', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_doc_1',
            action: 'first_visit_document.generated',
            target_type: 'first_visit_document',
            target_id: 'doc_1',
            actor_id: 'user_1',
            changes: {
              document_action: {
                action: 'generated',
                document_type: 'important_matters',
                template_name: '重要事項説明書 2026年版',
                template_version: 'v2',
                storage_location: 'store',
                note: '患者詳細から作成',
              },
            },
            created_at: new Date('2026-04-02T10:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'first_visit_document:doc_1',
          event_type: 'first_visit_document',
          category: 'document',
          occurred_at: new Date('2026-04-02T10:00:00.000Z'),
          title: '重要事項説明書を作成',
          summary: '重要事項説明書 2026年版 / 版 v2 / 交付未記録 / 保管 店舗 / 患者詳細から作成',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態を開く',
          status: 'generated',
          status_label: '作成',
          actor_name: '佐藤 薬剤師',
          metadata: ['重要事項説明書'],
        }),
      ]),
    );
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'first_visit_document',
              target_id: { in: ['doc_1'] },
              action: { startsWith: 'first_visit_document.' },
            }),
          ]),
        }),
      }),
    );
  });

  it('renders operation history summaries with pharmacy workflow labels', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'intake_1',
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [{ id: 'line_1' }],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_prescription_1',
            action: 'prescription_original_management_updated',
            target_type: 'prescription_intake',
            target_id: 'intake_1',
            actor_id: 'user_1',
            changes: {
              reconciliation_result: 'discrepancy',
              storage_location: 'electronic',
              e_prescription_acquired_status: 'acquired',
              e_prescription_exchange_number: 'EP-12345',
              dispensing_result_registration: 'registered',
            },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_prescription_1',
          event_type: 'operation_history',
          category: 'prescription',
          title: '処方せん原本管理を更新',
          summary:
            '照合 差異あり / 保管 電子保管 / 電子処方箋 取得済み / 引換番号 EP-12345 / 調剤結果 登録済み',
          href: '/prescriptions/intake_1',
          action_label: '処方受付を開く',
          status_label: '原本管理',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
  });

  it('adds prescription original document retention audits to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_rx_doc_1',
        action: 'prescription_original_document_saved',
        target_type: 'prescription_intake',
        target_id: 'intake_1',
        actor_id: 'user_1',
        changes: {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url_type: 'internal_file',
          file_id: '11111111-1111-4111-8111-111111111111',
          saved_at: '2026-04-05T11:00:00.000Z',
          updated_by: 'user_1',
        },
        created_at: new Date('2026-04-05T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'intake_1',
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [{ id: 'line_1' }],
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_rx_doc_1',
          event_type: 'operation_history',
          category: 'prescription',
          title: '処方せん画像/PDFを保存',
          summary: 'ファイル 11111111-1111-4111-8111-111111111111 / 保存先 PH-OSファイル',
          href: '/prescriptions/intake_1',
          action_label: '処方受付を開く',
          status: 'prescription_original_document_saved',
          status_label: '画像保存',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'prescription_intake',
              target_id: { in: ['intake_1'] },
              action: expect.objectContaining({
                in: expect.arrayContaining(['prescription_original_document_saved']),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('adds MCS check logs to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_mcs_1',
        action: 'patient_mcs_check_log_created',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          content_type: 'instruction_check',
          summary: '訪看から食欲低下の共有を確認',
          next_action: '医師へ服薬状況を確認',
          occurred_at: '2026-06-16T00:00:00.000Z',
          communication_event_id: 'event_1',
        },
        created_at: new Date('2026-06-16T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_mcs_1',
          event_type: 'operation_history',
          category: 'communication',
          title: 'MCS確認ログを登録',
          summary: '指示確認 / 訪看から食欲低下の共有を確認 / 次 医師へ服薬状況を確認',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を開く',
          status: 'patient_mcs_check_log_created',
          status_label: 'MCS確認',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: 'patient_1',
              action: {
                in: expect.arrayContaining(['patient_mcs_check_log_created']),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('adds patient contact updates to the operation timeline without contact PHI exposure', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_contacts_1',
        action: 'patient_contacts_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          contact_count: 2,
          contact_name: '長男',
          phone: '090-1111-1111',
          email: 'family@example.com',
          address: '東京都千代田区1-2-3',
        },
        created_at: new Date('2026-06-17T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_contacts_1',
          event_type: 'operation_history',
          category: 'communication',
          title: '連絡先を更新',
          summary: '連絡先 2件',
          href: '/patients/patient_1',
          action_label: '患者詳細を開く',
          status: 'patient_contacts_updated',
          status_label: '連絡先更新',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    const timelineJson = JSON.stringify(result?.timeline_events);
    expect(timelineJson).not.toMatch(/長男|090-1111-1111|family@example.com|東京都千代田区/);
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: 'patient_1',
              action: {
                in: expect.arrayContaining(['patient_contacts_updated']),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('adds conference operation audits to the patient timeline without note body exposure', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_conference_1',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_1',
        actor_id: 'user_1',
        changes: {
          conference_note: {
            note_type: 'service_manager',
            report_type: 'care_manager_report',
            follow_up_date: '2026-04-06T00:00:00.000Z',
            follow_up_completed: false,
            action_item_count: 2,
            billing_code: 'MED_INFO_PROVISION_2_HA',
          },
        },
        created_at: new Date('2026-04-05T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conference_1',
            note_type: 'service_manager',
            title: '山田 太郎様 サービス担当者会議',
            conference_date: new Date('2026-04-05T10:00:00.000Z'),
            follow_up_date: new Date('2026-04-06T00:00:00.000Z'),
            follow_up_completed: false,
            generated_report_id: null,
            action_items: [{ title: '報告書作成' }, { title: '次回訪問調整' }],
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_conference_1',
          event_type: 'operation_history',
          category: 'communication',
          title: 'カンファレンス記録を登録',
          summary:
            '担当者会議 / 報告用途 ケアマネ向け / フォロー期限 2026/04/06 / フォロー 未完了 / 薬局タスク 2件 / 算定 MED_INFO_PROVISION_2_HA',
          href: '/conferences?patient_id=patient_1',
          action_label: '会議を開く',
          status: 'conference_note.created',
          status_label: '会議登録',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    expect(JSON.stringify(result?.timeline_events)).not.toContain('退院後の服薬支援本文');
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'conference_note',
              target_id: { in: ['conference_1'] },
              action: { startsWith: 'conference_note.' },
            }),
          ]),
        }),
      }),
    );
  });

  it('scopes conference notes to patient-level notes or assigned cases', async () => {
    const conferenceNoteFindManyMock = vi.fn().mockResolvedValue([]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: conferenceNoteFindManyMock },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ patient_id: 'patient_1', case_id: null }, { case_id: { in: ['case_1'] } }],
        }),
      }),
    );
  });

  it('keeps patient-level conference notes in the timeline when the patient has no cases', async () => {
    const conferenceNoteFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'conference_patient_level',
        note_type: 'service_manager',
        title: 'ケース作成前の担当者会議',
        conference_date: new Date('2026-04-08T10:00:00.000Z'),
        follow_up_date: null,
        follow_up_completed: true,
        generated_report_id: null,
        action_items: [],
      },
    ]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_conference_patient_level',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_patient_level',
        actor_id: 'user_2',
        changes: { conference_note: { note_type: 'service_manager' } },
        created_at: new Date('2026-04-08T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [],
        }),
      },
      conferenceNote: { findMany: conferenceNoteFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [{ patient_id: 'patient_1', case_id: null }],
        },
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'conference_note',
              target_id: { in: ['conference_patient_level'] },
            }),
          ]),
        }),
      }),
    );
    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'conference_note:conference_patient_level',
          event_type: 'conference_note',
        }),
        expect.objectContaining({
          id: 'operation_history:audit_conference_patient_level',
          title: 'カンファレンス記録を登録',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
  });

  it('omits billing candidates and billing operation history for non-billing roles', async () => {
    const billingCandidateFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'candidate_1',
        status: 'candidate',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'HOME_VISIT_MANAGEMENT',
        billing_name: '居宅療養管理指導',
        points: 518,
        exclusion_reason: null,
        updated_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    const medicationCycleFindManyMock = vi.fn().mockResolvedValue([{ id: 'cycle_1' }]);
    const auditLogFindManyMock = vi.fn().mockImplementation((args) =>
      JSON.stringify(args).includes('billing_payment_profile_updated')
        ? Promise.resolve([
            {
              id: 'audit_billing_profile',
              action: 'billing_payment_profile_updated',
              target_type: 'Patient',
              target_id: 'patient_1',
              actor_id: 'billing_user',
              changes: {
                payer_name: '山田花子',
                payment_method: 'bank_transfer',
                collection: { receipt_number: 'R-001', unpaid_reason: '次回訪問時に集金' },
              },
              created_at: new Date('2026-06-01T01:00:00.000Z'),
            },
          ])
        : Promise.resolve([]),
    );
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: { findMany: billingCandidateFindManyMock },
      medicationCycle: {
        findMany: medicationCycleFindManyMock,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      auditLog: { findMany: auditLogFindManyMock },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist_trainee',
      userId: 'user_1',
    });

    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(JSON.stringify(auditLogFindManyMock.mock.calls[0]?.[0])).not.toContain(
      'billing_payment_profile_updated',
    );
    expect(JSON.stringify(result?.timeline_events)).not.toContain('居宅療養管理指導');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('/billing/candidates');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('山田花子');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('R-001');
  });

  it('filters timeline external shares by assigned case boundary', async () => {
    const externalAccessGrantFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'grant_visible',
        granted_to_name: '田中ケアマネ',
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual([
      expect.objectContaining({
        id: 'external_share:grant_visible',
      }),
    ]);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          revoked_at: null,
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case_1'] } },
              ]),
            }),
          ]),
        }),
        take: 8,
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('grant_hidden');
  });

  it('adds self reports to timeline and avoids duplicate self-report communication events', async () => {
    const communicationEventFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'comm_self_report',
        event_type: 'patient_self_report',
        channel: 'phone',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T09:01:00.000Z'),
      },
      {
        id: 'comm_family_call',
        event_type: 'family_call',
        channel: 'phone',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T10:00:00.000Z'),
      },
      {
        id: 'comm_care_manager_fax',
        event_type: 'care_update',
        channel: 'fax',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T11:00:00.000Z'),
      },
      {
        id: 'comm_facility_email',
        event_type: 'care_update',
        channel: 'email',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T12:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: {
        findMany: communicationEventFindManyMock,
      },
      patientSelfReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'self_report_1',
            subject: '夕方にふらつきあり',
            category: '副作用・体調変化',
            content: '夕方になると立ち上がり時にふらつきます。折り返し連絡を希望します。',
            relation: '本人',
            status: 'submitted',
            reported_by_name: '山田花子',
            requested_callback: true,
            preferred_contact_time: '18:00以降',
            created_at: new Date('2026-04-03T09:00:00.000Z'),
          },
        ]),
      },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'self_report:self_report_1',
          event_type: 'self_report',
          title: '患者から自己申告を受信',
          status_label: '未対応',
          actor_name: '山田花子',
          metadata: expect.arrayContaining(['関係 本人', '折返し希望', '希望時間 18:00以降']),
        }),
        expect.objectContaining({
          id: 'communication:comm_family_call',
          event_type: 'inbound_phone',
          category: 'interprofessional',
          title: '電話連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          status_label: '受信',
          metadata: ['電話'],
        }),
        expect.objectContaining({
          id: 'communication:comm_care_manager_fax',
          event_type: 'inbound_fax',
          category: 'interprofessional',
          title: 'FAX連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          metadata: ['FAX'],
        }),
        expect.objectContaining({
          id: 'communication:comm_facility_email',
          event_type: 'inbound_email',
          category: 'interprofessional',
          title: 'メール連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          metadata: ['メール'],
        }),
      ]),
    );
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: { not: 'patient_self_report' },
        }),
        select: expect.not.objectContaining({
          subject: true,
          counterpart_name: true,
          counterpart_contact: true,
          content: true,
          attachments: true,
        }),
        take: 8,
      }),
    );
    expect(result?.timeline_events.map((item) => item.id)).not.toContain(
      'communication:comm_self_report',
    );
    expect(JSON.stringify(result?.movement_events)).not.toContain('服薬時間を相談');
    expect(JSON.stringify(result?.movement_events)).not.toContain('長女');
  });

  it('adds MCS and partner visit records to movement timeline without selecting raw message bodies', async () => {
    const patientMcsMessageFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'mcs_message_1',
        author_name: '訪問看護師A',
        author_role: '訪問看護師',
        author_organization: '訪問看護ステーション',
        posted_at: new Date('2026-04-04T09:00:00.000Z'),
        posted_at_label: '2026/04/04 18:00',
        reaction_count: 1,
        reply_count: 2,
        created_at: new Date('2026-04-04T09:01:00.000Z'),
      },
    ]);
    const partnerVisitRecordFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'partner_visit_record_1',
        status: 'confirmed',
        pharmacist_name: '協力薬局 薬剤師',
        visit_at: new Date('2026-04-03T01:00:00.000Z'),
        submitted_at: new Date('2026-04-03T03:00:00.000Z'),
        confirmed_at: new Date('2026-04-03T04:00:00.000Z'),
        updated_at: new Date('2026-04-03T04:00:00.000Z'),
        owner_partner_pharmacy: { name: '協力薬局' },
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      patientMcsMessage: {
        findMany: patientMcsMessageFindManyMock,
      },
      partnerVisitRecord: {
        findMany: partnerVisitRecordFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(patientMcsMessageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', patient_id: 'patient_1' },
        select: expect.not.objectContaining({
          body: true,
          raw_payload: true,
          source_url: true,
        }),
      }),
    );
    expect(partnerVisitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          share_case: { base_patient_id: 'patient_1' },
          status: { in: ['submitted', 'confirmed'] },
        }),
        select: expect.not.objectContaining({
          record_content: true,
          attachments: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'patient_mcs_message:mcs_message_1',
          event_type: 'inbound_mcs',
          category: 'interprofessional',
          title: 'MCS投稿を受信',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を開く',
          actor_name: '訪問看護師A',
          privacy_level: 'detail',
        }),
        expect.objectContaining({
          id: 'partner_visit_record:partner_visit_record_1',
          event_type: 'interprofessional_note',
          category: 'interprofessional',
          title: '協力薬局の訪問記録を確認',
          href: '/patients/patient_1/collaboration',
          action_label: '連携記録を開く',
          actor_name: '協力薬局 薬剤師',
          privacy_level: 'detail',
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('raw_payload');
    expect(serialized).not.toContain('source_url');
    expect(serialized).not.toContain('record_content');
    expect(serialized).not.toContain('SOAP');
  });

  it('adds patient and case operational tasks to movement timeline without selecting task free text', async () => {
    const taskFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'task_patient_1',
        task_type: 'patient_self_report_followup',
        status: 'pending',
        priority: 'high',
        due_date: new Date('2026-04-07T09:00:00.000Z'),
        sla_due_at: null,
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T10:00:00.000Z'),
        updated_at: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        id: 'task_case_1',
        task_type: 'risk_medication',
        status: 'completed',
        priority: 'urgent',
        due_date: null,
        sla_due_at: new Date('2026-04-05T09:00:00.000Z'),
        completed_at: new Date('2026-04-04T11:00:00.000Z'),
        related_entity_type: 'case',
        related_entity_id: 'case_1',
        created_at: new Date('2026-04-04T08:00:00.000Z'),
        updated_at: new Date('2026-04-04T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      task: {
        count: vi.fn().mockResolvedValue(2),
        findMany: taskFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            {
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
            },
            {
              related_entity_type: 'case',
              related_entity_id: { in: ['case_1'] },
            },
          ]),
        }),
        select: expect.not.objectContaining({
          title: true,
          description: true,
          metadata: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task:task_patient_1',
          event_type: 'task_created',
          category: 'task',
          title: '運用タスクを作成',
          href: '/tasks?status=&task_type=patient_self_report_followup&related_entity_type=patient&related_entity_id=patient_1',
          action_label: 'タスクを開く',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_case_1',
          event_type: 'task_resolved',
          category: 'task',
          title: '運用タスクを完了',
          href: '/tasks?status=&task_type=risk_medication&related_entity_type=case&related_entity_id=case_1',
          status: 'completed',
          status_label: '完了',
          privacy_level: 'summary',
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('患者名入りタスク本文');
    expect(serialized).not.toContain('description');
  });

  it('adds visit-derived residual medication events without selecting drug details or quantities', async () => {
    const visitRecordFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'visit_record_1',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-05T01:00:00.000Z'),
        outcome_status: 'completed',
        next_visit_suggestion_date: null,
        cancellation_reason: null,
        postpone_reason: null,
        revisit_reason: null,
        created_at: new Date('2026-04-05T01:30:00.000Z'),
      },
      {
        id: 'visit_record_2',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-01T01:00:00.000Z'),
        outcome_status: 'completed',
        next_visit_suggestion_date: null,
        cancellation_reason: null,
        postpone_reason: null,
        revisit_reason: null,
        created_at: new Date('2026-04-01T01:30:00.000Z'),
      },
    ]);
    const residualMedicationFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'residual_1',
        visit_record_id: 'visit_record_1',
        is_reduction_target: true,
        is_prohibited_reduction: false,
        created_at: new Date('2026-04-05T01:35:00.000Z'),
        drug_name: '患者に見せるべきではない薬剤名',
        remaining_quantity: 12,
      },
      {
        id: 'residual_2',
        visit_record_id: 'visit_record_1',
        is_reduction_target: false,
        is_prohibited_reduction: false,
        created_at: new Date('2026-04-05T01:34:00.000Z'),
        drug_name: '別の薬剤名',
        remaining_quantity: 6,
      },
      {
        id: 'residual_3',
        visit_record_id: 'visit_record_2',
        is_reduction_target: false,
        is_prohibited_reduction: true,
        created_at: new Date('2026-04-01T01:35:00.000Z'),
        drug_name: '麻薬名',
        remaining_quantity: 1,
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: visitRecordFindManyMock,
      },
      residualMedication: {
        findMany: residualMedicationFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(residualMedicationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          visit_record_id: { in: ['visit_record_1', 'visit_record_2'] },
        },
        select: expect.not.objectContaining({
          drug_name: true,
          remaining_quantity: true,
          prescribed_quantity: true,
          remaining_days: true,
          excess_days: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'residual_medication:visit_record_1',
          event_type: 'medication_stock_event',
          category: 'medication_stock',
          title: '残薬確認を記録',
          summary: '訪問記録に残薬確認が記録されました。内容は訪問記録で確認してください。',
          href: '/visits/visit_record_1',
          action_label: '訪問記録を開く',
          status: 'reduction_target',
          status_label: '減数検討',
          privacy_level: 'summary',
          metadata: ['残薬記録 2件', '完了'],
        }),
        expect.objectContaining({
          id: 'residual_medication:visit_record_2',
          event_type: 'medication_stock_event',
          status: 'prohibited_reduction',
          status_label: '減数不可',
          href: '/visits/visit_record_2',
          metadata: ['残薬記録 1件', '完了'],
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('患者に見せるべきではない薬剤名');
    expect(serialized).not.toContain('別の薬剤名');
    expect(serialized).not.toContain('麻薬名');
    expect(serialized).not.toContain('remaining_quantity');
  });

  it('bounds first-visit document timeline reads and keeps legacy audit filters visible', async () => {
    const firstVisitDocumentFindManyMock = vi.fn().mockResolvedValue([]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_legacy_export',
        action: 'export',
        target_type: 'medication_history',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          export: { target_type: 'medication_history' },
        },
        created_at: new Date('2026-04-05T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: { findMany: firstVisitDocumentFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: { in: ['case_1'] },
        }),
        orderBy: [{ created_at: 'desc' }],
        take: 8,
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              target_type: {
                in: [
                  'medication_history',
                  'medication_calendar',
                  'visit_record_list',
                  'prescription_history',
                ],
              },
              target_id: 'patient_1',
              action: 'export',
            },
          ]),
        }),
      }),
    );
    expect(JSON.stringify(auditLogFindManyMock.mock.calls[0]?.[0])).not.toContain('patient_id');
    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_legacy_export',
          metadata: ['medication_history', 'patient_1'],
        }),
      ]),
    );
  });

  it('renders available timeline sources when one source query fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'normal',
            pharmacist_id: null,
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: null,
          },
        ]),
      },
      communicationEvent: {
        findMany: vi.fn().mockRejectedValue(new Error('communication source unavailable')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'visit_schedule:schedule_1',
          }),
        ]),
      );
      expect(result?.partial_failures).toEqual([
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      expectPatientTimelineFailureLog(consoleErrorSpy, 'communicationEvents');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('formats timeline dates in Asia/Tokyo instead of the server timezone', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T15:30:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'normal',
            pharmacist_id: null,
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: null,
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-03-31T15:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            exclusion_reason: null,
            updated_at: new Date('2026-04-08T08:00:00.000Z'),
          },
        ]),
      },
      medicationCycle: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));

    expect(eventsById.get('visit_schedule:schedule_1')?.summary).toContain('訪問日 2026/04/11');
    expect(eventsById.get('billing_candidate:candidate_1')?.metadata).toContain(
      '算定月 2026/04/01',
    );
    expect(eventsById.get('billing_candidate:candidate_1')?.href).toBe(
      '/billing/candidates?billing_month=2026-04-01&patient_id=patient_1',
    );
  });

  it('uses a deterministic id tiebreaker for same-timestamp events', async () => {
    const occurredAt = new Date('2026-04-03T10:00:00.000Z');
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'comm_a',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'A',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
          {
            id: 'comm_b',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'B',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'communication:comm_b',
      'communication:comm_a',
    ]);
  });

  it('limits projected timeline events and the inline operation-history read', async () => {
    const occurredAt = new Date('2026-04-03T10:00:00.000Z');
    const auditLogFindMany = vi.fn().mockResolvedValue([
      {
        id: 'audit_a',
        action: 'patient_profile_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: null,
        changes: {},
        created_at: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        id: 'audit_b',
        action: 'patient_profile_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: null,
        changes: {},
        created_at: new Date('2026-04-04T09:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: { findMany: auditLogFindMany },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'comm_a',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'A',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
          {
            id: 'comm_b',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'B',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 2,
    });

    expect(auditLogFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(result?.timeline_events).toHaveLength(2);
    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'operation_history:audit_a',
      'operation_history:audit_b',
    ]);
  });

  it('flows every timeline read through the injected scoped executor, never the global prisma', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'export',
            target_type: 'medication_history',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: { export: { target_type: 'medication_history' } },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
    });

    // The runScoped seam records every executor it hands out. Each call must hand
    // `work` the injected `db` executor, never the global `{}` prisma. A generic
    // (non-vi.fn) impl preserves the ScopedTxRunner type parameter.
    const seenExecutors: unknown[] = [];
    let runScopedCallCount = 0;
    const runScoped: ScopedTxRunner = (work) => {
      runScopedCallCount += 1;
      seenExecutors.push(db);
      return work(db as unknown as Prisma.TransactionClient);
    };

    const result = await getPatientTimelineData(runScoped, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    // reads landed on the injected executor's mocks
    expect(db.patient.findFirst).toHaveBeenCalled();
    expect(db.careReport.findMany).toHaveBeenCalled();
    expect(db.auditLog.findMany).toHaveBeenCalled();
    // runScoped invoked once per scoped read; every invocation handed the injected executor
    expect(runScopedCallCount).toBeGreaterThan(0);
    expect(runScopedCallCount).toBe(seenExecutors.length);
    expect(seenExecutors.every((executor) => executor === db)).toBe(true);
    // panel still renders through the scoped seam
    expect(result?.timeline_events.map((item) => item.id)).toEqual(
      expect.arrayContaining(['operation_history:audit_1', 'care_report:report_1']),
    );
    expect(result?.partial_failures).toBeUndefined();
  });

  it('degrades a per-source scoped tx rejection into partial_failures without a 500', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      communicationEvent: {
        // simulate the scoped tx timing out for this source's read
        findMany: vi.fn().mockRejectedValue(new Error('tx timeout')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'care_report:report_1' })]),
      );
      expect(result?.partial_failures).toEqual([
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails soft when the op_history audit-log read rejects: events still render and the failure is surfaced redacted', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockRejectedValue(new Error('audit log query failed')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      // registry events still render despite op_history failure
      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'care_report:report_1' })]),
      );
      // no operation_history events leaked through
      expect(
        result?.timeline_events.some((event) => event.event_type === 'operation_history'),
      ).toBe(false);
      expect(result?.partial_failures).toEqual([
        {
          source: 'operation_history',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      // redaction proof: error.name only, never the raw message
      expectPatientTimelineFailureLog(consoleErrorSpy, 'operation_history');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('audit log query failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails soft when actor-name resolution rejects: events render with actor_name null and the failure is surfaced', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'export',
            target_type: 'medication_history',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: { export: { target_type: 'medication_history' } },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
      // both batchResolveNames calls resolve actor ids via user.findMany; reject it
      user: {
        findMany: vi.fn().mockRejectedValue(new Error('user lookup failed')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      const careReportEvent = result?.timeline_events.find(
        (event) => event.id === 'care_report:report_1',
      );
      const operationHistoryEvent = result?.timeline_events.find(
        (event) => event.id === 'operation_history:audit_1',
      );
      // events still render with actor_name null (no whole-panel 500 from name lookup)
      expect(careReportEvent?.actor_name).toBeNull();
      expect(operationHistoryEvent?.actor_name).toBeNull();
      // both source-actor and operation-actor failures surfaced under DISTINCT keys
      expect(result?.partial_failures).toEqual([
        {
          source: 'actor_names',
          message: '一部のタイムライン情報を取得できませんでした',
        },
        {
          source: 'operation_actor_names',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      // redaction proof
      expectPatientTimelineFailureLog(consoleErrorSpy, 'actor_names');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('user lookup failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('getPatientDocumentsData', () => {
  it('normalizes object-shaped first-visit emergency contacts and ignores malformed items', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00.000Z'),
          phone: '03-0000-0000',
          medical_insurance_number: null,
          care_insurance_number: 'CARE123456',
          residences: [
            {
              address: '東京都千代田区1-1-1',
              facility_id: null,
              building_id: null,
              unit_name: null,
              is_primary: true,
            },
          ],
          contacts: [
            {
              name: '山田 花子',
              phone: '03-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
            },
          ],
          insurances: [],
          cases: [
            {
              id: 'case_1',
              status: 'active',
              start_date: new Date('2026-04-01T00:00:00.000Z'),
              primary_pharmacist_id: 'user_1',
            },
          ],
        }),
      },
      template: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'template_contract',
            template_type: 'contract_document',
            name: '居宅療養管理指導契約書 2026年版',
            version: 2,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_important',
            template_type: 'important_matters',
            name: '重要事項説明書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_privacy',
            template_type: 'privacy_consent',
            name: '個人情報同意書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_consent',
            template_type: 'consent_form',
            name: '在宅サービス同意書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            case_id: 'case_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-01T00:00:00.000Z'),
            updated_at: new Date('2026-04-01T00:00:00.000Z'),
            emergency_contacts: [
              ['unexpected'],
              { relation: '長女' },
              {
                id: 'contact_1',
                name: '山田 花子',
                relation: '長女',
                phone: '03-0000-0000',
                email: 'hanako@example.test',
                fax: null,
                organization_name: '山田家',
                department: '家族',
                is_primary: true,
                is_emergency_contact: true,
              },
            ],
          },
        ]),
      },
      // per-document 履歴は raw SQL window query 経由。$queryRaw が window の結果(<=5/文書)を返す。
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'audit_1',
          actor_id: 'user_1',
          action: 'first_visit_document.replaced',
          target_id: 'doc_1',
          changes: {
            document_action: {
              action: 'replaced',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1.1',
              storage_location: 'store',
              contract_date: '2026-06-10',
              explanation_date: '2026-06-10',
              explanation_staff_name: '佐藤薬剤師',
              signer_type: 'family',
              signer_name: '山田 花子',
              signer_relationship: '長女',
              reason: '署名者を長女へ訂正',
              note: '本人同席',
            },
          },
          created_at: new Date('2026-06-17T00:00:00.000Z'),
        },
        {
          id: 'audit_print_1',
          actor_id: 'user_1',
          action: 'first_visit_document.printed',
          target_id: 'doc_1',
          changes: {
            document_action: {
              action: 'printed',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1.1',
              print_batch_id: 'print_20260616T013000Z_batch1',
              storage_location: 'store',
              note: '印刷ハブから一括印刷',
            },
          },
          created_at: new Date('2026-06-16T00:00:00.000Z'),
        },
      ]),
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    // teeth: per-document 履歴は ROW_NUMBER() window query で文書ごと直近5件に bound する。
    // グローバル take:30 へ戻すと文書数が多いとき一部文書の履歴が欠落するため、query 構造を pin。
    const queryRawMock = db.$queryRaw as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const querySql = (queryRawMock.mock.calls[0][0] as string[]).join('?');
    expect(querySql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY created_at DESC)',
    );
    // cap は厳密に 5(rn <= 50 等の緩みを弾く word-boundary)。
    expect(querySql).toMatch(/rn\s*<=\s*5\b/);
    expect(querySql).toContain("target_type = 'first_visit_document'");
    // org_id 述語を SQL テキストでも pin(bind 値の位置照合と二重で tenant scope を担保)。
    expect(querySql).toContain('org_id = ');
    // bind 変数(injection 不可): org_id と documentIds 配列。
    const queryValues = queryRawMock.mock.calls[0].slice(1);
    expect(queryValues[0]).toBe('org_1');
    expect(queryValues[1]).toEqual(expect.arrayContaining(['doc_1']));

    expect(result?.patient).toEqual({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    expect(result?.print_readiness).toMatchObject({
      overall_status: 'ready',
      missing_required_count: 0,
      warning_count: 0,
      template_versions: expect.arrayContaining([
        expect.objectContaining({
          document_type: 'contract',
          label: '契約書',
          template_id: 'template_contract',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v2',
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        }),
      ]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'default_templates',
          completed: true,
          severity: 'required',
        }),
      ]),
    });
    expect(result?.first_visit_documents[0]?.emergency_contacts).toEqual([
      {
        id: 'contact_1',
        name: '山田 花子',
        relation: '長女',
        phone: '03-0000-0000',
        email: 'hanako@example.test',
        fax: null,
        organization_name: '山田家',
        department: '家族',
        is_primary: true,
        is_emergency_contact: true,
      },
    ]);
    expect(result?.first_visit_documents[0]?.history).toEqual([
      {
        id: 'audit_1',
        action: 'replaced',
        document_type: 'contract',
        template_name: '居宅療養管理指導契約書 2026年版',
        template_version: 'v1.1',
        print_batch_id: null,
        storage_location: 'store',
        contract_date: '2026-06-10',
        explanation_date: '2026-06-10',
        explanation_staff_name: '佐藤薬剤師',
        signer_type: 'family',
        signer_name: '山田 花子',
        signer_relationship: '長女',
        reason: '署名者を長女へ訂正',
        note: '本人同席',
        actor_id: 'user_1',
        created_at: new Date('2026-06-17T00:00:00.000Z'),
      },
      {
        id: 'audit_print_1',
        action: 'printed',
        document_type: 'contract',
        template_name: '居宅療養管理指導契約書 2026年版',
        template_version: 'v1.1',
        print_batch_id: 'print_20260616T013000Z_batch1',
        storage_location: 'store',
        contract_date: null,
        explanation_date: null,
        explanation_staff_name: null,
        signer_type: null,
        signer_name: null,
        signer_relationship: null,
        reason: null,
        note: '印刷ハブから一括印刷',
        actor_id: 'user_1',
        created_at: new Date('2026-06-16T00:00:00.000Z'),
      },
    ]);
    expect(result?.document_statuses).toEqual(
      expect.arrayContaining([
        {
          document_type: 'contract',
          label: '契約書',
          status: 'replaced',
          status_label: '差替え済み',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v1.1',
          storage_location: 'store',
          latest_action_at: new Date('2026-06-17T00:00:00.000Z'),
          latest_printed_at: new Date('2026-06-16T00:00:00.000Z'),
          latest_print_batch_id: 'print_20260616T013000Z_batch1',
          latest_document_id: 'doc_1',
          has_file: false,
          delivered_at: null,
          alerts: ['契約書の画像/PDFが未保存です'],
        },
        {
          document_type: 'important_matters',
          label: '重要事項説明書',
          status: 'not_created',
          status_label: '未作成',
          template_name: null,
          template_version: null,
          storage_location: null,
          latest_action_at: null,
          latest_printed_at: null,
          latest_print_batch_id: null,
          latest_document_id: null,
          has_file: false,
          delivered_at: null,
          alerts: ['重要事項説明書が未作成です'],
        },
      ]),
    );
  });

  it('returns blocked print readiness when required contract print data is missing', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00.000Z'),
          phone: null,
          medical_insurance_number: null,
          care_insurance_number: null,
          residences: [],
          contacts: [],
          insurances: [],
          cases: [
            {
              id: 'case_1',
              status: 'active',
              start_date: null,
              primary_pharmacist_id: null,
            },
          ],
        }),
      },
      template: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'template_contract',
            template_type: 'contract_document',
            name: '居宅療養管理指導契約書 2026年版',
            version: 1,
            effective_from: null,
            effective_to: null,
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    expect(result?.print_readiness).toMatchObject({
      overall_status: 'blocked',
      missing_required_count: 4,
      warning_count: 3,
    });
    expect(result?.print_readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'primary_residence',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'contact_channel',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'care_insurance',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'default_templates',
          completed: false,
          description: '既定テンプレート未設定: 重要事項説明書 / 個人情報同意書 / 同意書',
        }),
      ]),
    );
  });

  it('encodes patient id only in document readiness href path segments and keeps DB identity raw', async () => {
    const patientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(patientId);
    const patientFindFirstMock = vi.fn().mockResolvedValue({
      id: patientId,
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: null,
      phone: null,
      medical_insurance_number: null,
      care_insurance_number: null,
      residences: [],
      contacts: [],
      insurances: [],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          start_date: null,
          primary_pharmacist_id: null,
        },
      ],
    });
    const firstVisitDocumentFindManyMock = vi.fn().mockResolvedValue([]);
    const db = buildDb({
      patient: {
        findFirst: patientFindFirstMock,
      },
      firstVisitDocument: {
        findMany: firstVisitDocumentFindManyMock,
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId,
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    const hrefByKey = Object.fromEntries(
      result?.print_readiness.checks.map((check) => [check.key, check.action_href]) ?? [],
    );
    expect(hrefByKey).toMatchObject({
      patient_profile: `/patients/${encodedPatientId}/edit`,
      primary_residence: `/patients/${encodedPatientId}/edit`,
      contact_channel: `/patients/${encodedPatientId}/edit`,
      care_insurance: `/patients/${encodedPatientId}#patient-profile-summary`,
      key_person: `/patients/${encodedPatientId}#patient-profile-summary`,
      service_start: `/patients/${encodedPatientId}#patient-profile-summary`,
      explainer: `/patients/${encodedPatientId}#patient-profile-summary`,
      default_templates: '/admin/document-templates',
    });
    expect(JSON.stringify(result?.print_readiness.checks)).not.toContain(`/patients/${patientId}`);
    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: patientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: patientId,
          case_id: { in: ['case_1'] },
        }),
      }),
    );
  });

  it('masks first-visit emergency contact channels for external viewers', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            case_id: 'case_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-01T00:00:00.000Z'),
            updated_at: new Date('2026-04-01T00:00:00.000Z'),
            emergency_contacts: [
              {
                name: '山田 花子',
                relation: '長女',
                phone: '03-1234-5678',
                email: 'hanako@example.test',
                fax: '03-8765-4321',
                organization_name: '山田家',
                department: '家族',
                is_primary: true,
                is_emergency_contact: true,
              },
            ],
          },
        ]),
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'external_viewer',
        userId: 'user_1',
      },
    );

    expect(result?.first_visit_documents[0]?.emergency_contacts).toEqual([
      expect.objectContaining({
        name: '山田 花子',
        phone: '***-****-5678',
        email: 'h***@example.test',
        fax: '***-****-4321',
      }),
    ]);
  });
});
