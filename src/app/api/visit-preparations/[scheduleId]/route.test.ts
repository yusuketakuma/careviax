import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitRecordFindFirstMock,
  taskFindManyMock,
  visitScheduleContactLogFindManyMock,
  peerVisitScheduleFindManyMock,
  prescriptionIntakeFindManyMock,
  firstVisitDocumentFindFirstMock,
  conferenceNoteFindManyMock,
  billingEvidenceBlockersMock,
  patientHomeCareFeatureSummaryMock,
  scheduleFeatureHighlightsMock,
  scheduleVisitBriefMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  visitScheduleContactLogFindManyMock: vi.fn(),
  peerVisitScheduleFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  billingEvidenceBlockersMock: vi.fn(),
  patientHomeCareFeatureSummaryMock: vi.fn(),
  scheduleFeatureHighlightsMock: vi.fn(),
  scheduleVisitBriefMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
      findMany: peerVisitScheduleFindManyMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
    visitScheduleContactLog: {
      findMany: visitScheduleContactLogFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    firstVisitDocument: {
      findFirst: firstVisitDocumentFindFirstMock,
    },
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
    },
  },
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: patientHomeCareFeatureSummaryMock,
  selectScheduleHomeCareFeatureHighlights: scheduleFeatureHighlightsMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: billingEvidenceBlockersMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getScheduleVisitBrief: scheduleVisitBriefMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/visit-preparations/schedule_1',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/visit-preparations/[scheduleId] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: new Date('1970-01-01T09:00:00Z'),
      time_window_end: new Date('1970-01-01T10:00:00Z'),
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_1',
      facility_batch_id: 'batch_1',
      facility_batch: {
        notes: '感染対策で受付に声かけしてから入室',
      },
      route_order: 1,
      medication_start_date: new Date('2026-03-27T00:00:00Z'),
      medication_end_date: new Date('2026-04-09T00:00:00Z'),
      assignment_mode: 'fallback',
      escalation_reason: '担当薬剤師が不在',
      confirmed_at: new Date('2026-03-26T00:00:00Z'),
      site: {
        id: 'site_1',
        name: '本店',
        address: '東京都港区0-0-0',
      },
      preparation: {
        id: 'prep_1',
        prepared_at: null,
        medication_changes_reviewed: false,
        carry_items_confirmed: true,
        previous_issues_reviewed: false,
        route_confirmed: true,
        offline_synced: false,
        checklist: {},
      },
      visit_record: {
        id: 'record_current',
        outcome_status: 'completed',
      },
      override_request: {
        id: 'override_1',
        status: 'pending',
        reason: '緊急割込',
        impact_summary: null,
      },
      applied_override: null,
      case_: {
        id: 'case_1',
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: 'user_1',
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          residences: [
            {
              address: '東京都港区1-1-1',
              facility_id: 'facility_a',
              facility_unit_id: 'unit_1',
              building_id: 'facility_a',
              unit_name: '201',
            },
          ],
          contacts: [
            {
              id: 'contact_1',
              name: '山田 次郎',
              is_emergency_contact: true,
              relation: 'son',
              phone: '090-1234-5678',
            },
          ],
          consents: [
            { id: 'consent_1', consent_type: 'visit_medication_management', is_active: true },
          ],
        },
        care_team_links: [
          {
            id: 'team_1',
            role: 'physician',
            name: '佐藤 医師',
            organization_name: 'みなとクリニック',
            phone: '03-1234-5678',
          },
        ],
      },
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'record_1',
      visit_date: new Date('2026-03-20T00:00:00Z'),
      outcome_status: 'completed',
      soap_plan: '残薬確認を強化する',
      next_visit_suggestion_date: new Date('2026-04-03T00:00:00Z'),
    });
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'visit_preparation',
        title: '訪問準備が未完了です',
        description: '前回課題の確認が必要です',
        priority: 'high',
        assigned_to: 'user_1',
        due_date: new Date('2026-03-27T00:00:00Z'),
        sla_due_at: new Date('2026-03-27T00:00:00Z'),
        related_entity_type: 'visit_schedule',
        related_entity_id: 'schedule_1',
      },
    ]);
    visitScheduleContactLogFindManyMock.mockResolvedValue([
      {
        id: 'log_1',
        outcome: 'attempted',
        contact_name: '家族A',
        contact_phone: '090-0000-0000',
        note: '夕方に再架電予定',
        callback_due_at: new Date('2026-03-26T09:00:00Z'),
        called_at: new Date('2026-03-26T08:00:00Z'),
        called_by: 'user_1',
      },
    ]);
    peerVisitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_2',
        route_order: 2,
        schedule_status: 'ready',
        medication_start_date: new Date('2026-03-28T00:00:00Z'),
        medication_end_date: new Date('2026-04-10T00:00:00Z'),
        preparation: {
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: false,
          route_confirmed: true,
          offline_synced: true,
        },
        visit_record: null,
        case_: {
          patient: {
            id: 'patient_2',
            name: '山田 花子',
            residences: [
              {
                address: '東京都港区1-1-1',
                facility_id: 'facility_a',
                facility_unit_id: 'unit_1',
                building_id: 'facility_a',
                unit_name: '202',
              },
            ],
          },
        },
      },
    ]);
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            drug_name: 'アムロジピンOD錠5mg',
            drug_code: '111',
            dose: '1回1錠',
            frequency: '1日1回朝食後',
            days: 14,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-09T00:00:00Z'),
          },
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回2錠',
            frequency: '疼痛時',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
        ],
      },
      {
        id: 'intake_previous',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-10T00:00:00Z'),
        lines: [
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回1錠',
            frequency: '疼痛時',
            days: 7,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-16T00:00:00Z'),
          },
          {
            drug_name: 'マグミット錠330mg',
            drug_code: '333',
            dose: '1回2錠',
            frequency: '1日3回毎食後',
            days: 14,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-23T00:00:00Z'),
          },
        ],
      },
    ]);
    firstVisitDocumentFindFirstMock.mockResolvedValue({
      id: 'fvd_1',
      delivered_at: new Date('2026-03-20T10:00:00Z'),
      delivered_to: '山田 次郎',
    });
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'conf_pre_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        conference_date: new Date('2026-03-24T00:00:00Z'),
        participants: [{ name: '病院薬剤師', role: 'hospital_pharmacist' }],
        structured_content: {
          sections: [
            { key: 'target_discharge_date', label: '退院予定日', body: '2026-03-27' },
            { key: 'next_visit_plan', label: '初回訪問計画', body: '退院翌週に初回訪問' },
          ],
        },
        metadata: { sync_summary: { visit_proposal_id: 'proposal_1' } },
        action_items: [{ title: '退院時変更薬を確認する' }],
      },
    ]);
    billingEvidenceBlockersMock.mockResolvedValue([]);
    patientHomeCareFeatureSummaryMock.mockResolvedValue({
      totals: { blocked: 1, attention: 0, monitoring: 0, ready: 19 },
      features: [],
    });
    scheduleFeatureHighlightsMock.mockReturnValue([
      {
        key: 'consent_plan_huddle',
        title: '同意・計画書ハドル',
        description: '訪問前の同意・計画書ブロックを見逃しません。',
        group: 'preparation',
        action_href: '/workflow',
        action_label: '前提不足を確認',
        status: 'blocked',
        severity: 'urgent',
        count: 1,
        summary: '同意または計画書の確認が必要です。',
        evidence: ['前提不足 1件'],
      },
    ]);
    scheduleVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '山田 太郎' },
      context: 'schedule',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: '2026-03-26T00:00:00.000Z',
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
      ai_summary: {
        provider: 'rule',
        requested_provider: 'disabled',
        is_fallback: true,
        model: null,
        fallback_reason: 'provider_unavailable',
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
  });

  it('returns preparation and pre-visit pack data', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(peerVisitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        preparation: {
          id: 'prep_1',
        },
        pack: {
          patient: {
            name: '山田 太郎',
          },
          handoff: {
            assignment_mode: 'fallback',
          },
          readiness_blockers: expect.arrayContaining(['薬歴・前回変更の確認', '前回課題の確認']),
          facility_mode: {
            same_day_patient_count: 2,
            same_day_patient_names: expect.arrayContaining(['山田 太郎', '山田 花子']),
          },
          facility_parallel_context: {
            batch_id: 'batch_1',
            place_kind: 'facility',
            common_notes: '感染対策で受付に声かけしてから入室',
            site_name: '本店',
            current_schedule_id: 'schedule_1',
            patients: [
              expect.objectContaining({
                schedule_id: 'schedule_1',
                patient_name: '山田 太郎',
                unit_name: '201',
                medication_start_date: '2026-03-27',
                medication_end_date: '2026-04-09',
                visit_record_id: 'record_current',
                visit_outcome_status: 'completed',
                preparation_blockers_count: 3,
              }),
              expect.objectContaining({
                schedule_id: 'schedule_2',
                patient_name: '山田 花子',
                preparation_blockers_count: 1,
              }),
            ],
          },
          care_team: [
            expect.objectContaining({
              name: '佐藤 医師',
            }),
          ],
          conference_context: [
            expect.objectContaining({
              note_type: 'pre_discharge',
              title: '退院前カンファ',
              highlights: expect.arrayContaining([
                expect.stringContaining('退院予定'),
                expect.stringContaining('初回訪問計画'),
              ]),
              action_items: expect.arrayContaining(['退院時変更薬を確認する']),
            }),
          ],
          home_care_feature_highlights: [
            expect.objectContaining({
              key: 'consent_plan_huddle',
              status: 'blocked',
            }),
          ],
          previous_visit: expect.objectContaining({
            summary: expect.stringContaining('残薬確認を強化する'),
          }),
          medication_period: {
            schedule_start_date: '2026-03-27',
            schedule_end_date: '2026-04-09',
            prescription_start_date: '2026-03-27',
            prescription_end_date: '2026-04-09',
          },
          prescription_changes: {
            added: ['アムロジピンOD錠5mg'],
            changed: [
              expect.objectContaining({
                drug_name: 'ロキソプロフェン錠60mg',
              }),
            ],
            removed: ['マグミット錠330mg'],
          },
          visit_brief: {
            context: 'schedule',
            ai_summary: {
              provider: 'rule',
            },
          },
          open_tasks: [
            expect.objectContaining({
              title: '訪問準備が未完了です',
              action_label: '準備を完了',
            }),
          ],
          onboarding_readiness: expect.objectContaining({
            consent_obtained: true,
            emergency_contact_set: true,
            first_visit_doc_delivered: true,
          }),
          emergency_contacts: [
            expect.objectContaining({
              name: '山田 次郎',
            }),
          ],
          first_visit_document: expect.objectContaining({
            delivered_to: '山田 次郎',
          }),
        },
      },
    });
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
    });
    expect(scheduleFeatureHighlightsMock).toHaveBeenCalledOnce();
    expect(scheduleVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
    });
  });

  it('includes intake_context with structured scheduling preference and home_visit_intake fields', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: new Date('1970-01-01T10:00:00Z'),
      time_window_end: new Date('1970-01-01T11:00:00Z'),
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_1',
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'case_1',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        required_visit_support: {
          home_visit_intake: {
            money_management: 'family',
            family_key_person: '長男 田中',
            care_level: 'care_2',
            adl_level: 'a',
            dementia_level: 'i',
            special_medical_procedures: ['narcotics', 'home_oxygen'],
            special_medical_notes: '麻薬処方あり',
            narcotics_base: true,
            narcotics_rescue: false,
            infection_isolation: 'contact',
            residual_medication_status: 'none',
            medication_support_methods: ['unit_dose'],
          },
        },
        management_plans: [],
        patient: {
          id: 'patient_1',
          name: '田中 三郎',
          residences: [{ address: '東京都新宿区1-1-1', building_id: null }],
          contacts: [],
          consents: [],
          scheduling_preference: {
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: 'morning',
            first_visit_time_note: '9時以降希望',
            parking_available: false,
            primary_contact_preference: 'phone',
            mcs_linked: true,
          },
        },
        care_team_links: [],
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          intake_context: {
            // from scheduling_preference (HVI-01B structured fields)
            visit_before_contact_required: true,
            first_visit_time_slot: 'morning',
            first_visit_time_note: '9時以降希望',
            parking_available: false,
            primary_contact_preference: 'phone',
            mcs_linked: true,
            // from home_visit_intake JSON (HVI-01C)
            money_management: 'family',
            special_medical_procedures: ['narcotics', 'home_oxygen'],
            infection_isolation: 'contact',
            narcotics_base: true,
          },
        },
      },
    });
  });

  it('rejects users who are not assigned to the visit or case', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: null,
      time_window_end: null,
      visit_type: 'regular',
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_other',
      facility_batch_id: null,
      facility_batch: null,
      route_order: null,
      medication_start_date: null,
      medication_end_date: null,
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      visit_record: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'case_1',
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
        required_visit_support: null,
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          residences: [],
          contacts: [],
          consents: [],
          scheduling_preference: null,
        },
        care_team_links: [],
        management_plans: [],
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(patientHomeCareFeatureSummaryMock).not.toHaveBeenCalled();
  });

  it('builds the same grouped-visit context for same-home private visits', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'home_schedule_1',
      case_id: 'home_case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: null,
      time_window_end: null,
      visit_type: 'regular',
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_1',
      facility_batch_id: null,
      facility_batch: null,
      route_order: 1,
      medication_start_date: null,
      medication_end_date: null,
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'home_case_1',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        required_visit_support: null,
        management_plans: [],
        patient: {
          id: 'home_patient_1',
          name: '山田 太郎',
          residences: [
            {
              address: '東京都港区個人宅1-1-1',
              facility_id: null,
              facility_unit_id: null,
              building_id: '山田宅',
              unit_name: null,
            },
          ],
          contacts: [],
          consents: [],
          scheduling_preference: null,
        },
        care_team_links: [],
      },
    });
    peerVisitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'home_schedule_2',
        route_order: 2,
        schedule_status: 'planned',
        medication_start_date: null,
        medication_end_date: null,
        preparation: null,
        visit_record: null,
        case_: {
          patient: {
            id: 'home_patient_2',
            name: '山田 花子',
            residences: [
              {
                address: '東京都港区個人宅1-1-1',
                facility_id: null,
                facility_unit_id: null,
                building_id: '山田宅',
                unit_name: null,
              },
            ],
          },
        },
      },
    ]);
    prescriptionIntakeFindManyMock.mockResolvedValue([]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'home_schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          facility_parallel_context: {
            label: '山田宅',
            place_kind: 'home_group',
            patients: [
              expect.objectContaining({
                schedule_id: 'home_schedule_1',
                patient_name: '山田 太郎',
              }),
              expect.objectContaining({
                schedule_id: 'home_schedule_2',
                patient_name: '山田 花子',
              }),
            ],
          },
        },
      },
    });
  });
});
