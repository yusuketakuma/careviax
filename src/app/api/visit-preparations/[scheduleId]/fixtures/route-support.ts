import { NextRequest } from 'next/server';
import { vi } from 'vitest';

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
  createAuditLogEntryMock,
  computeOptimizedVisitRouteMock,
  notifyWorkflowMutationMock,
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
  createAuditLogEntryMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
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

export const visitPreparationRouteTestMocks = {
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
  createAuditLogEntryMock,
  computeOptimizedVisitRouteMock,
  notifyWorkflowMutationMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
};

export {
  createRequest,
  createPutRequest,
  createMalformedJsonPutRequest,
  completePreparationBody,
  buildPutScheduleMock,
  buildReadyTransitionScheduleMock,
};

export function setupVisitPreparationGetMocks() {
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
}

export function setupVisitPreparationPutMocks() {
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
  createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  notifyWorkflowMutationMock.mockResolvedValue(undefined);
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
        findMany: peerVisitScheduleFindManyMock,
      },
    }),
  );
  upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
  resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
}
