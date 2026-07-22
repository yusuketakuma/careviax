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

import { getPatientOverview } from './patient-detail';
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

describe('getPatientOverview', () => {
  function buildOverviewContact() {
    return {
      id: 'contact_1',
      relation: 'child',
      name: '連絡先 一郎',
      phone: '090-1111-2222',
      email: 'family@example.jp',
      fax: '03-3333-4444',
      organization_name: '家族',
      department: null,
      address: '東京都千代田区2-2-2',
      is_primary: true,
      is_emergency_contact: true,
      notes: '長男',
    };
  }

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

  it('returns the exact canonical intake snapshot even when it is outside the bounded case list', async () => {
    const boundedClosedCases = Array.from({ length: 8 }, (_, index) => ({
      id: `closed_case_${index}`,
      status: 'completed',
      version: index + 1,
      care_team_links: [],
    }));
    const canonicalOutsideList = {
      id: 'older_open_case',
      version: 11,
      required_visit_support: { home_visit_intake: { primary_disease: '既存疾患' } },
    };
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          cases: boundedClosedCases,
        }),
      },
      careCase: { findFirst: vi.fn().mockResolvedValue(canonicalOutsideList) },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    expect(result?.cases).toHaveLength(8);
    expect(result?.intake_edit_target).toEqual({
      care_case_id: 'older_open_case',
      expected_care_case_version: 11,
    });
    expect(result?.intake_edit_snapshot).toEqual({
      care_case_id: 'older_open_case',
      required_visit_support: canonicalOutsideList.required_visit_support,
    });
  });

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
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          contacts: [buildOverviewContact()],
        }),
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
      contacts: [
        expect.objectContaining({
          id: 'contact_1',
          name: '連絡先 一郎',
          phone: '***-****-2222',
          email: 'f***@example.jp',
          fax: '***-****-4444',
          address: '東京都千代田***',
          notes: '長男',
        }),
      ],
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
          contacts: [buildOverviewContact()],
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
      contacts: [buildOverviewContact()],
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

  it('fails closed for an unknown future role when projecting patient contacts', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          ...buildOverviewPatient(),
          contacts: [buildOverviewContact()],
        }),
      },
    });

    const result = await getPatientOverview(
      db as unknown as Parameters<typeof getPatientOverview>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'future_internal_role' as never,
        userId: 'future_user_1',
      },
    );

    expect(result).toMatchObject({
      contacts: [
        expect.objectContaining({
          phone: '***-****-2222',
          email: 'f***@example.jp',
          fax: '***-****-4444',
          address: '東京都千代田***',
        }),
      ],
      privacy: {
        sensitive_fields_masked: true,
        address_fields_masked: true,
        can_view_detail: false,
      },
    });
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
});
