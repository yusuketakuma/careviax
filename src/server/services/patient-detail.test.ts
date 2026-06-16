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
    template: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    visitSchedule: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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

    const result = await getPatientTimelineData(db, {
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
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
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
