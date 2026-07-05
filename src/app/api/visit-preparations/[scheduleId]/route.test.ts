import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitRecordFindFirstMock,
  visitRecordFindManyMock,
  medicationCycleFindManyMock,
  taskFindManyMock,
  taskFindFirstMock,
  visitScheduleContactLogFindManyMock,
  peerVisitScheduleFindManyMock,
  prescriptionIntakeFindManyMock,
  firstVisitDocumentFindFirstMock,
  conferenceNoteFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  patientHomeCareFeatureSummaryMock,
  scheduleFeatureHighlightsMock,
  scheduleVisitBriefMock,
  visitPreparationUpsertMock,
  visitVehicleResourceFindFirstMock,
  visitScheduleUpdateMock,
  visitScheduleUpdateManyMock,
  computeOptimizedVisitRouteMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  visitScheduleContactLogFindManyMock: vi.fn(),
  peerVisitScheduleFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingEvidenceBlockersMock: vi.fn(),
  patientHomeCareFeatureSummaryMock: vi.fn(),
  scheduleFeatureHighlightsMock: vi.fn(),
  scheduleVisitBriefMock: vi.fn(),
  visitPreparationUpsertMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
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
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
      findMany: visitRecordFindManyMock,
    },
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
    },
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
      findFirst: taskFindFirstMock,
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
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

vi.mock('@/server/services/visit-route-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/visit-route-engine')>();
  return {
    ...actual,
    computeOptimizedVisitRoute: computeOptimizedVisitRouteMock,
  };
});

vi.mock('@/server/services/operational-tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/operational-tasks')>();
  return {
    ...actual,
    upsertOperationalTask: upsertOperationalTaskMock,
    resolveOperationalTasks: resolveOperationalTasksMock,
  };
});

import { GET, PUT } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-preparations/schedule_1', {
    headers,
  });
}

function createPutRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-preparations/schedule_1', {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPutRequest(headers: Record<string, string> = { 'x-org-id': 'org_1' }) {
  return new NextRequest('http://localhost/api/visit-preparations/schedule_1', {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"medication_changes_reviewed":',
  });
}

const completePreparationBody = {
  checklist: { legacy_debug: undefined },
  medication_changes_reviewed: true,
  carry_items_confirmed: true,
  previous_issues_reviewed: true,
  route_confirmed: true,
  offline_synced: true,
};

function buildPutScheduleMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    site_id: 'site_1',
    vehicle_resource_id: null,
    carry_items_status: 'ready',
    schedule_status: 'planned',
    confirmed_at: null,
    scheduled_date: new Date('2026-03-27T00:00:00Z'),
    route_order: 1,
    pharmacist_id: 'user_1',
    version: 1,
    case_: {
      primary_pharmacist_id: 'user_primary',
      backup_pharmacist_id: null,
    },
    ...overrides,
  };
}

function buildReadyTransitionScheduleMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    carry_items_status: 'ready',
    scheduled_date: new Date('2026-03-27T00:00:00Z'),
    preparation: {
      org_id: 'org_1',
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
    },
    case_: {
      patient: {
        id: 'patient_1',
        org_id: 'org_1',
        contacts: [{ id: 'contact_1' }],
      },
      care_team_links: [{ role: 'physician' }],
    },
    ...overrides,
  };
}

describe('/api/visit-preparations/[scheduleId] GET', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

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
      carry_items_status: 'ready',
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
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          gender: 'male',
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
      version: 4,
      updated_at: new Date('2026-03-20T08:30:00.000Z'),
      structured_soap: {
        subjective: {
          symptom_checks: ['便秘が続く'],
          free_text: '昼分の飲み忘れあり',
        },
        objective: {
          medication_status: '一包化で管理',
          adherence_score: 3,
          side_effect_checks: ['眠気'],
          adverse_events: {
            has_events: true,
            events: ['ふらつき'],
            details: '夜間トイレ時にふらつく',
          },
        },
        assessment: {
          problem_checks: ['服薬タイミングのずれ'],
          free_text: '残薬と眠気を次回も確認',
        },
        plan: {
          intervention_checks: ['残薬調整'],
          physician_report_items: '眠気とふらつきを共有',
          care_manager_report_items: '夜間転倒リスクを共有',
          free_text: '次回も残薬確認',
        },
        residual_medications: [
          {
            drug_name: 'アムロジピンOD錠5mg',
            remaining_quantity: 6,
            excess_days: 3,
            is_reduction_target: true,
          },
        ],
        handoff: {
          next_check_items: ['眠気とふらつきの継続確認'],
          ongoing_monitoring: ['昼分の飲み忘れ'],
          decision_rationale: '前回残薬と副作用訴えあり',
        },
      },
      next_visit_suggestion_date: new Date('2026-04-03T00:00:00Z'),
    });
    visitRecordFindManyMock.mockResolvedValue([{ id: 'record_1' }]);
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1' }]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_current',
        billing_month: new Date('2026-03-01T00:00:00Z'),
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 3240,
        status: 'confirmed',
        calculation_breakdown: {
          collection: {
            status: 'scheduled',
            billed_amount: 3240,
            collected_amount: 0,
            unpaid_amount: 3240,
            payment_method: 'cash',
            payer_name: '山田 次郎',
            scheduled_collection_at: '2026-03-27T01:00:00.000Z',
            collected_at: null,
            receipt_number: null,
            receipt_issue_status: 'not_issued',
            updated_by: 'user_billing',
          },
        },
        updated_at: new Date('2026-03-26T00:00:00Z'),
      },
      {
        id: 'candidate_current_addon',
        billing_month: new Date('2026-03-01T00:00:00Z'),
        billing_name: '麻薬管理指導加算',
        points: 680,
        status: 'confirmed',
        calculation_breakdown: {
          collection: {
            status: 'scheduled',
            billed_amount: 680,
            collected_amount: 0,
            unpaid_amount: 680,
            payment_method: 'cash',
            payer_name: '山田 次郎',
            receipt_number: null,
            receipt_issue_status: 'not_issued',
            updated_by: 'user_billing',
          },
        },
        updated_at: new Date('2026-03-25T00:00:00Z'),
      },
      {
        id: 'candidate_previous',
        billing_month: new Date('2026-02-01T00:00:00Z'),
        billing_name: '居宅療養管理指導料',
        points: 1080,
        status: 'confirmed',
        calculation_breakdown: {
          collection: {
            status: 'partial',
            billed_amount: 2160,
            collected_amount: 1080,
            unpaid_amount: 1080,
            payment_method: 'bank_transfer',
            payer_name: '山田 次郎',
            receipt_number: 'R202602-001',
            receipt_issue_status: 'issued',
            updated_by: 'user_billing',
          },
        },
        updated_at: new Date('2026-02-28T00:00:00Z'),
      },
    ]);
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        payer_type: 'family',
        payer_name: '山田 次郎',
        payer_relation: '長男',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'yes',
        unpaid_tolerance: 'one_month',
      },
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
        contact_method: 'phone',
        contact_name: '家族A',
        contact_phone: '090-0000-0000',
        note: '夕方に再架電予定',
        callback_due_at: new Date('2026-03-26T09:00:00Z'),
        called_at: new Date('2026-03-26T08:00:00Z'),
        called_by: 'user_1',
        idempotency_key: 'contact-key-secret',
        request_fingerprint: 'contact-fingerprint-secret',
      },
      {
        id: 'log_2',
        outcome: 'confirmed',
        contact_method: 'email',
        contact_name: '家族B',
        contact_phone: '080-1111-2222',
        note: '   ',
        callback_due_at: null,
        called_at: new Date('2026-03-25T08:00:00Z'),
        called_by: 'user_2',
        idempotency_key: 'contact-key-secret-2',
        request_fingerprint: 'contact-fingerprint-secret-2',
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
            name_kana: 'ヤマダ ハナコ',
            birth_date: new Date('1945-02-03T00:00:00Z'),
            gender: 'female',
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
      {
        id: 'conf_regular_1',
        note_type: 'regular',
        title: '通常カンファ',
        conference_date: new Date('2026-03-23T00:00:00Z'),
        participants: [],
        structured_content: { sections: [] },
        metadata: null,
        action_items: [],
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
    visitPreparationUpsertMock.mockResolvedValue({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: new Date('2026-03-27T00:00:00Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
      }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
  });

  it('returns preparation and pre-visit pack data', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(peerVisitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
          },
        }),
      }),
    );
    expect(visitScheduleContactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4,
        orderBy: [{ called_at: 'desc' }],
        select: {
          outcome: true,
          contact_method: true,
          note: true,
          callback_due_at: true,
          called_at: true,
        },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
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
          readiness_blockers: ['薬歴・前回変更の確認', '前回課題の確認', 'オフライン同期確認'],
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
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                patient_name_kana: 'ヤマダ タロウ',
                patient_birth_date: '1940-01-01',
                patient_gender: 'male',
                unit_name: '201',
                medication_start_date: '2026-03-27',
                medication_end_date: '2026-04-09',
                visit_record_id: 'record_current',
                visit_outcome_status: 'completed',
                preparation_blockers_count: 3,
              }),
              expect.objectContaining({
                schedule_id: 'schedule_2',
                patient_id: 'patient_2',
                patient_name: '山田 花子',
                patient_name_kana: 'ヤマダ ハナコ',
                patient_birth_date: '1945-02-03',
                patient_gender: 'female',
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
            source_revision: {
              version: 4,
              updated_at: '2026-03-20T08:30:00.000Z',
            },
            summary: expect.stringContaining('残薬確認を強化する'),
            structured_reuse: expect.objectContaining({
              source_visit_record_id: 'record_1',
              source_visit_record_version: 4,
              source_visit_record_updated_at: '2026-03-20T08:30:00.000Z',
              carry_forward_items: expect.arrayContaining([
                '眠気とふらつきの継続確認',
                '継続観察: 昼分の飲み忘れ',
                expect.stringContaining('前回残薬'),
                '副作用再確認: 眠気',
              ]),
              handoff: expect.objectContaining({
                next_check_items: ['眠気とふらつきの継続確認'],
                ongoing_monitoring: ['昼分の飲み忘れ'],
                decision_rationale: '前回残薬と副作用訴えあり',
              }),
            }),
          }),
          medication_period: {
            schedule_start_date: '2026-03-27',
            schedule_end_date: '2026-04-09',
            prescription_start_date: '2026-03-27',
            prescription_end_date: '2026-04-09',
          },
          billing_collection_context: {
            candidate_id: 'candidate_current',
            billing_name: '在宅患者訪問薬剤管理指導料',
            current_billed_amount: 3920,
            current_collection_amount: 3920,
            previous_unpaid_amount: 1080,
            total_collection_amount: 5000,
            collection_method: 'cash',
            collection_method_label: '現金',
            collection_timing: 'per_visit',
            collection_timing_label: '毎回',
            payer_name: '山田 次郎',
            payer_relation: '長男',
            receipt_issue: 'paper',
            receipt_issue_label: '紙',
            receipt_issue_status: 'not_issued',
            receipt_issue_status_label: '未発行',
            collector_user_id: 'user_billing',
          },
          prescription_changes: {
            added: ['アムロジピンOD錠5mg'],
            added_medications: [{ drug_name: 'アムロジピンOD錠5mg', drug_code: '111' }],
            changed: [
              expect.objectContaining({
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '222',
                previous_drug_code: '222',
              }),
            ],
            removed: ['マグミット錠330mg'],
            removed_medications: [{ drug_name: 'マグミット錠330mg', drug_code: '333' }],
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
          recent_contact_logs: [
            {
              outcome: 'attempted',
              contact_method: 'phone',
              has_note: true,
              callback_due_at: '2026-03-26T09:00:00.000Z',
              called_at: '2026-03-26T08:00:00.000Z',
            },
            {
              outcome: 'confirmed',
              contact_method: 'email',
              has_note: false,
              callback_due_at: null,
              called_at: '2026-03-25T08:00:00.000Z',
            },
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
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('log_1');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('log_2');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('家族A');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('家族B');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('090-0000-0000');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('080-1111-2222');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('夕方に再架電予定');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('user_1');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('user_2');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('contact-key-secret');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain(
      'contact-fingerprint-secret',
    );
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
    });
    expect(scheduleFeatureHighlightsMock).toHaveBeenCalledOnce();
    expect(scheduleVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
      currentScheduleId: 'schedule_1',
      scheduledDate: new Date('2026-03-27T00:00:00Z'),
    });
    expect(billingEvidenceBlockersMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      visitRecordIds: ['record_1'],
      cycleIds: ['cycle_1'],
      limit: 4,
    });
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          cycle_id: { in: ['cycle_1'] },
          status: { not: 'excluded' },
        }),
      }),
    );
    expect(billingCandidateFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          task_type: 'patient_billing_payment_profile',
          related_entity_type: 'patient',
          related_entity_id: 'patient_1',
        }),
      }),
    );
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: expect.objectContaining({
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
        }),
      }),
    );
    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ case_id: 'case_1' }, { patient_id: 'patient_1', case_id: null }],
        }),
      }),
    );
  });

  it('projects outside-med classification from the latest prescription lines (§11-7)', async () => {
    const startDate = new Date('2026-03-27T00:00:00Z');
    const endDate = new Date('2026-04-09T00:00:00Z');
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            id: 'line_topical',
            drug_name: 'モーラステープ',
            drug_code: 'T1',
            dose: '1日1枚',
            frequency: '1日1回',
            days: 14,
            start_date: startDate,
            end_date: endDate,
            route: 'external',
            dosage_form: '貼付剤',
            unit: '枚',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
          {
            id: 'line_cold',
            drug_name: 'ナウゼリン坐剤',
            drug_code: 'C1',
            dose: '1回1個',
            frequency: '発熱時',
            days: 5,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '坐剤',
            unit: '個',
            packaging_instructions: null,
            packaging_instruction_tags: ['cold_storage'],
            notes: null,
          },
          {
            id: 'line_prn',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: 'P1',
            dose: '1回1錠',
            frequency: '疼痛時',
            days: 7,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '錠',
            unit: '錠',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
          {
            id: 'line_plain',
            drug_name: 'アムロジピンOD錠5mg',
            drug_code: 'A1',
            dose: '1回1錠',
            frequency: '1日1回朝食後',
            days: 14,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '錠',
            unit: '錠',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });
    if (!response) throw new Error('response is required');
    const body = await response.json();

    // 外用/冷所/頓服が同一語彙で projection され、通常内服(line_plain)はその他薬でないため除外される。
    // 冷所は頓服シグナル(発熱時)より優先される。
    expect(body.data.pack.outside_meds).toEqual([
      {
        line_id: 'line_topical',
        drug_name: 'モーラステープ',
        outside_med_kind: 'topical',
        outside_med_label: '外用',
      },
      {
        line_id: 'line_cold',
        drug_name: 'ナウゼリン坐剤',
        outside_med_kind: 'cold',
        outside_med_label: '冷所',
      },
      {
        line_id: 'line_prn',
        drug_name: 'ロキソプロフェン錠60mg',
        outside_med_kind: 'prn',
        outside_med_label: '頓服',
      },
    ]);
    expect(
      body.data.pack.outside_meds.map((item: { line_id: string }) => item.line_id),
    ).not.toContain('line_plain');
  });

  it('masks billing payer and receipt details for visit users without billing permission', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist_trainee' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          billing_collection_context: {
            current_collection_amount: 3920,
            previous_unpaid_amount: 1080,
            total_collection_amount: 5000,
            collection_method_label: '現金',
            payer_name: null,
            payer_relation: null,
            receipt_number: null,
            collector_user_id: null,
          },
        },
      },
    });
  });

  it.each(['partial', 'blocked'] as const)(
    'includes unresolved carry item status %s in readiness blockers',
    async (carryItemsStatus) => {
      const baseSchedule = await visitScheduleFindFirstMock();
      visitScheduleFindFirstMock.mockClear();
      visitScheduleFindFirstMock.mockResolvedValueOnce({
        ...baseSchedule,
        carry_items_status: carryItemsStatus,
      });

      const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          pack: {
            readiness_blockers: [
              '持参物ステータス未解決',
              '薬歴・前回変更の確認',
              '前回課題の確認',
              'オフライン同期確認',
            ],
          },
        },
      });
      expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            carry_items_status: true,
          }),
        }),
      );
      expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schedule: { case_id: 'case_1' },
            schedule_id: { not: 'schedule_1' },
            visit_date: { lt: new Date('2026-03-27T00:00:00.000Z') },
          }),
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        }),
      );
    },
  );

  it('summarizes previous visit dates by the local pharmacy calendar day', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'record_1',
      visit_date: new Date('2026-03-19T15:30:00.000Z'),
      outcome_status: 'completed',
      soap_plan: '残薬確認を強化する',
      version: 2,
      updated_at: new Date('2026-03-19T16:00:00.000Z'),
      structured_soap: null,
      next_visit_suggestion_date: new Date('2026-04-02T15:30:00.000Z'),
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          previous_visit: expect.objectContaining({
            summary: expect.stringMatching(/前回 2026-03-20.*次回提案: 2026-04-03/),
          }),
        },
      },
    });
  });

  it('keeps duplicate same-drug prescription lines distinct in preparation change summaries', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([
      {
        id: 'intake_current_duplicate',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回2錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
        ],
      },
      {
        id: 'intake_previous_duplicate',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-10T00:00:00Z'),
        lines: [
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回1錠',
            frequency: '朝食後',
            days: 7,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-16T00:00:00Z'),
          },
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回1錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-16T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          prescription_changes: {
            changed: [
              expect.objectContaining({
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '222',
                previous_drug_name: 'ロキソプロフェン錠60mg',
                previous_drug_code: '222',
                reasons: ['用量 1回1錠 → 1回2錠'],
              }),
            ],
            removed: ['ロキソプロフェン錠60mg'],
            removed_medications: [{ drug_name: 'ロキソプロフェン錠60mg', drug_code: '222' }],
          },
        },
      },
    });
  });

  it('returns medication identities for initial prescription preparation summaries', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([
      {
        id: 'intake_initial',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            drug_name: '同名薬',
            drug_code: 'YJ001',
            dose: '1回1錠',
            frequency: '朝食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
          {
            drug_name: '同名薬',
            drug_code: null,
            dose: '1回1錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          prescription_changes: {
            added: ['同名薬', '同名薬'],
            added_medications: [
              { drug_name: '同名薬', drug_code: 'YJ001' },
              { drug_name: '同名薬', drug_code: null },
            ],
            changed: [],
            removed: [],
            removed_medications: [],
          },
        },
      },
    });
  });

  it('rejects blank schedule ids before schedule lookup', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found before loading preparation dependencies', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定が見つかりません',
    });
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when preparation loading fails unexpectedly', async () => {
    visitScheduleFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 住所 東京都港区1-1-1 raw visit preparation detail'),
    );

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田太郎');
    expect(JSON.stringify(json)).not.toContain('東京都港区1-1-1');
    expect(JSON.stringify(json)).not.toContain('raw visit preparation detail');
  });

  it('ignores malformed conference JSON sections and sync summaries', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'conf_malformed',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        conference_date: new Date('2026-03-24T00:00:00Z'),
        participants: [
          ['unexpected'],
          { name: '病院薬剤師', role: 'hospital_pharmacist' },
          { name: 123, role: ['invalid'] },
        ],
        structured_content: {
          sections: [
            ['unexpected'],
            { key: 123, label: '退院予定日', body: '2026-03-27' },
            { key: 'target_discharge_date', label: ['invalid'], body: 123 },
            { key: 'next_visit_plan', label: '初回訪問計画', body: '退院翌週に初回訪問' },
          ],
        },
        metadata: {
          sync_summary: {
            visit_proposal_id: 123,
            report_draft_ids: ['report_1', 456],
            tasks_created: 2,
          },
        },
        action_items: [['unexpected'], { title: 123 }, { title: '退院時変更薬を確認する' }],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          conference_context: [
            {
              participants: [
                { name: '病院薬剤師', role: 'hospital_pharmacist' },
                { name: null, role: null },
              ],
              highlights: ['初回訪問計画: 退院翌週に初回訪問'],
              action_items: ['退院時変更薬を確認する'],
              sync_summary: {
                billing_candidate_id: null,
                visit_proposal_id: null,
                report_draft_ids: ['report_1'],
                tasks_created: 2,
              },
            },
          ],
        },
      },
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

  it('allows an org-wide pharmacist who is not assigned to the visit or case but withholds parallel-visit context', async () => {
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
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          gender: 'male',
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
    expect(response.status).toBe(200);
    // 並行訪問コンテキストは担当者(または owner/admin)に限定されるため、未担当の組織内薬剤師には公開しない。
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalled();
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
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          gender: 'male',
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
            name_kana: 'ヤマダ ハナコ',
            birth_date: new Date('1945-02-03T00:00:00Z'),
            gender: 'female',
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
                patient_id: 'home_patient_1',
                patient_name: '山田 太郎',
                patient_name_kana: 'ヤマダ タロウ',
                patient_birth_date: '1940-01-01',
                patient_gender: 'male',
              }),
              expect.objectContaining({
                schedule_id: 'home_schedule_2',
                patient_id: 'home_patient_2',
                patient_name: '山田 花子',
                patient_name_kana: 'ヤマダ ハナコ',
                patient_birth_date: '1945-02-03',
                patient_gender: 'female',
              }),
            ],
          },
        },
      },
    });
  });
});

describe('/api/visit-preparations/[scheduleId] PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleFindFirstMock.mockResolvedValue(buildPutScheduleMock());
    billingEvidenceBlockersMock.mockResolvedValue([]);
    visitPreparationUpsertMock.mockResolvedValue({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: new Date('2026-03-27T00:00:00Z'),
    });
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 8,
      max_route_duration_minutes: 120,
    });
    peerVisitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        route_order: 1,
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.681236,
          lng: 139.767125,
        },
        case_: {
          patient: {
            name: '山田太郎',
            residences: [
              {
                address: '東京都千代田区1-1',
                lat: 35.684,
                lng: 139.77,
              },
            ],
          },
        },
      },
    ]);
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: 'ヒューリスティック順序を表示しています',
      travelMode: 'DRIVE',
      origin: {
        lat: 35.681236,
        lng: 139.767125,
        label: '本店',
      },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 900,
      stopSummaries: [
        {
          scheduleId: 'schedule_1',
          optimizedOrder: 1,
          arrivalOffsetSeconds: 900,
          distanceFromPreviousMeters: 1200,
          durationFromPreviousSeconds: 900,
        },
      ],
    });
    visitScheduleUpdateMock.mockResolvedValue({
      id: 'schedule_1',
      vehicle_resource_id: 'vehicle_1',
    });
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
        },
      }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
  });

  it('returns a sanitized no-store 500 when put auth plumbing fails before schedule lookup', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw put auth patient 山田 花子 token secret preparation memo'),
    );

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw put auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects non-object preparation payloads before schedule lookup or upsert', async () => {
    const response = await PUT(createPutRequest([]), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON preparation payloads before schedule lookup or upsert', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before parsing preparation payloads or schedule lookup', async () => {
    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('denies a trainee before parsing, loading, route planning, or readiness side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問準備を更新する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('denies a trainee mark-ready vehicle assignment before readiness side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問準備を更新する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to upsert preparation even when not assigned to the schedule', async () => {
    // 新ポリシー: 薬剤師は組織内フルアクセス。担当外の予定でも準備の upsert が許可される。
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalled();
  });

  it('allows the backup pharmacist to mark previous issues as reviewed', async () => {
    const defaultChecklist = {
      emergency_contacts_checked: false,
      medication_prepared: false,
      patient_record_reviewed: false,
      prescription_confirmed: false,
      previous_visit_reviewed: false,
      route_confirmed: false,
    };

    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: 'user_1',
      },
    });

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schedule_id: 'schedule_1' },
        create: expect.objectContaining({
          checklist: defaultChecklist,
          previous_issues_reviewed: true,
          prepared_by: 'user_1',
          prepared_at: expect.any(Date),
        }),
        update: expect.objectContaining({
          checklist: defaultChecklist,
          previous_issues_reviewed: true,
          prepared_by: 'user_1',
          prepared_at: expect.any(Date),
        }),
      }),
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-preparation:schedule_1',
        status: 'completed',
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects mark_ready before upsert when checklist readiness is incomplete', async () => {
    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        previous_issues_reviewed: false,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備チェックリストが未完了のため ready へ進めません',
      details: {
        readiness_blockers: ['前回課題の確認'],
        onboarding_blockers: [],
        billing_blockers: [],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('upserts preparation and advances the schedule ready in the same transaction', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    const txConsentFindFirstMock = vi.fn().mockResolvedValue({ id: 'consent_1' });
    const txFirstVisitDocumentFindFirstMock = vi.fn().mockResolvedValue({
      id: 'first_doc_1',
      delivered_at: new Date('2026-03-26T00:00:00Z'),
    });
    const txManagementPlanFindFirstMock = vi.fn().mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      approved_at: new Date('2026-03-20T00:00:00Z'),
      next_review_date: null,
    });
    const txVisitRecordFindManyMock = vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]);
    const txMedicationCycleFindManyMock = vi.fn().mockResolvedValue([{ id: 'cycle_1' }]);

    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          findFirst: txVisitScheduleFindFirstMock,
        },
        consentRecord: {
          findFirst: txConsentFindFirstMock,
        },
        firstVisitDocument: {
          findFirst: txFirstVisitDocumentFindFirstMock,
        },
        managementPlan: {
          findFirst: txManagementPlanFindFirstMock,
        },
        visitRecord: {
          findMany: txVisitRecordFindManyMock,
        },
        medicationCycle: {
          findMany: txMedicationCycleFindManyMock,
        },
        billingEvidence: {
          findMany: vi.fn(),
        },
      }),
    );

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalled();
    expect(txVisitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: 'schedule_1',
        }),
      }),
    );
    expect(billingEvidenceBlockersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitSchedule: expect.objectContaining({
          findFirst: txVisitScheduleFindFirstMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        patientId: 'patient_1',
        visitRecordIds: ['visit_record_1'],
        cycleIds: ['cycle_1'],
      }),
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'schedule_1',
        org_id: 'org_1',
        version: 1,
        confirmed_at: null,
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-27T00:00:00Z'),
        schedule_status: 'planned',
      },
      data: {
        schedule_status: 'ready',
        pre_visit_checklist_completed: true,
        version: { increment: 1 },
      },
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-preparation:schedule_1',
        status: 'completed',
      }),
    );
  });

  it('returns a sanitized no-store 500 when the preparation transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw preparation transaction patient 山田 花子 token secret route memo'),
    );

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw preparation transaction');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects mark_ready when the schedule changed before the guarded ready update', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          findFirst: txVisitScheduleFindFirstMock,
        },
        consentRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
        },
        firstVisitDocument: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'first_doc_1',
            delivered_at: new Date('2026-03-26T00:00:00Z'),
          }),
        },
        managementPlan: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'plan_1',
            status: 'approved',
            approved_at: new Date('2026-03-20T00:00:00Z'),
            next_review_date: null,
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
        },
        medicationCycle: {
          findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        },
        billingEvidence: {
          findMany: vi.fn(),
        },
      }),
    );

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          schedule_status: 'planned',
          version: 1,
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('returns sanitized ready transition details when mark_ready is blocked after upsert', async () => {
    const txVisitScheduleFindFirstMock = vi
      .fn()
      .mockResolvedValue(buildReadyTransitionScheduleMock());
    billingEvidenceBlockersMock.mockResolvedValueOnce([
      {
        id: 'billing_evidence_secret',
        visit_record_id: 'visit_record_secret',
        blockers: [
          {
            key: 'missing_signed_receipt',
            reason: '署名確認が未完了です',
            action_label: '請求証跡を確認',
            severity: 'high',
          },
        ],
      },
    ]);
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        visitPreparation: {
          upsert: visitPreparationUpsertMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
          updateMany: visitScheduleUpdateManyMock,
          findFirst: txVisitScheduleFindFirstMock,
        },
        consentRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
        },
        firstVisitDocument: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'first_doc_1',
            delivered_at: new Date('2026-03-26T00:00:00Z'),
          }),
        },
        managementPlan: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'plan_1',
            status: 'approved',
            approved_at: new Date('2026-03-20T00:00:00Z'),
            next_review_date: null,
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
        },
        medicationCycle: {
          findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        },
        billingEvidence: {
          findMany: vi.fn(),
        },
      }),
    );

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        mark_ready: true,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備に未解決の止まっている理由があるため ready へ進めません',
      details: {
        billing_blockers: [
          {
            key: 'missing_signed_receipt',
            reason: '署名確認が未完了です',
            action_label: '請求証跡を確認',
            severity: 'high',
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('billing_evidence_secret');
    expect(JSON.stringify(body)).not.toContain('visit_record_secret');
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('stores route plan snapshots and assigns the selected vehicle resource', async () => {
    const routePlanSnapshot = {
      status: 'ok',
      travelMode: 'DRIVE',
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 900,
      vehicle_resource: {
        vehicle_id: 'vehicle_1',
        label: '社用車A',
        constraint_status: 'ok',
      },
    };

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: routePlanSnapshot,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        travel_mode: true,
        max_stops: true,
        max_route_duration_minutes: true,
      },
    });
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith({
      origin: {
        lat: 35.681236,
        lng: 139.767125,
        label: '本店',
      },
      travelMode: 'DRIVE',
      waypoints: [
        {
          scheduleId: 'schedule_1',
          patientName: '山田太郎',
          address: '東京都千代田区1-1',
          lat: 35.684,
          lng: 139.77,
          priority: 'normal',
          timeWindow: null,
          serviceMinutes: 60,
        },
      ],
    });
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_confirmed: true,
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
            orderedScheduleIds: ['schedule_1'],
            vehicle_resource: expect.objectContaining({
              vehicle_id: 'vehicle_1',
              constraint_status: 'ok',
            }),
          }),
        }),
        update: expect.objectContaining({
          route_confirmed: true,
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            orderedScheduleIds: ['schedule_1'],
          }),
        }),
      }),
    );
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: {
        vehicle_resource_id: 'vehicle_1',
        version: { increment: 1 },
      },
    });
  });

  it('does not assign a vehicle from a stale route snapshot when route is not confirmed', async () => {
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_confirmed: false,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
            label: '社用車A',
            constraint_status: 'ok',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_confirmed: false,
          prepared_at: null,
        }),
        update: expect.objectContaining({
          route_confirmed: false,
          prepared_at: null,
        }),
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('generates route plan snapshots on the server when no client snapshot is submitted', async () => {
    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        travelMode: 'DRIVE',
        waypoints: [
          expect.objectContaining({
            scheduleId: 'schedule_1',
            patientName: '山田太郎',
          }),
        ],
      }),
    );
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
          }),
        }),
        update: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            status: 'ok',
            generated_by: 'server',
            ordered_schedule_ids: ['schedule_1'],
          }),
        }),
      }),
    );
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('does not persist patient names or addresses in generated route notes for missing coordinates', async () => {
    peerVisitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        route_order: 1,
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.681236,
          lng: 139.767125,
        },
        case_: {
          patient: {
            name: '山田太郎',
            residences: [
              {
                address: '東京都千代田区1-1',
                lat: 35.684,
                lng: 139.77,
              },
            ],
          },
        },
      },
      {
        id: 'schedule_missing_coordinates',
        route_order: 2,
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.681236,
          lng: 139.767125,
        },
        case_: {
          patient: {
            name: '佐藤花子',
            residences: [
              {
                address: '東京都港区9-9',
                lat: null,
                lng: null,
              },
            ],
          },
        },
      },
    ]);

    const response = await PUT(createPutRequest(completePreparationBody), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          route_plan_snapshot: expect.objectContaining({
            note: 'ヒューリスティック順序を表示しています / 座標未設定: 1件',
            ordered_schedule_ids: ['schedule_1', 'schedule_missing_coordinates'],
          }),
        }),
      }),
    );
    const upsertPayload = visitPreparationUpsertMock.mock.calls[0]?.[0];
    const snapshotText = JSON.stringify(upsertPayload);
    expect(snapshotText).not.toContain('佐藤花子');
    expect(snapshotText).not.toContain('東京都港区9-9');
  });

  it('rejects route confirmation when the selected vehicle duration limit is exceeded', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValueOnce({
      status: 'ok',
      note: 'ヒューリスティック順序を表示しています',
      travelMode: 'DRIVE',
      origin: {
        lat: 35.681236,
        lng: 139.767125,
        label: '本店',
      },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 3 * 60 * 60,
      stopSummaries: [],
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した車両リソースの稼働上限を超えるためルート確認できません',
    });
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects route confirmation when selected vehicle capacity is exceeded after adding the current schedule', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 1,
      max_route_duration_minutes: 120,
    });
    peerVisitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_other',
          route_order: 1,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '田中一郎',
              residences: [
                {
                  address: '東京都千代田区2-2',
                  lat: 35.685,
                  lng: 139.771,
                },
              ],
            },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          route_order: 2,
          priority: 'normal',
          site: {
            id: 'site_1',
            name: '本店',
            lat: 35.681236,
            lng: 139.767125,
          },
          case_: {
            patient: {
              name: '山田太郎',
              residences: [
                {
                  address: '東京都千代田区1-1',
                  lat: 35.684,
                  lng: 139.77,
                },
              ],
            },
          },
        },
      ]);

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          vehicle_resource: {
            vehicle_id: 'vehicle_1',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects route snapshots that reference a vehicle from another schedule site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_2',
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        route_plan_snapshot: {
          status: 'ok',
          travelMode: 'DRIVE',
          orderedScheduleIds: ['schedule_1'],
          vehicle_resource: {
            vehicle_id: 'vehicle_2',
            label: '別拠点車両',
            constraint_status: 'ok',
          },
        },
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitPreparationUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('keeps the readiness gate blocked when previous issues are not reviewed', async () => {
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: false,
      route_confirmed: true,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        previous_issues_reviewed: false,
      }),
      {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          previous_issues_reviewed: false,
          prepared_at: null,
        }),
        update: expect.objectContaining({
          previous_issues_reviewed: false,
          prepared_at: null,
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_preparation',
        assignedTo: 'user_1',
        dedupeKey: 'visit-preparation:schedule_1',
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        previous_issues_reviewed: false,
        prepared_at: null,
      },
    });
  });

  it.each(['partial', 'blocked'] as const)(
    'keeps preparation incomplete when carry items status is %s even if checklist fields are complete',
    async (carryItemsStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce(
        buildPutScheduleMock({ carry_items_status: carryItemsStatus }),
      );
      visitPreparationUpsertMock.mockResolvedValueOnce({
        id: 'prep_1',
        schedule_id: 'schedule_1',
        checklist: {},
        medication_changes_reviewed: true,
        carry_items_confirmed: true,
        previous_issues_reviewed: true,
        route_confirmed: true,
        offline_synced: true,
        prepared_by: 'user_1',
        prepared_at: null,
      });

      const response = await PUT(createPutRequest(completePreparationBody), {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            carry_items_status: true,
          }),
        }),
      );
      expect(visitPreparationUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            prepared_at: null,
          }),
          update: expect.objectContaining({
            prepared_at: null,
          }),
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org_1',
          taskType: 'visit_preparation',
          assignedTo: 'user_1',
          dedupeKey: 'visit-preparation:schedule_1',
          description: '未完了: 持参物ステータス未解決',
        }),
      );
      expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        data: {
          prepared_at: null,
        },
      });
    },
  );

  it('prioritizes unresolved carry item status in incomplete preparation task descriptions', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(
      buildPutScheduleMock({ carry_items_status: 'partial' }),
    );
    visitPreparationUpsertMock.mockResolvedValueOnce({
      id: 'prep_1',
      schedule_id: 'schedule_1',
      checklist: {},
      medication_changes_reviewed: true,
      carry_items_confirmed: false,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
      prepared_by: 'user_1',
      prepared_at: null,
    });

    const response = await PUT(
      createPutRequest({
        ...completePreparationBody,
        carry_items_confirmed: false,
        route_confirmed: false,
      }),
      { params: Promise.resolve({ scheduleId: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: '未完了: 持参物ステータス未解決、持参薬・物品確認、ルート確認',
      }),
    );
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });
});
