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
      ['insurance', `/patients/${encodedPatientId}#patient-insurance`],
      ['medication_risk', `/patients/${encodedPatientId}/safety-check`],
      ['visit_preparation', `/patients/${encodedPatientId}`],
      ['labs', `/patients/${encodedPatientId}/safety-check`],
    ]);
    expect(JSON.stringify(result?.foundation.items)).not.toContain(`/patients/${patientId}`);
  });
});
