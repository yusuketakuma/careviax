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

import {
  getPatientDocumentsData,
  getPatientOverview,
  getPatientReadinessData,
  getPatientTimelineData,
  getPatientVisitsData,
  getPatientWorkflowPreviewData,
  runPatientDetailTasks,
} from './patient-detail';

function buildDb<T extends Record<string, unknown> = Record<string, never>>(overrides?: T) {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    task: {
      count: vi.fn().mockResolvedValue(0),
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
    visitSchedule: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
    communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
    externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
    inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
    dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
    conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
    billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
    medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    patientLabObservation: { findMany: vi.fn().mockResolvedValue([]) },
    jahisSupplementalRecord: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
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

describe('runPatientDetailTasks', () => {
  it('limits active task concurrency and preserves named results', async () => {
    let active = 0;
    let maxActive = 0;
    const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

    const buildTask = (value: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep();
      active -= 1;
      return value;
    };

    const result = await runPatientDetailTasks(
      {
        first: buildTask('first-result'),
        second: buildTask('second-result'),
        third: buildTask('third-result'),
        fourth: buildTask('fourth-result'),
      },
      2,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result).toEqual({
      first: 'first-result',
      second: 'second-result',
      third: 'third-result',
      fourth: 'fourth-result',
    });
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
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue(buildOverviewPatient()),
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
  });

  it('preserves raw PHI fields for pharmacist roles', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue(buildOverviewPatient()),
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
                  role: 'physician',
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

    await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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
        subject: '夕方にふらつきあり',
        counterpart_name: '山田花子',
        occurred_at: new Date('2026-04-03T09:01:00.000Z'),
      },
      {
        id: 'comm_family_call',
        event_type: 'family_call',
        channel: 'phone',
        direction: 'inbound',
        subject: '服薬時間を相談',
        counterpart_name: '長女',
        occurred_at: new Date('2026-04-03T10:00:00.000Z'),
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

    const result = await getPatientTimelineData(db, {
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
          event_type: 'communication',
          title: '連絡を受信',
          status_label: '受信',
        }),
      ]),
    );
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: { not: 'patient_self_report' },
        }),
        take: 8,
      }),
    );
    expect(result?.timeline_events.map((item) => item.id)).not.toContain(
      'communication:comm_self_report',
    );
  });
});

describe('getPatientDocumentsData', () => {
  it('normalizes object-shaped first-visit emergency contacts and ignores malformed items', async () => {
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
  });
});
