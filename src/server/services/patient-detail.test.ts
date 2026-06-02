import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import {
  getPatientDocumentsData,
  getPatientReadinessData,
  getPatientTimelineData,
} from './patient-detail';

function buildDb<T extends Record<string, unknown> = Record<string, never>>(overrides?: T) {
  return {
    patient: {
      findFirst: vi.fn(),
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
    visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
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
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
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
