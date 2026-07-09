import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import {
  attachLocalSession,
  AUTH_SECRET,
  createInstrumentedPage,
  LOCAL_USER,
  openStableRoute,
} from './helpers/local-auth';
import {
  apiPathPattern,
  captureRouteRequest,
  fulfillJson,
  readRouteBody,
  type CapturedRouteRequest,
} from './helpers/route-mocks';

const SHARED_TOKEN = 'shared-route-mock-token';
const SHARED_OTP = '472913';
const BILLING_MONTH = '2026-04-01';
const BILLING_PATIENT_ID = 'billing_route_mock_patient';
const OFFLINE_SCHEDULE_ID = 'offline_route_mock_schedule';
const OFFLINE_PATIENT_ID = 'offline_route_mock_patient';
const FORMULARY_SITE_ID = 'formulary_route_mock_site';
const FORMULARY_DRUG_ID = 'formulary_route_mock_drug';
const FORMULARY_GENERIC_ID = 'formulary_route_mock_generic';
const OFFLINE_DB_NAME = 'PH-OSOffline';
const OFFLINE_KEY_DB_NAME = 'ph-os-offline-keys';
const OFFLINE_KEY_STORE_NAME = 'crypto-keys';
const OFFLINE_KEY_RECORD_ID = 'offline-enc-key-v2';
const GANTT_DATE = '2026-04-29';
const GANTT_SITE_ID = 'gantt_route_mock_site';
const GANTT_PHARMACIST_A_ID = 'gantt_route_mock_pharmacist_a';
const GANTT_PHARMACIST_B_ID = 'gantt_route_mock_pharmacist_b';
const PROPOSAL_BULK_DATE = '2026-05-08';
const PROPOSAL_BULK_SITE_ID = 'proposal_bulk_route_mock_site';
const PROPOSAL_BULK_PHARMACIST_ID = 'proposal_bulk_route_mock_pharmacist';
const PROPOSAL_BULK_VEHICLE_ID = 'proposal_bulk_route_mock_vehicle';
const PROPOSAL_BULK_SUCCESS_ID = 'proposal_bulk_route_mock_success';
const PROPOSAL_BULK_FAILURE_ID = 'proposal_bulk_route_mock_failure';
const PROPOSAL_BULK_REJECT_REASON = '患者都合で訪問候補を見直し';
const PROPOSAL_BULK_UNSAFE_ERROR_MESSAGE =
  '勤務枠が埋まりました 東京都新宿区9-9-9 090-1234-5678 アムロジピン 処方詳細';
const PROPOSAL_SEARCH_CASE_A_ID = 'case_search_a';
const PROPOSAL_SEARCH_CASE_B_ID = 'case_search_b';
const PROPOSAL_SEARCH_PATIENT_A_ID = 'patient_search_a';
const PROPOSAL_SEARCH_PATIENT_B_ID = 'patient_search_b';
const PROPOSAL_SEARCH_A_ID = 'proposal_search_a';
const PROPOSAL_SEARCH_B_ID = 'proposal_search_b';
const PHARMACY_COOP_PATIENT_ID = 'pharmacy_coop_route_patient';
const PHARMACY_COOP_CASE_ID = 'pharmacy_coop_route_case';
const PHARMACY_COOP_MANAGEMENT_PLAN_ID = 'pharmacy_coop_route_plan';
const PHARMACY_COOP_PARTNERSHIP_ID = 'pharmacy_coop_route_partnership';
const PHARMACY_COOP_PARTNER_PHARMACY_ID = 'pharmacy_coop_route_partner';
const PHARMACY_COOP_CONTRACT_ID = 'pharmacy_coop_route_contract';
const PHARMACY_COOP_CONTRACT_VERSION_ID = 'pharmacy_coop_route_contract_version';
const PHARMACY_COOP_SHARE_CASE_ID = 'pharmacy_coop_route_share_case';
const PHARMACY_COOP_SHARE_CONSENT_ID = 'pharmacy_coop_route_share_consent';
const PHARMACY_COOP_VISIT_REQUEST_ID = 'pharmacy_coop_route_visit_request';
const PHARMACY_COOP_PARTNER_RECORD_ID = 'pharmacy_coop_route_partner_record';
const PHARMACY_COOP_REPORT_ID = 'pharmacy_coop_route_report';
const PHARMACY_COOP_BILLING_CANDIDATE_ID = 'pharmacy_coop_route_candidate';
const PHARMACY_COOP_INVOICE_ID = 'pharmacy_coop_route_invoice';
const PHARMACY_COOP_SHARE_MESSAGE_THREAD_ID = 'pharmacy_coop_route_share_message_thread';
const PHARMACY_COOP_VISIT_MESSAGE_THREAD_ID = 'pharmacy_coop_route_visit_message_thread';
const PHARMACY_COOP_BILLING_MONTH = '2026-06-01';

test.use({ serviceWorkers: 'block' });

function summarizeAxeViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    nodes: Array<{ target: unknown }>;
  }>,
) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    targets: violation.nodes
      .flatMap((node) => {
        if (Array.isArray(node.target)) {
          return node.target.map((item) => String(item));
        }

        return [String(node.target)];
      })
      .slice(0, 6),
  }));
}

async function attachRouteMockSession(context: Parameters<typeof attachLocalSession>[0]) {
  const token = await encode({
    secret: AUTH_SECRET,
    token: {
      userId: 'route_mock_user',
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
      cognitoSub: LOCAL_USER.cognitoSub,
      sessionVersion: LOCAL_USER.sessionVersion,
      sub: LOCAL_USER.cognitoSub,
    },
    maxAge: 30 * 60,
  });

  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function seedOfflineEncryptionKey(page: Page) {
  await page.evaluate(
    async ({ dbName, storeName, recordId }) => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);

      await new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open(dbName, 1);

        openRequest.onupgradeneeded = () => {
          const db = openRequest.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };

        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(key, recordId);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    },
    {
      dbName: OFFLINE_KEY_DB_NAME,
      recordId: OFFLINE_KEY_RECORD_ID,
      storeName: OFFLINE_KEY_STORE_NAME,
    },
  );
}

async function readOfflineVisitDraftState(page: Page, scheduleId: string) {
  return page.evaluate(
    async ({ dbName, targetScheduleId }) =>
      new Promise<{
        draftStructuredSoap: string | null;
        draftContainsPlaintext: boolean;
        queuePayload: string | null;
        queueContainsPlaintext: boolean;
        queueEntityType: string | null;
        queueScopeId: string | null;
      }>((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          const tx = db.transaction(['visitDrafts', 'syncQueue'], 'readonly');
          const draftsRequest = tx.objectStore('visitDrafts').getAll();
          const queueRequest = tx.objectStore('syncQueue').getAll();

          tx.oncomplete = () => {
            const drafts = draftsRequest.result as Array<{
              scheduleId?: string;
              structuredSoap?: string;
            }>;
            const queue = queueRequest.result as Array<{
              entityType?: string;
              payload?: string;
              scope_id?: string;
            }>;
            const draft = drafts.find((item) => item.scheduleId === targetScheduleId);
            const queueItem = queue.find((item) => item.scope_id === targetScheduleId);
            const plaintextNeedle = 'Offline route-mocked S';

            db.close();
            resolve({
              draftStructuredSoap: draft?.structuredSoap ?? null,
              draftContainsPlaintext: Boolean(draft?.structuredSoap?.includes(plaintextNeedle)),
              queuePayload: queueItem?.payload ?? null,
              queueContainsPlaintext: Boolean(queueItem?.payload?.includes(plaintextNeedle)),
              queueEntityType: queueItem?.entityType ?? null,
              queueScopeId: queueItem?.scope_id ?? null,
            });
          };

          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { dbName: OFFLINE_DB_NAME, targetScheduleId: scheduleId },
  );
}

function buildGanttSchedule(args: {
  id: string;
  patientId: string;
  patientName: string;
  address: string;
  unitName?: string;
  pharmacistId: string;
  routeOrder: number;
  start: string;
  end: string;
  status?: 'planned' | 'in_preparation' | 'ready' | 'departed' | 'in_progress' | 'completed';
  priority?: 'normal' | 'urgent' | 'emergency';
  prepared?: boolean;
}) {
  return {
    id: args.id,
    case_id: `${args.id}_case`,
    visit_type: 'regular',
    priority: args.priority ?? 'normal',
    schedule_status: args.status ?? 'ready',
    carry_items_status: 'ready',
    scheduled_date: `${GANTT_DATE}T00:00:00`,
    time_window_start: `${GANTT_DATE}T${args.start}:00`,
    time_window_end: `${GANTT_DATE}T${args.end}:00`,
    pharmacist_id: args.pharmacistId,
    assignment_mode: 'primary',
    route_order: args.routeOrder,
    facility_batch_id: null,
    confirmed_at: `${GANTT_DATE}T07:30:00`,
    case_: {
      patient: {
        id: args.patientId,
        name: args.patientName,
        residences: [
          {
            address: args.address,
            building_id: null,
            unit_name: args.unitName ?? null,
            lat: null,
            lng: null,
          },
        ],
      },
    },
    site: {
      id: GANTT_SITE_ID,
      name: 'RouteMock 中央薬局',
      address: '東京都千代田区丸の内1-1-1',
      lat: null,
      lng: null,
    },
    vehicle_resource: null,
    preparation: {
      id: `${args.id}_preparation`,
      prepared_at: args.prepared ? `${GANTT_DATE}T07:45:00` : null,
      medication_changes_reviewed: args.prepared ?? false,
      carry_items_confirmed: args.prepared ?? false,
      previous_issues_reviewed: args.prepared ?? false,
      route_confirmed: args.prepared ?? false,
      offline_synced: true,
      checklist: {},
    },
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 6,
      urgent_visit_count: args.priority === 'urgent' || args.priority === 'emergency' ? 1 : 0,
    },
    handoff_hint: null,
  };
}

const GANTT_ROUTE_MOCK_SCHEDULES = [
  buildGanttSchedule({
    id: 'gantt_route_mock_same_start_1',
    patientId: 'gantt_patient_same_start_1',
    patientName: 'ガントE2E 同時A',
    address: '東京都千代田区丸の内1-2-3 RouteMockビル 101号室',
    unitName: '101号室',
    pharmacistId: GANTT_PHARMACIST_A_ID,
    routeOrder: 1,
    start: '08:30',
    end: '09:30',
    prepared: true,
  }),
  buildGanttSchedule({
    id: 'gantt_route_mock_same_start_2',
    patientId: 'gantt_patient_same_start_2',
    patientName: 'ガントE2E 同時B',
    address: '東京都千代田区丸の内1-2-3 RouteMockビル 102号室',
    unitName: '102号室',
    pharmacistId: GANTT_PHARMACIST_A_ID,
    routeOrder: 2,
    start: '08:30',
    end: '09:30',
    status: 'in_preparation',
  }),
  buildGanttSchedule({
    id: 'gantt_route_mock_a_later',
    patientId: 'gantt_patient_a_later',
    patientName: 'ガントE2E 後続確認',
    address: '東京都中央区日本橋2-2-2 RouteMockレジデンス 1501号室',
    unitName: '1501号室',
    pharmacistId: GANTT_PHARMACIST_A_ID,
    routeOrder: 3,
    start: '10:30',
    end: '11:30',
    status: 'departed',
    prepared: true,
  }),
  buildGanttSchedule({
    id: 'gantt_route_mock_overlap_1',
    patientId: 'gantt_patient_overlap_1',
    patientName: 'ガントE2E 重なり長い患者名一号',
    address: '東京都港区芝公園4-2-8 とても長い住所確認用マンション 西棟 2301号室',
    unitName: '西棟2301号室',
    pharmacistId: GANTT_PHARMACIST_B_ID,
    routeOrder: 1,
    start: '09:30',
    end: '10:30',
    priority: 'urgent',
  }),
  buildGanttSchedule({
    id: 'gantt_route_mock_overlap_2',
    patientId: 'gantt_patient_overlap_2',
    patientName: 'ガントE2E 追従長い患者名二号',
    address: '東京都港区芝公園4-2-8 とても長い住所確認用マンション 東棟 2402号室',
    unitName: '東棟2402号室',
    pharmacistId: GANTT_PHARMACIST_B_ID,
    routeOrder: 2,
    start: '10:00',
    end: '11:00',
    prepared: true,
  }),
  buildGanttSchedule({
    id: 'gantt_route_mock_overlap_3',
    patientId: 'gantt_patient_overlap_3',
    patientName: 'ガントE2E 連鎖重なり三号',
    address: '東京都港区芝公園4-2-8 とても長い住所確認用マンション 南棟 2503号室',
    unitName: '南棟2503号室',
    pharmacistId: GANTT_PHARMACIST_B_ID,
    routeOrder: 3,
    start: '10:30',
    end: '11:30',
    status: 'completed',
    prepared: true,
  }),
];

function buildGanttDayBoardResponse() {
  const totalVisitCount = GANTT_ROUTE_MOCK_SCHEDULES.length;
  const totalPreparationAttentionCount = GANTT_ROUTE_MOCK_SCHEDULES.filter(
    (schedule) => schedule.preparation.prepared_at == null,
  ).length;
  const toBoardVisit = (schedule: (typeof GANTT_ROUTE_MOCK_SCHEDULES)[number]) => {
    const ready = schedule.preparation.prepared_at != null;

    return {
      id: schedule.id,
      patient_name: schedule.case_.patient.name,
      visit_type: schedule.visit_type,
      schedule_status: schedule.schedule_status,
      priority: schedule.priority,
      site_id: schedule.site.id,
      route_order: schedule.route_order,
      time_start: schedule.time_window_start,
      time_end: schedule.time_window_end,
      vehicle_resource_id: null,
      vehicle_label: null,
      vehicle_travel_mode: null,
      confirmed: schedule.confirmed_at != null,
      facility_label: null,
      facility_batch_id: null,
      facility_patient_count: 1,
      preparation_summary: {
        completed_count: ready ? 5 : 2,
        total_count: 5,
        status: ready ? 'ready' : 'incomplete',
        incomplete_labels: ready ? [] : ['持参薬・物品確認', 'ルート確認'],
      },
    };
  };

  return {
    generated_at: `${GANTT_DATE}T08:00:00.000Z`,
    date: GANTT_DATE,
    staff: [
      {
        id: GANTT_PHARMACIST_A_ID,
        name: '薬剤師A',
        role: 'pharmacist',
        role_kind: 'pharmacist',
        visits: GANTT_ROUTE_MOCK_SCHEDULES.filter(
          (schedule) => schedule.pharmacist_id === GANTT_PHARMACIST_A_ID,
        ).map(toBoardVisit),
        open_task_count: 0,
        audit_task_count: 1,
      },
      {
        id: GANTT_PHARMACIST_B_ID,
        name: '薬剤師B',
        role: 'pharmacist',
        role_kind: 'pharmacist',
        visits: GANTT_ROUTE_MOCK_SCHEDULES.filter(
          (schedule) => schedule.pharmacist_id === GANTT_PHARMACIST_B_ID,
        ).map(toBoardVisit),
        open_task_count: 0,
        audit_task_count: 0,
      },
    ],
    staff_counts: {
      total_count: 2,
      visible_count: 2,
      hidden_count: 0,
      total_visit_count: totalVisitCount,
      visible_visit_count: totalVisitCount,
      hidden_visit_count: 0,
      total_preparation_attention_count: totalPreparationAttentionCount,
      visible_preparation_attention_count: totalPreparationAttentionCount,
      hidden_preparation_attention_count: 0,
      hidden_operational_task_count: 0,
      limit: 2,
    },
    audit_pending_count: 1,
    report_pending_count: 0,
    vehicle_resources: [
      {
        id: 'gantt_route_mock_vehicle',
        label: 'RouteMock 軽バン',
        site_id: GANTT_SITE_ID,
        vehicle_code: 'GANTT-001',
        travel_mode: 'DRIVE',
        available: true,
        max_stops: 8,
        assigned_visit_count: 0,
        remaining_stops: 8,
        recommended: true,
        recommendation_reason: '未割当訪問を受けられます',
      },
    ],
    pending_proposals: [],
    pending_proposal_counts: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 0,
      hidden_operational_task_count: 0,
    },
    operational_tasks: [],
  };
}

function buildGanttPreparationDetails(scheduleId: string) {
  const schedule = GANTT_ROUTE_MOCK_SCHEDULES.find((item) => item.id === scheduleId);
  if (!schedule) return null;

  return {
    preparation: schedule.preparation,
    pack: {
      patient: {
        id: schedule.case_.patient.id,
        name: schedule.case_.patient.name,
        address: schedule.case_.patient.residences[0]?.address ?? null,
      },
      visit: {
        id: schedule.id,
        scheduled_date: schedule.scheduled_date,
        time_window_start: schedule.time_window_start,
        time_window_end: schedule.time_window_end,
        visit_type: schedule.visit_type,
        schedule_status: schedule.schedule_status,
        priority: schedule.priority,
        confirmed_at: schedule.confirmed_at,
      },
      site: schedule.site,
      handoff: {
        assignment_mode: schedule.assignment_mode,
        summary: 'RouteMock Gantt preparation handoff',
      },
      readiness_blockers: [],
      previous_visit: null,
      open_tasks: [],
      recent_contact_logs: [],
      facility_mode: {
        label: null,
        same_day_patient_count: 1,
        same_day_patient_names: [schedule.case_.patient.name],
        route_orders: [schedule.route_order].filter((order): order is number => order !== null),
      },
      facility_parallel_context: null,
      workload: {
        same_day_visit_count: 6,
      },
      care_team: [],
      conference_context: [],
      billing_blockers: [],
      prescription_changes: null,
      medication_period: {
        schedule_start_date: GANTT_DATE,
        schedule_end_date: GANTT_DATE,
        prescription_start_date: null,
        prescription_end_date: null,
      },
      home_care_feature_highlights: [],
      visit_brief: {
        patient: {
          id: schedule.case_.patient.id,
          name: schedule.case_.patient.name,
        },
        context: 'schedule',
        generated_at: `${GANTT_DATE}T00:00:00.000Z`,
        last_prescribed_date: null,
        baseline_context: null,
        medication_changes: [],
        medications: [],
        dispensing_items: [],
        delivery_status: [],
        dosage_form_support: [],
        multidisciplinary_updates: [],
        jahis_supplemental_records: [],
        unresolved_items: [],
        must_check_today: [],
        rule_summary: {
          generation_id: 'gantt_route_mock_rule',
          headline: 'RouteMock確認事項なし',
          bullets: [],
          must_check_today: [],
          source_refs: [],
          generated_at: `${GANTT_DATE}T00:00:00.000Z`,
        },
        ai_summary: {
          generation_id: 'gantt_route_mock_ai',
          provider: 'rule',
          requested_provider: 'rule',
          is_fallback: true,
          model: null,
          fallback_reason: null,
          headline: 'RouteMock確認事項なし',
          bullets: [],
          must_check_today: [],
          source_refs: [],
          generated_at: `${GANTT_DATE}T00:00:00.000Z`,
          duration_ms: null,
          recent_generation_count_24h: 0,
          recent_failure_count_24h: 0,
          recent_failure_rate_24h: null,
        },
        conference_summary: null,
        facility_context: null,
        drug_cautions: [],
      },
      onboarding_readiness: {
        consent_obtained: true,
        emergency_contact_set: true,
        first_visit_doc_delivered: true,
        management_plan_approved: true,
        primary_physician_set: true,
      },
      intake_context: {
        initial_transition_management_expected: null,
      },
      emergency_contacts: [],
      first_visit_document: null,
    },
  };
}

function buildProposalBulkRouteMockProposal(args: {
  id: string;
  caseId: string;
  patientId: string;
  patientName: string;
  address: string;
  routeOrder: number;
  start: string;
  end: string;
}) {
  return {
    id: args.id,
    case_id: args.caseId,
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: `${PROPOSAL_BULK_DATE}T00:00:00`,
    time_window_start: `${PROPOSAL_BULK_DATE}T${args.start}:00`,
    time_window_end: `${PROPOSAL_BULK_DATE}T${args.end}:00`,
    proposed_pharmacist_id: PROPOSAL_BULK_PHARMACIST_ID,
    proposed_pharmacist: {
      id: PROPOSAL_BULK_PHARMACIST_ID,
      name: '薬剤師A',
      name_kana: null,
    },
    assignment_mode: 'primary',
    route_order: args.routeOrder,
    route_distance_score: 1.4,
    medication_end_date: null,
    visit_deadline_date: '2026-05-12',
    proposal_reason: '移動良好',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: args.patientId,
        name: args.patientName,
        residences: [
          {
            address: args.address,
            building_id: null,
            unit_name: null,
            lat: null,
            lng: null,
          },
        ],
      },
    },
    site: {
      id: PROPOSAL_BULK_SITE_ID,
      name: 'RouteMock 提案薬局',
      address: '東京都千代田区丸の内1-1-1',
      lat: 35.6812,
      lng: 139.7671,
    },
    vehicle_resource: {
      id: PROPOSAL_BULK_VEHICLE_ID,
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 6,
      max_route_duration_minutes: 180,
    },
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
  };
}

const PROPOSAL_BULK_ROUTE_MOCK_PROPOSALS = [
  buildProposalBulkRouteMockProposal({
    id: PROPOSAL_BULK_SUCCESS_ID,
    caseId: 'proposal_bulk_route_mock_case_success',
    patientId: 'proposal_bulk_route_mock_patient_success',
    patientName: '山田花子',
    address: '東京都千代田区1-1-1 RouteMock 101号室',
    routeOrder: 1,
    start: '09:00',
    end: '10:00',
  }),
  buildProposalBulkRouteMockProposal({
    id: PROPOSAL_BULK_FAILURE_ID,
    caseId: 'proposal_bulk_route_mock_case_failure',
    patientId: 'proposal_bulk_route_mock_patient_failure',
    patientName: '佐藤太郎',
    address: '東京都中央区2-2-2 RouteMock 202号室',
    routeOrder: 2,
    start: '10:30',
    end: '11:30',
  }),
];

const PROPOSAL_SEARCH_ROUTE_MOCK_PROPOSALS = [
  buildProposalBulkRouteMockProposal({
    id: PROPOSAL_SEARCH_A_ID,
    caseId: PROPOSAL_SEARCH_CASE_A_ID,
    patientId: PROPOSAL_SEARCH_PATIENT_A_ID,
    patientName: '佐藤太郎',
    address: '東京都千代田区1-1-1 RouteMock 101号室',
    routeOrder: 1,
    start: '09:00',
    end: '10:00',
  }),
  buildProposalBulkRouteMockProposal({
    id: PROPOSAL_SEARCH_B_ID,
    caseId: PROPOSAL_SEARCH_CASE_B_ID,
    patientId: PROPOSAL_SEARCH_PATIENT_B_ID,
    patientName: '佐藤太郎',
    address: '東京都中央区2-2-2 RouteMock 202号室',
    routeOrder: 2,
    start: '10:30',
    end: '11:30',
  }),
];

function shortEntityIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return '未設定';
  const withoutKnownPrefix = normalized.replace(/^(proposal|case|patient)[_-]/u, '');
  const candidate = withoutKnownPrefix || normalized;
  return candidate.length <= 8 ? candidate : candidate.slice(-8);
}

function proposalBulkTargetName(
  patientName: string,
  timeRange: string,
  ids: { caseId: string; proposalId: string },
) {
  return `${patientName} 2026/05/08 ${timeRange} / 薬剤師A / 社用車A / ケース ${shortEntityIdentifier(ids.caseId)} / 候補 ${shortEntityIdentifier(ids.proposalId)}`;
}

async function expectMinTouchBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a rendered bounding box`).not.toBeNull();
  expect(box!.width, `${label} width should be at least 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} height should be at least 44px`).toBeGreaterThanOrEqual(44);
}

function buildProposalBulkRouteMockDetail(
  proposal: (typeof PROPOSAL_BULK_ROUTE_MOCK_PROPOSALS)[number],
) {
  return {
    ...proposal,
    related_proposals: [],
    pharmacist_day_schedules: [],
    route_preview: {
      plan: {
        status: 'unavailable',
        note: 'Route mock detail does not calculate a map route.',
        travelMode: 'DRIVE',
        origin: null,
        encodedPath: null,
        orderedScheduleIds: [],
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        stopSummaries: [],
      },
      points: [],
      site: {
        name: proposal.site.name,
        lat: proposal.site.lat,
        lng: proposal.site.lng,
      },
    },
    creation_diagnostics: null,
  };
}

async function expectNoVisibleBoxOverlap(locator: Locator) {
  const boxes = await locator.evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') ?? element.textContent ?? '',
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((box) => box.width > 0 && box.height > 0),
  );

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex]!;
      const right = boxes[rightIndex]!;
      const overlaps =
        left.left < right.right - 1 &&
        left.right > right.left + 1 &&
        left.top < right.bottom - 1 &&
        left.bottom > right.top + 1;

      expect(
        overlaps,
        `Gantt blocks should not visually overlap: "${left.label}" vs "${right.label}"`,
      ).toBe(false);
    }
  }
}

async function expectNoPageHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
    };
  });

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function installSharedViewerRouteMock(page: Page) {
  const viewerRequests: CapturedRouteRequest[] = [];
  const selfReportRequests: CapturedRouteRequest[] = [];

  await page.route(
    apiPathPattern(`/api/external-access/${SHARED_TOKEN}/self-report`),
    async (route) => {
      selfReportRequests.push(captureRouteRequest(route));
      await fulfillJson(route, { data: { id: 'shared_route_mock_self_report' } }, 201);
    },
  );

  await page.route(apiPathPattern(`/api/external-access/${SHARED_TOKEN}`), async (route) => {
    viewerRequests.push(captureRouteRequest(route));
    await fulfillJson(route, {
      data: {
        patient: {
          id: 'shared_route_mock_patient',
          name: '共有E2E 患者',
          birth_date: '1948-04-10',
          gender: 'female',
        },
        allergy_info: 'ペニシリン',
        medication_profiles: [
          {
            id: 'shared_med_1',
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '朝食後',
            start_date: '2026-04-01',
            end_date: null,
            is_current: true,
          },
        ],
        visit_schedules: [],
        care_reports: [],
        self_report_history: [],
        shared_summary: {
          headline: '血圧と服薬状況を家族と共有',
          bullets: ['朝食後の服薬は継続できています'],
          key_medications: ['アムロジピン'],
          next_visit_date: '2026-04-30',
        },
        scope: {
          allergy_info: true,
          medication_profiles: true,
          visit_schedules: true,
          care_reports: false,
          self_report_history: true,
          shared_summary: true,
        },
        expires_at: '2026-05-01T09:00:00.000Z',
      },
    });
  });

  return { selfReportRequests, viewerRequests };
}

async function installDashboardShellRouteMocks(page: Page) {
  await page.route(apiPathPattern('/api/notifications/stream'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('summary') === '1') {
      await fulfillJson(route, { data: { unreadCount: 0 } });
      return;
    }
    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });

  await page.route(apiPathPattern('/api/nav-badges'), async (route) => {
    await fulfillJson(route, { data: { audit: 0, handoff: 0 } });
  });

  await page.route(apiPathPattern('/api/presence'), async (route) => {
    await fulfillJson(
      route,
      route.request().method() === 'POST' ? { data: { ok: true } } : { data: [] },
    );
  });
}

function buildPharmacyCoopVisitBrief() {
  return {
    patient: {
      id: PHARMACY_COOP_PATIENT_ID,
      name: '薬局間RouteMock 患者',
    },
    context: 'patient',
    generated_at: '2026-06-19T00:00:00.000Z',
    last_prescribed_date: null,
    baseline_context: null,
    medication_changes: [],
    patient_changes: [],
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
    jahis_supplemental_records: [],
    unresolved_items: [],
    must_check_today: [],
    rule_summary: {
      generation_id: 'pharmacy_coop_route_rule',
      headline: '確認事項はありません',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-06-19T00:00:00.000Z',
    },
    ai_summary: {
      generation_id: 'pharmacy_coop_route_ai',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: null,
      headline: '確認事項はありません',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-06-19T00:00:00.000Z',
      duration_ms: null,
      recent_generation_count_24h: 0,
      recent_failure_count_24h: 0,
      recent_failure_rate_24h: null,
    },
    conference_summary: null,
    facility_context: null,
    drug_cautions: [],
  };
}

function buildPharmacyCoopPatientOverview() {
  return {
    id: PHARMACY_COOP_PATIENT_ID,
    name: '薬局間RouteMock 患者',
    name_kana: 'ヤッキョクカンルートモック カンジャ',
    birth_date: '1942-04-12',
    gender: 'female',
    phone: '090-1111-2222',
    medical_insurance_number: null,
    care_insurance_number: null,
    billing_support_flag: true,
    allergy_info: [],
    notes: null,
    archived_at: null,
    archived_by: null,
    archived_by_name: null,
    residences: [
      {
        id: 'pharmacy_coop_route_residence',
        address: '東京都千代田区RouteMock 101',
        building_id: null,
        facility_id: null,
        facility_unit_id: null,
        unit_name: '101',
        is_primary: true,
      },
    ],
    scheduling_preference: null,
    conditions: [],
    cases: [
      {
        id: PHARMACY_COOP_CASE_ID,
        status: 'active',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        referral_source: null,
        referral_date: null,
        start_date: '2026-06-01',
        end_date: null,
        end_reason: null,
        notes: null,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-18T00:00:00.000Z',
        required_visit_support: null,
        care_team_links: [],
      },
    ],
    visit_schedules: [],
    summary_metrics: { open_tasks_count: 0 },
    risk_summary: null,
    visit_brief: buildPharmacyCoopVisitBrief(),
    lab_summary: [],
    foundation: {
      summary: { status: 'ready', label: '確認済み', items: [] },
      items: [],
      changes_since_last_visit: [],
      latest_labs: [],
      insurances: [],
      archive: {
        archived: false,
        archived_at: null,
        archived_by_name: null,
      },
    },
    jahis_supplemental_records: [],
    workspace: null,
    privacy: {
      sensitive_fields_masked: false,
      address_fields_masked: false,
      can_view_detail: true,
    },
  };
}

function buildPharmacyCoopDocumentsSnapshot() {
  return {
    patient: {
      id: PHARMACY_COOP_PATIENT_ID,
      name: '薬局間RouteMock 患者',
      name_kana: 'ヤッキョクカンルートモック カンジャ',
    },
    print_readiness: {
      overall_status: 'ready',
      missing_required_count: 0,
      warning_count: 0,
      template_versions: [
        {
          document_type: 'contract',
          label: '契約書',
          template_id: 'template_pharmacy_coop_contract',
          template_name: '薬局間RouteMock契約書',
          template_version: 'v1',
          effective_from: '2026-06-01T00:00:00.000Z',
          effective_to: null,
        },
      ],
      checks: [
        {
          key: 'patient_profile',
          label: '患者基本情報',
          completed: true,
          severity: 'required',
          description: '氏名と生年月日を確認済みです。',
          action_href: `/patients/${PHARMACY_COOP_PATIENT_ID}/edit`,
          action_label: '基本情報を編集',
        },
      ],
    },
    document_statuses: [
      {
        document_type: 'contract',
        label: '契約書',
        status: 'created',
        status_label: '作成済み',
        template_name: '薬局間RouteMock契約書',
        template_version: 'v1',
        storage_location: '店舗',
        latest_action_at: '2026-06-19T00:00:00.000Z',
        latest_printed_at: '2026-06-19T00:00:00.000Z',
        latest_print_batch_id: 'print_pharmacy_coop_route_batch',
        latest_document_id: 'doc_pharmacy_coop_route',
        has_file: true,
        delivered_at: null,
        alerts: [],
      },
    ],
    first_visit_documents: [],
  };
}

function buildPharmacyCoopShareCase(args: {
  created: boolean;
  status: string;
  baseApproved: boolean;
  partnerAccepted: boolean;
}) {
  if (!args.created) return null;

  return {
    id: PHARMACY_COOP_SHARE_CASE_ID,
    status: args.status,
    starts_at: '2026-06-20T00:00:00.000Z',
    ends_at: '2026-12-31T00:00:00.000Z',
    updated_at: '2026-06-19T00:00:00.000Z',
    partnership: {
      id: PHARMACY_COOP_PARTNERSHIP_ID,
      status: 'active',
      partner_pharmacy: {
        id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
        name: 'RouteMock協力薬局',
        status: 'active',
      },
    },
    patient_link: {
      id: 'pharmacy_coop_route_patient_link',
      match_status: args.partnerAccepted ? 'accepted' : 'pending',
      approved_by_base: args.baseApproved ? 'route_base_user' : null,
      approved_by_partner: args.partnerAccepted ? 'route_partner_user' : null,
      accepted_at: args.partnerAccepted ? '2026-06-19T01:00:00.000Z' : null,
      declined_at: null,
      has_partner_patient_id: args.partnerAccepted,
    },
  };
}

function buildPharmacyCoopConsent(created: boolean) {
  if (!created) return null;

  return {
    id: PHARMACY_COOP_SHARE_CONSENT_ID,
    share_case_id: PHARMACY_COOP_SHARE_CASE_ID,
    consent_record_id: 'pharmacy_coop_route_consent_record',
    consent_date: '2026-06-19T00:00:00.000Z',
    consent_method: 'paper_scan',
    scope_keys: ['pdf_output', 'attachments'],
    has_file_asset: true,
    valid_until: '2026-12-31T00:00:00.000Z',
    revoked_at: null,
    revoked_by: null,
    created_by: 'route_base_user',
    created_at: '2026-06-19T00:00:00.000Z',
    updated_at: '2026-06-19T00:00:00.000Z',
  };
}

function buildPharmacyCoopVisitRequest(args: { created: boolean; status: string }) {
  if (!args.created) return null;

  return {
    id: PHARMACY_COOP_VISIT_REQUEST_ID,
    share_case_id: PHARMACY_COOP_SHARE_CASE_ID,
    urgency: 'emergency',
    desired_start_at: '2026-06-20T01:30:00.000Z',
    desired_end_at: '2026-06-20T02:30:00.000Z',
    visit_type: 'physician_co_visit',
    status: args.status,
    contract_id: PHARMACY_COOP_CONTRACT_ID,
    contract_version_id: PHARMACY_COOP_CONTRACT_VERSION_ID,
    estimated_amount: 8800,
    estimated_snapshot: {
      estimate_status: 'estimated',
      billing_model: 'per_visit_with_addon',
      unit_price: 8800,
      tax_category: 'taxable',
    },
    accepted_at:
      args.status === 'accepted' ||
      args.status === 'recording' ||
      args.status === 'submitted' ||
      args.status === 'confirmed' ||
      args.status === 'physician_report_created' ||
      args.status === 'claim_checked' ||
      args.status === 'completed'
        ? '2026-06-20T00:30:00.000Z'
        : null,
    declined_at: null,
    completed_at:
      args.status === 'confirmed' ||
      args.status === 'physician_report_created' ||
      args.status === 'claim_checked' ||
      args.status === 'completed'
        ? '2026-06-20T03:00:00.000Z'
        : null,
    partner_pharmacy: {
      id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
      name: 'RouteMock協力薬局',
      status: 'active',
    },
    partnership: {
      id: PHARMACY_COOP_PARTNERSHIP_ID,
      base_site: { id: 'pharmacy_coop_route_site', name: 'RouteMock基幹薬局' },
    },
    has_request_reason: true,
    has_physician_instruction: true,
    has_carry_items: true,
    has_patient_home_notes: true,
    has_decline_reason: false,
  };
}

function buildPharmacyCoopPartnerRecord(args: { created: boolean; status: string }) {
  if (!args.created) return null;

  return {
    id: PHARMACY_COOP_PARTNER_RECORD_ID,
    visit_request_id: PHARMACY_COOP_VISIT_REQUEST_ID,
    share_case_id: PHARMACY_COOP_SHARE_CASE_ID,
    revision_no: 1,
    status: args.status,
    pharmacist_name: '協力 RouteMock',
    visit_at: '2026-06-20T01:45:00.000Z',
    submitted_at:
      args.status === 'submitted' || args.status === 'confirmed'
        ? '2026-06-20T02:30:00.000Z'
        : null,
    confirmed_at: args.status === 'confirmed' ? '2026-06-20T03:00:00.000Z' : null,
    owner_partner_pharmacy: {
      id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
      name: 'RouteMock協力薬局',
      status: 'active',
    },
    visit_request: {
      id: PHARMACY_COOP_VISIT_REQUEST_ID,
      status: args.status === 'confirmed' ? 'confirmed' : 'recording',
      urgency: 'emergency',
    },
    claim_note:
      args.status === 'confirmed'
        ? {
            id: 'pharmacy_coop_route_claim_note',
            claim_status: 'pending',
            visit_date: '2026-06-20T00:00:00.000Z',
            partner_pharmacy_name: 'RouteMock協力薬局',
            prescription_received_by: 'RouteMock基幹薬局',
            dispensing_pharmacy_name: 'RouteMock基幹薬局',
          }
        : null,
    has_record_content: true,
    attachment_count: 0,
    has_returned_reason: false,
    has_base_confirmation_snapshot: args.status === 'confirmed',
  };
}

function buildPharmacyCoopContract() {
  return {
    id: PHARMACY_COOP_CONTRACT_ID,
    status: 'active',
    effective_from: '2026-06-01T00:00:00.000Z',
    effective_to: null,
    partnership: {
      id: PHARMACY_COOP_PARTNERSHIP_ID,
      status: 'active',
      base_site: { id: 'pharmacy_coop_route_site', name: 'RouteMock基幹薬局' },
      partner_pharmacy: {
        id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
        name: 'RouteMock協力薬局',
        status: 'active',
      },
    },
    latest_version: {
      id: PHARMACY_COOP_CONTRACT_VERSION_ID,
      version_no: 1,
      status: 'active',
      active_fee_rule: {
        billing_model: 'per_visit_with_addon',
        unit_price: 8800,
        tax_category: 'taxable',
      },
    },
  };
}

function buildPharmacyCoopBillingCandidate(created: boolean) {
  if (!created) return null;

  return {
    id: PHARMACY_COOP_BILLING_CANDIDATE_ID,
    billing_month: `${PHARMACY_COOP_BILLING_MONTH}T00:00:00.000Z`,
    billing_status: 'candidate',
    is_billable: true,
    exclusion_reason: null,
    amount_summary: {
      billing_model: 'per_visit_with_addon',
      amount: 8800,
      tax_category: 'taxable',
      blocker_codes: [],
    },
    partner_visit_record: {
      id: PHARMACY_COOP_PARTNER_RECORD_ID,
      visit_at: '2026-06-20T01:45:00.000Z',
      status: 'confirmed',
      confirmed_at: '2026-06-20T03:00:00.000Z',
      owner_partner_pharmacy: { name: 'RouteMock協力薬局', status: 'active' },
    },
    contract_version: {
      id: PHARMACY_COOP_CONTRACT_VERSION_ID,
      version_no: 1,
      effective_from: '2026-06-01T00:00:00.000Z',
    },
  };
}

function buildPharmacyCoopInvoice(created: boolean) {
  if (!created) return null;

  return {
    id: PHARMACY_COOP_INVOICE_ID,
    contract_id: PHARMACY_COOP_CONTRACT_ID,
    document_kind: 'invoice',
    invoice_no: 'RM-COOP-001',
    billing_month: PHARMACY_COOP_BILLING_MONTH,
    subtotal: 8800,
    tax_amount: 880,
    total: 9680,
    status: 'draft',
    issued_at: null,
    sent_at: null,
    received_at: null,
    payment_scheduled_for: null,
    paid_at: null,
    item_count: 1,
    partnership: {
      base_site: { id: 'pharmacy_coop_route_site', name: 'RouteMock基幹薬局' },
      partner_pharmacy: {
        id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
        name: 'RouteMock協力薬局',
        status: 'active',
      },
    },
  };
}

function buildPharmacyCoopMessageThread(args: {
  visitRequestId: string | null;
  messages: string[];
}) {
  if (args.messages.length === 0) return null;

  const threadId = args.visitRequestId
    ? PHARMACY_COOP_VISIT_MESSAGE_THREAD_ID
    : PHARMACY_COOP_SHARE_MESSAGE_THREAD_ID;
  return {
    id: threadId,
    org_id: 'org_route_mock',
    share_case_id: PHARMACY_COOP_SHARE_CASE_ID,
    visit_request_id: args.visitRequestId,
    context_type: args.visitRequestId ? 'visit_request' : 'patient_share_case',
    status: 'open',
    created_by: 'route_base_user',
    last_message_at: '2026-06-20T04:00:00.000Z',
    created_at: '2026-06-20T03:30:00.000Z',
    updated_at: '2026-06-20T04:00:00.000Z',
    messages: args.messages.map((body, index) => ({
      id: `${threadId}_message_${index + 1}`,
      org_id: 'org_route_mock',
      thread_id: threadId,
      sender_user_id: 'route_base_user',
      sender_side: 'base_pharmacy',
      body,
      created_at: `2026-06-20T04:0${index}:00.000Z`,
      updated_at: `2026-06-20T04:0${index}:00.000Z`,
    })),
  };
}

async function installPharmacyCooperationRouteMocks(page: Page) {
  const requests = {
    patientShareCases: [] as CapturedRouteRequest[],
    patientShareConsents: [] as CapturedRouteRequest[],
    patientLinks: [] as CapturedRouteRequest[],
    shareCaseActivations: [] as CapturedRouteRequest[],
    visitRequests: [] as CapturedRouteRequest[],
    visitRequestDecisions: [] as CapturedRouteRequest[],
    partnerVisitRecords: [] as CapturedRouteRequest[],
    partnerVisitRecordSubmits: [] as CapturedRouteRequest[],
    partnerVisitRecordReviews: [] as CapturedRouteRequest[],
    reportDrafts: [] as CapturedRouteRequest[],
    billingCandidates: [] as CapturedRouteRequest[],
    pharmacyInvoices: [] as CapturedRouteRequest[],
    messageThreads: [] as CapturedRouteRequest[],
  };
  const state = {
    shareCaseCreated: true,
    shareCaseStatus: 'consent_pending',
    baseApproved: false,
    partnerAccepted: false,
    consentCreated: false,
    visitRequestCreated: false,
    visitRequestStatus: 'requested',
    partnerRecordCreated: false,
    partnerRecordStatus: 'draft',
    billingCandidateGenerated: false,
    invoiceCreated: false,
    shareCaseMessages: [] as string[],
    visitRequestMessages: [] as string[],
  };

  await installDashboardShellRouteMocks(page);

  await page.route(
    apiPathPattern(`/api/patients/${PHARMACY_COOP_PATIENT_ID}/overview`),
    async (route) => {
      await fulfillJson(route, buildPharmacyCoopPatientOverview());
    },
  );

  await page.route(
    apiPathPattern(`/api/patients/${PHARMACY_COOP_PATIENT_ID}/home-operations`),
    async (route) => {
      await fulfillJson(route, null);
    },
  );

  await page.route(
    apiPathPattern(`/api/patients/${PHARMACY_COOP_PATIENT_ID}/documents`),
    async (route) => {
      await fulfillJson(route, buildPharmacyCoopDocumentsSnapshot());
    },
  );

  await page.route(apiPathPattern('/api/pharmacy-partnerships'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: PHARMACY_COOP_PARTNERSHIP_ID,
          status: 'active',
          effective_from: '2026-06-01T00:00:00.000Z',
          effective_to: null,
          base_site: { id: 'pharmacy_coop_route_site', name: 'RouteMock基幹薬局' },
          partner_pharmacy: {
            id: PHARMACY_COOP_PARTNER_PHARMACY_ID,
            name: 'RouteMock協力薬局',
            status: 'active',
          },
        },
      ],
    });
  });

  await page.route(apiPathPattern('/api/management-plans'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: PHARMACY_COOP_MANAGEMENT_PLAN_ID,
          case_id: PHARMACY_COOP_CASE_ID,
          title: '薬局間RouteMock 管理計画',
          version: 2,
          status: 'approved',
          effective_from: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-18T00:00:00.000Z',
        },
      ],
    });
  });

  await page.route(apiPathPattern('/api/patient-share-cases'), async (route) => {
    const request = captureRouteRequest(route);
    requests.patientShareCases.push(request);
    if (request.method === 'POST') {
      state.shareCaseCreated = true;
      state.shareCaseStatus = 'consent_pending';
      await fulfillJson(
        route,
        buildPharmacyCoopShareCase({
          created: state.shareCaseCreated,
          status: state.shareCaseStatus,
          baseApproved: state.baseApproved,
          partnerAccepted: state.partnerAccepted,
        }),
        201,
      );
      return;
    }

    const shareCase = buildPharmacyCoopShareCase({
      created: state.shareCaseCreated,
      status: state.shareCaseStatus,
      baseApproved: state.baseApproved,
      partnerAccepted: state.partnerAccepted,
    });
    await fulfillJson(route, { data: shareCase ? [shareCase] : [], hasMore: false });
  });

  await page.route(
    apiPathPattern(`/api/patient-share-cases/${PHARMACY_COOP_SHARE_CASE_ID}/patient-link`),
    async (route) => {
      const request = captureRouteRequest(route);
      requests.patientLinks.push(request);
      const body = request.body as { decision?: string } | null;
      if (body?.decision === 'base_approve') {
        state.baseApproved = true;
        state.shareCaseStatus = state.consentCreated
          ? 'partner_confirmation_pending'
          : 'consent_pending';
      }
      if (body?.decision === 'accept') {
        state.baseApproved = true;
        state.partnerAccepted = true;
        state.shareCaseStatus = state.consentCreated
          ? 'partner_confirmation_pending'
          : 'consent_pending';
      }
      await fulfillJson(route, {
        data: {
          id: 'pharmacy_coop_route_patient_link',
          match_status: state.partnerAccepted ? 'accepted' : 'pending',
        },
      });
    },
  );

  await page.route(
    apiPathPattern(`/api/patient-share-cases/${PHARMACY_COOP_SHARE_CASE_ID}/activate`),
    async (route) => {
      requests.shareCaseActivations.push(captureRouteRequest(route));
      state.shareCaseStatus = 'active';
      await fulfillJson(route, { data: { id: PHARMACY_COOP_SHARE_CASE_ID, status: 'active' } });
    },
  );

  await page.route(
    apiPathPattern(`/api/patient-share-cases/${PHARMACY_COOP_SHARE_CASE_ID}/consents`),
    async (route) => {
      const request = captureRouteRequest(route);
      requests.patientShareConsents.push(request);
      if (request.method === 'POST') {
        state.consentCreated = true;
        if (state.shareCaseStatus !== 'active') {
          state.shareCaseStatus = 'partner_confirmation_pending';
        }
        await fulfillJson(route, { data: buildPharmacyCoopConsent(true) }, 201);
        return;
      }

      const consent = buildPharmacyCoopConsent(state.consentCreated);
      await fulfillJson(route, {
        data: consent ? [consent] : [],
        meta: { has_more: false, next_cursor: null },
      });
    },
  );

  await page.route(
    apiPathPattern(`/api/patient-share-cases/${PHARMACY_COOP_SHARE_CASE_ID}/correction-requests`),
    async (route) => {
      await fulfillJson(route, { data: [], meta: { has_more: false, next_cursor: null } });
    },
  );

  await page.route(apiPathPattern('/api/pharmacy-visit-requests'), async (route) => {
    const request = captureRouteRequest(route);
    requests.visitRequests.push(request);
    if (request.method === 'POST') {
      state.visitRequestCreated = true;
      state.visitRequestStatus = 'requested';
      await fulfillJson(
        route,
        buildPharmacyCoopVisitRequest({
          created: state.visitRequestCreated,
          status: state.visitRequestStatus,
        }),
        201,
      );
      return;
    }

    const visitRequest = buildPharmacyCoopVisitRequest({
      created: state.visitRequestCreated,
      status: state.visitRequestStatus,
    });
    await fulfillJson(route, { data: visitRequest ? [visitRequest] : [], hasMore: false });
  });

  await page.route(apiPathPattern('/api/pharmacy-cooperation-message-threads'), async (route) => {
    const request = captureRouteRequest(route);
    requests.messageThreads.push(request);
    const body = request.body as {
      share_case_id?: string;
      visit_request_id?: string;
      body?: string;
    } | null;

    if (request.method === 'POST') {
      const messageBody = body?.body?.trim() ?? '';
      if (body?.visit_request_id) {
        state.visitRequestMessages.push(messageBody);
      } else {
        state.shareCaseMessages.push(messageBody);
      }

      const thread = buildPharmacyCoopMessageThread({
        visitRequestId: body?.visit_request_id ?? null,
        messages: body?.visit_request_id ? state.visitRequestMessages : state.shareCaseMessages,
      });
      await fulfillJson(route, { thread, notification_count: 1 }, 201);
      return;
    }

    const url = new URL(request.url);
    const visitRequestId = url.searchParams.get('visit_request_id');
    const thread = buildPharmacyCoopMessageThread({
      visitRequestId,
      messages: visitRequestId ? state.visitRequestMessages : state.shareCaseMessages,
    });
    await fulfillJson(route, { data: thread ? [thread] : [], hasMore: false });
  });

  await page.route(
    apiPathPattern(`/api/pharmacy-visit-requests/${PHARMACY_COOP_VISIT_REQUEST_ID}/decision`),
    async (route) => {
      const request = captureRouteRequest(route);
      requests.visitRequestDecisions.push(request);
      const body = request.body as { decision?: string } | null;
      if (body?.decision === 'accept') {
        state.visitRequestStatus = 'accepted';
      }
      await fulfillJson(route, {
        id: PHARMACY_COOP_VISIT_REQUEST_ID,
        status: state.visitRequestStatus,
      });
    },
  );

  await page.route(apiPathPattern('/api/partner-visit-records'), async (route) => {
    const request = captureRouteRequest(route);
    requests.partnerVisitRecords.push(request);
    if (request.method === 'POST') {
      state.partnerRecordCreated = true;
      state.partnerRecordStatus = 'draft';
      state.visitRequestStatus = 'recording';
      await fulfillJson(
        route,
        buildPharmacyCoopPartnerRecord({
          created: state.partnerRecordCreated,
          status: state.partnerRecordStatus,
        }),
        201,
      );
      return;
    }

    const record = buildPharmacyCoopPartnerRecord({
      created: state.partnerRecordCreated,
      status: state.partnerRecordStatus,
    });
    await fulfillJson(route, { data: record ? [record] : [], hasMore: false });
  });

  await page.route(
    apiPathPattern(`/api/partner-visit-records/${PHARMACY_COOP_PARTNER_RECORD_ID}/submit`),
    async (route) => {
      requests.partnerVisitRecordSubmits.push(captureRouteRequest(route));
      state.partnerRecordStatus = 'submitted';
      state.visitRequestStatus = 'submitted';
      await fulfillJson(route, { id: PHARMACY_COOP_PARTNER_RECORD_ID, status: 'submitted' });
    },
  );

  await page.route(
    apiPathPattern(`/api/partner-visit-records/${PHARMACY_COOP_PARTNER_RECORD_ID}/review`),
    async (route) => {
      requests.partnerVisitRecordReviews.push(captureRouteRequest(route));
      state.partnerRecordStatus = 'confirmed';
      state.visitRequestStatus = 'confirmed';
      await fulfillJson(route, { id: PHARMACY_COOP_PARTNER_RECORD_ID, status: 'confirmed' });
    },
  );

  await page.route(
    apiPathPattern(
      `/api/partner-visit-records/${PHARMACY_COOP_PARTNER_RECORD_ID}/physician-report-draft`,
    ),
    async (route) => {
      requests.reportDrafts.push(captureRouteRequest(route));
      state.visitRequestStatus = 'physician_report_created';
      await fulfillJson(
        route,
        {
          message: '医師向け報告書ドラフトを作成しました',
          reused_existing_draft: false,
          report: {
            id: PHARMACY_COOP_REPORT_ID,
            status: 'draft',
            report_type: 'physician',
          },
        },
        201,
      );
    },
  );

  await page.route(apiPathPattern('/api/visit-billing-candidates/summary'), async (route) => {
    await fulfillJson(route, {
      billing_month: PHARMACY_COOP_BILLING_MONTH,
      visit_record_count: state.partnerRecordStatus === 'confirmed' ? 1 : 0,
      confirmed_visit_record_count: state.partnerRecordStatus === 'confirmed' ? 1 : 0,
      unconfirmed_visit_record_count: state.partnerRecordStatus === 'confirmed' ? 0 : 1,
      generated_candidate_count: state.billingCandidateGenerated ? 1 : 0,
      billable_candidate_count: state.billingCandidateGenerated ? 1 : 0,
      excluded_candidate_count: 0,
      invoiced_candidate_count: state.invoiceCreated ? 1 : 0,
      free_candidate_count: 0,
      paid_candidate_count: state.billingCandidateGenerated ? 1 : 0,
      planned_invoice_amount: state.billingCandidateGenerated ? 8800 : 0,
      pending_candidate_generation_count:
        state.partnerRecordStatus === 'confirmed' && !state.billingCandidateGenerated ? 1 : 0,
    });
  });

  await page.route(apiPathPattern('/api/pharmacy-contracts'), async (route) => {
    await fulfillJson(route, { data: [buildPharmacyCoopContract()] });
  });

  await page.route(apiPathPattern('/api/visit-billing-candidates'), async (route) => {
    const request = captureRouteRequest(route);
    requests.billingCandidates.push(request);
    if (request.method === 'POST') {
      state.billingCandidateGenerated = true;
      state.visitRequestStatus = 'claim_checked';
      await fulfillJson(route, {
        message: '2026-06-01 の薬局間協力訪問請求候補を生成しました',
        billing_month: PHARMACY_COOP_BILLING_MONTH,
        scanned_confirmed_records: 1,
        generated_candidates: 1,
        billable_count: 1,
        excluded_count: 0,
        skipped_locked_count: 0,
      });
      return;
    }

    const candidate = buildPharmacyCoopBillingCandidate(state.billingCandidateGenerated);
    await fulfillJson(route, { data: candidate ? [candidate] : [], hasMore: false });
  });

  await page.route(apiPathPattern('/api/pharmacy-invoices'), async (route) => {
    const request = captureRouteRequest(route);
    requests.pharmacyInvoices.push(request);
    if (request.method === 'POST') {
      state.invoiceCreated = true;
      await fulfillJson(
        route,
        {
          message: '薬局間請求書ドラフトを作成しました',
          id: PHARMACY_COOP_INVOICE_ID,
          contract_id: PHARMACY_COOP_CONTRACT_ID,
          document_kind: 'invoice',
          billing_month: PHARMACY_COOP_BILLING_MONTH,
          subtotal: 8800,
          tax_amount: 880,
          total: 9680,
          status: 'draft',
          reused_existing_draft: false,
          item_count: 1,
          items: [],
        },
        201,
      );
      return;
    }

    const invoice = buildPharmacyCoopInvoice(state.invoiceCreated);
    await fulfillJson(route, { data: invoice ? [invoice] : [], hasMore: false });
  });

  return requests;
}

async function installBillingWorkbenchRouteMocks(page: Page) {
  const requests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern('/api/billing-candidates'), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    requests.push(captureRouteRequest(route));
    await fulfillJson(route, {
      data: [
        {
          id: 'billing_route_mock_candidate',
          patient_id: BILLING_PATIENT_ID,
          patient_name: '請求RouteMock 患者',
          billing_month: `${BILLING_MONTH}T00:00:00.000Z`,
          billing_code: 'MED_HOME_VISIT_ROUTE_MOCK',
          billing_name: '在宅患者訪問薬剤管理指導料 RouteMock',
          points: 650,
          quantity: 1,
          status: 'confirmed',
          exclusion_reason: null,
          source_snapshot: {
            billing_scope: 'home_care_ssot',
            selection_mode: 'automatic',
            source_note: 'Route mock evidence',
            ruleset_version: '2026-route-mock',
            revision_code: 'revision-2026',
            site_config_status: 'configured',
            billing_assignment: {
              building_id: 'route-mock-building',
              unit_name: '1F',
              assignment_scope: 'unit',
              building_patient_count: 2,
              unit_patient_count: 1,
            },
            billing_close: {
              review_state: 'reviewed',
              resolution_state: 'confirmed',
              reviewed_at: '2026-04-25T01:00:00.000Z',
              reviewed_by: 'route-mock-user',
              note: 'reviewed',
            },
            validation_layers: {
              evidence: {
                label: 'エビデンス',
                state: 'passed',
                message: '根拠確認済み',
              },
              rule_engine: {
                label: 'ルール判定',
                state: 'passed',
                message: '算定可能',
                version: 'billing-rules-2026',
              },
              close_review: {
                label: '締め確認',
                state: 'passed',
                message: '締め可能',
              },
            },
          },
          workflow_state: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
            reviewed_at: '2026-04-25T01:00:00.000Z',
            reviewed_by: 'route-mock-user',
            note: 'reviewed',
          },
        },
      ],
      hasMore: false,
      summary: {
        total: 1,
        pending_review: 0,
        confirmed: 1,
        excluded: 0,
        exported: 0,
        reviewed: 1,
        ready_to_close: 1,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });
  });

  return requests;
}

async function installFormularyRouteMocks(page: Page) {
  const impactRequests: CapturedRouteRequest[] = [];
  const jobRequests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern('/api/notifications/stream'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });

  await page.route(apiPathPattern('/api/handoff-board'), async (route) => {
    await fulfillJson(route, {
      data: {
        id: 'mock_handoff_board',
        shift_date: '2026-06-11',
        items: [],
        month_item_count: 0,
        summary: { outgoing_count: 0, incoming_count: 0 },
      },
    });
  });

  await page.route(apiPathPattern('/api/dispense-audits'), async (route) => {
    await fulfillJson(route, { data: [], hasMore: false });
  });

  await page.route(apiPathPattern('/api/pharmacy-sites'), async (route) => {
    await fulfillJson(route, {
      data: [{ id: FORMULARY_SITE_ID, name: 'RouteMock 本店', address: '東京都千代田区' }],
    });
  });

  await page.route(apiPathPattern('/api/drug-master-imports/status'), async (route) => {
    await fulfillJson(route, {
      data: {
        sources: [
          {
            source: 'mhlw_price',
            label: '厚労省 薬価基準収載品目リスト',
            is_free: true,
            threshold_days: 120,
            last_success: {
              imported_at: '2026-05-20T00:00:00.000Z',
              record_count: 12343,
              days_ago: 7,
            },
            last_failure: null,
            recent_runs_30d: {
              total: 1,
              failed: 0,
              failure_streak: 0,
              latest_status: 'completed',
              latest_imported_at: '2026-05-20T00:00:00.000Z',
            },
            freshness: 'fresh',
          },
          {
            source: 'pmda',
            label: 'PMDA 添付文書',
            is_free: false,
            threshold_days: 14,
            last_success: null,
            last_failure: null,
            recent_runs_30d: {
              total: 2,
              failed: 2,
              failure_streak: 2,
              latest_status: 'failed',
              latest_imported_at: '2026-05-26T00:00:00.000Z',
            },
            freshness: 'never',
          },
        ],
        totals: {
          drug_master_count: 12343,
          hot_code_coverage: 0,
          package_insert_count: 0,
          interaction_count: 0,
          active_alert_rule_count: 0,
          generic_mapping_count: 0,
        },
        checked_at: '2026-05-27T00:00:00.000Z',
      },
    });
  });

  await page.route(apiPathPattern('/api/drug-master-import-logs'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(apiPathPattern('/api/pharmacy-drug-stocks/impact'), async (route) => {
    impactRequests.push(captureRouteRequest(route));
    const requestUrl = new URL(route.request().url());
    const queue = requestUrl.searchParams.get('queue') ?? 'action_required';
    const stock = {
      id: 'formulary_route_mock_stock',
      site_id: FORMULARY_SITE_ID,
      drug_master_id: FORMULARY_DRUG_ID,
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_source: 'csv',
      adoption_note: 'route mock',
      last_reviewed_at: null,
      reviewed_by_id: null,
      follow_up_status: 'planned_switch',
      follow_up_reason: 'RouteMock 経過措置対応',
      follow_up_due_date: '2026-08-31T00:00:00.000Z',
      follow_up_resolved_at: null,
      updated_at: '2026-05-27T00:00:00.000Z',
      preferred_generic: null,
      drug_master: {
        id: FORMULARY_DRUG_ID,
        drug_name: 'RouteMock 採用薬錠5mg',
        yj_code: '123456789012',
        drug_price: 21.2,
        unit: '錠',
        is_generic: false,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: false,
        transitional_expiry_date: '2026-08-31T00:00:00.000Z',
      },
    };
    await fulfillJson(route, {
      site: { id: FORMULARY_SITE_ID, name: 'RouteMock 本店' },
      checked_at: '2026-05-27T00:00:00.000Z',
      thresholds: { expiry_within_days: 90, review_overdue_days: 180 },
      selected_queue: { key: queue, rows: [stock], total_count: 1 },
      totals: {
        stocked_count: 1,
        review_due_count: 1,
        missing_reorder_point_count: 1,
        safety_flagged_count: 1,
        high_risk_count: 1,
        lasa_risk_count: 0,
        controlled_count: 0,
        transitional_expiry_count: 1,
        transitional_expiry_within_30_count: 0,
        transitional_expiry_within_60_count: 0,
        transitional_expiry_within_90_count: 1,
        action_required_count: 1,
        recent_master_change_count: 1,
      },
      recent_changes: [
        {
          id: 'formulary_route_mock_change',
          yj_code: '123456789012',
          change_type: 'price_changed',
          previous_value: { drug_price: '19.0' },
          current_value: { drug_price: '21.2' },
          created_at: '2026-05-27T00:00:00.000Z',
        },
      ],
      samples: {
        review_due: [stock],
        missing_reorder_point: [stock],
        safety_flagged: [stock],
        high_risk: [stock],
        lasa_risk: [],
        controlled: [],
        transitional_expiry: [stock],
        action_required: [stock],
        recently_changed: [stock],
      },
    });
  });

  await page.route(apiPathPattern('/api/pharmacy-drug-stocks'), async (route) => {
    await fulfillJson(route, {
      site: { id: FORMULARY_SITE_ID, name: 'RouteMock 本店' },
      data: [],
    });
  });

  await page.route(apiPathPattern('/api/pharmacy-drug-stock-templates'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(apiPathPattern('/api/pharmacy-drug-stocks/usage-mismatch'), async (route) => {
    await fulfillJson(route, {
      period: {
        since: '2026-02-26T00:00:00.000Z',
        until: '2026-05-27T00:00:00.000Z',
      },
      thresholds: { days: 90, frequent_threshold: 2, draft_limit: 500, limit: 10 },
      totals: {
        scanned_draft_count: 0,
        used_drug_count: 0,
        medication_line_count: 0,
        matched_drug_count: 0,
        unmatched_drug_count: 0,
        stocked_count: 1,
        frequent_unstocked_count: 0,
        unused_stocked_count: 0,
      },
      frequent_unstocked: [],
      unused_stocked: [],
      unmatched_prescribed: [],
    });
  });

  await page.route(apiPathPattern('/api/pharmacy-drug-stock-requests'), async (route) => {
    await fulfillJson(route, {
      data: [],
      summary: {
        status: 'pending',
        total_count: 0,
        overdue_count: 0,
        overdue_days: 7,
        oldest_pending_created_at: null,
        notification_level: 'clear',
      },
    });
  });

  await page.route(apiPathPattern('/api/drug-masters'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: FORMULARY_DRUG_ID,
          yj_code: '123456789012',
          receipt_code: '123456789',
          jan_code: null,
          drug_name: 'RouteMock 採用薬錠5mg',
          drug_name_kana: 'ルートモックサイヨウヤク',
          generic_name: 'RouteMock 一般名',
          drug_price: 21.2,
          unit: '錠',
          dosage_form: '内用薬',
          therapeutic_category: '1234',
          manufacturer: 'RouteMock 製薬',
          is_generic: false,
          is_narcotic: false,
          is_psychotropic: false,
          is_high_risk: true,
          is_lasa_risk: false,
          tall_man_name: null,
          lasa_group_key: null,
          max_administration_days: null,
          stock_config: {
            id: 'formulary_route_mock_stock',
            site_id: FORMULARY_SITE_ID,
            drug_master_id: FORMULARY_DRUG_ID,
            is_stocked: true,
            stock_qty: null,
            reorder_point: null,
            preferred_generic_id: null,
            adoption_source: 'csv',
            adoption_note: 'route mock',
            last_reviewed_at: null,
            reviewed_by_id: null,
            follow_up_status: 'planned_switch',
            follow_up_reason: 'RouteMock 経過措置対応',
            follow_up_due_date: '2026-08-31T00:00:00.000Z',
            follow_up_resolved_at: null,
            updated_at: '2026-05-27T00:00:00.000Z',
            preferred_generic: null,
          },
          generic_price_comparison: null,
        },
      ],
      hasMore: false,
      totalCount: 1,
    });
  });

  await page.route(apiPathPattern(`/api/drug-masters/${FORMULARY_DRUG_ID}`), async (route) => {
    await fulfillJson(route, {
      id: FORMULARY_DRUG_ID,
      yj_code: '123456789012',
      receipt_code: '123456789',
      hot_code: null,
      jan_code: null,
      drug_name: 'RouteMock 採用薬錠5mg',
      drug_name_kana: 'ルートモックサイヨウヤク',
      generic_name: 'RouteMock 一般名',
      drug_price: 21.2,
      unit: '錠',
      dosage_form: '内用薬',
      therapeutic_category: '1234',
      manufacturer: 'RouteMock 製薬',
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: true,
      is_lasa_risk: false,
      tall_man_name: null,
      lasa_group_key: null,
      max_administration_days: null,
      transitional_expiry_date: '2026-08-31T00:00:00.000Z',
      stock_config: null,
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    });
  });

  await page.route(
    apiPathPattern(`/api/drug-masters/${FORMULARY_DRUG_ID}/generic-recommendations`),
    async (route) => {
      await fulfillJson(route, {
        recommendations: [
          {
            id: FORMULARY_GENERIC_ID,
            yj_code: '123456789099',
            drug_name: 'RouteMock 後発薬錠5mg',
            generic_name: 'RouteMock 一般名',
            drug_price: 10.5,
            unit: '錠',
            manufacturer: 'RouteMock GE',
            is_generic: true,
            transitional_expiry_date: null,
            price_delta: -10.7,
            price_delta_percent: -50.4,
            site_stock: null,
          },
        ],
      });
    },
  );

  await page.route(apiPathPattern('/api/jobs/drug-master-freshness-check'), async (route) => {
    jobRequests.push(captureRouteRequest(route));
    await fulfillJson(route, {
      data: { jobType: 'drug-master-freshness-check', processedCount: 1 },
    });
  });

  return { impactRequests, jobRequests };
}

async function installOfflineVisitRecordRouteMocks(page: Page) {
  const visitRecordRequests: CapturedRouteRequest[] = [];
  const scheduleRequests: CapturedRouteRequest[] = [];
  const preparationRequests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern(`/api/visit-schedules/${OFFLINE_SCHEDULE_ID}`), async (route) => {
    scheduleRequests.push(captureRouteRequest(route));
    await fulfillJson(route, {
      id: OFFLINE_SCHEDULE_ID,
      patient_id: OFFLINE_PATIENT_ID,
      cycle_id: null,
      scheduled_date: '2026-04-28T00:00:00.000Z',
      schedule_status: 'ready',
      visit_type: 'regular',
      carry_items_status: 'ready',
      recurrence_rule: null,
    });
  });

  await page.route(
    apiPathPattern(`/api/visit-preparations/${OFFLINE_SCHEDULE_ID}`),
    async (route) => {
      preparationRequests.push(captureRouteRequest(route));
      await fulfillJson(route, {
        data: {
          preparation: null,
          pack: {
            care_team: [],
            billing_blockers: [],
            conference_context: [],
            medication_period: {
              schedule_start_date: '2026-04-28',
              schedule_end_date: '2026-05-12',
              prescription_start_date: null,
              prescription_end_date: null,
            },
            prescription_changes: null,
            previous_visit: null,
            intake_context: {
              initial_transition_management_expected: null,
            },
            facility_parallel_context: null,
          },
        },
      });
    },
  );

  await page.route(apiPathPattern('/api/visit-records'), async (route) => {
    if (route.request().method() === 'POST') {
      visitRecordRequests.push(captureRouteRequest(route));
      await fulfillJson(
        route,
        { message: 'offline save smoke should not POST visit records' },
        500,
      );
      return;
    }

    await route.continue();
  });

  return { preparationRequests, scheduleRequests, visitRecordRequests };
}

async function installScheduleDayGanttRouteMocks(page: Page) {
  const scheduleRequests: CapturedRouteRequest[] = [];
  const routeRequests: CapturedRouteRequest[] = [];
  const dayBoardRequests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern('/api/notifications/stream'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route(apiPathPattern('/api/notifications'), async (route) => {
    await fulfillJson(route, { data: [], hasMore: false, nextCursor: null });
  });

  await page.route(apiPathPattern('/api/handoff-board'), async (route) => {
    await fulfillJson(route, {
      data: {
        id: 'mock_handoff_board',
        shift_date: GANTT_DATE,
        items: [],
        month_item_count: 0,
        summary: { outgoing_count: 0, incoming_count: 0 },
      },
    });
  });

  await page.route(apiPathPattern('/api/dispense-audits'), async (route) => {
    await fulfillJson(route, { data: [], hasMore: false });
  });

  await page.route(apiPathPattern('/api/dashboard/cockpit/summary'), async (route) => {
    await fulfillJson(route, {
      data: {
        generated_at: `${GANTT_DATE}T08:00:00.000Z`,
        cycle_status_counts: {},
        audit_pending_count: 0,
        narcotic_audit_count: 0,
        earliest_audit_due_at: null,
        today_visit_count: 0,
        today_visit_times: [],
      },
    });
  });

  await page.route(apiPathPattern('/api/dashboard/cockpit/details'), async (route) => {
    await fulfillJson(route, {
      data: {
        generated_at: `${GANTT_DATE}T08:00:00.000Z`,
        audit_queue: [],
        today_visits: [],
        blocked_reasons: [],
        carryover_count: 0,
      },
    });
  });

  await page.route(apiPathPattern('/api/dashboard/cockpit/team'), async (route) => {
    await fulfillJson(route, {
      data: {
        generated_at: `${GANTT_DATE}T08:00:00.000Z`,
        team_capacity: [],
      },
    });
  });

  await page.route(apiPathPattern('/api/dashboard/cockpit'), async (route) => {
    await fulfillJson(route, {
      data: {
        generated_at: `${GANTT_DATE}T08:00:00.000Z`,
        cycle_status_counts: {},
        audit_pending_count: 0,
        narcotic_audit_count: 0,
        audit_queue: [],
        today_visits: [],
        blocked_reasons: [],
        carryover_count: 0,
        team_capacity: [],
      },
    });
  });

  await page.route(apiPathPattern('/api/cases'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(apiPathPattern('/api/pharmacists'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: GANTT_PHARMACIST_A_ID,
          name: '薬剤師A',
          site_id: GANTT_SITE_ID,
          site_name: 'RouteMock 中央薬局',
        },
        {
          id: GANTT_PHARMACIST_B_ID,
          name: '薬剤師B',
          site_id: GANTT_SITE_ID,
          site_name: 'RouteMock 中央薬局',
        },
      ],
    });
  });

  await page.route(apiPathPattern('/api/visit-schedule-proposals'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(
    apiPathPattern('/api/visit-schedule-proposals/billing-preview-batch'),
    async (route) => {
      await fulfillJson(route, { data: {} });
    },
  );

  await page.route(apiPathPattern('/api/visit-schedules/day-board'), async (route) => {
    dayBoardRequests.push(captureRouteRequest(route));
    await fulfillJson(route, { data: buildGanttDayBoardResponse() });
  });

  await page.route(apiPathPattern('/api/visit-schedules'), async (route) => {
    if (route.request().method() !== 'GET') {
      await fulfillJson(route, { message: 'Route-mocked Gantt smoke is read-only' }, 405);
      return;
    }

    scheduleRequests.push(captureRouteRequest(route));
    await fulfillJson(route, {
      data: GANTT_ROUTE_MOCK_SCHEDULES,
      hasMore: false,
    });
  });

  await page.route(apiPathPattern('/api/tasks'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(apiPathPattern('/api/visit-preparations/brief-batch'), async (route) => {
    await fulfillJson(route, { data: {} });
  });

  await page.route(
    new RegExp(
      '^(?:https?://[^/]+)?/api/visit-preparations/(?!brief-batch/?(?:\\?|$))[^/?]+/?(?:\\?.*)?$',
    ),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await fulfillJson(route, { message: 'Route-mocked Gantt smoke is read-only' }, 405);
        return;
      }

      const scheduleId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      const details = buildGanttPreparationDetails(scheduleId);
      if (!details) {
        await fulfillJson(route, { message: 'Unknown route-mocked schedule' }, 404);
        return;
      }

      await fulfillJson(route, { data: details });
    },
  );

  await page.route(apiPathPattern('/api/visit-routes'), async (route) => {
    routeRequests.push(captureRouteRequest(route));
    const body = readRouteBody<{
      schedule_ids?: string[];
      travel_mode?: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
    }>(route);
    const scheduleIds = body?.schedule_ids ?? [];

    await fulfillJson(route, {
      data: {
        status: 'ok',
        note: null,
        travelMode: body?.travel_mode ?? 'DRIVE',
        origin: null,
        encodedPath: null,
        orderedScheduleIds: scheduleIds,
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        stopSummaries: scheduleIds.map((scheduleId, index) => ({
          scheduleId,
          optimizedOrder: index + 1,
          arrivalOffsetSeconds: index * 900,
          distanceFromPreviousMeters: null,
          durationFromPreviousSeconds: null,
        })),
      },
    });
  });

  return { dayBoardRequests, routeRequests, scheduleRequests };
}

async function installScheduleProposalBulkRouteMocks(page: Page) {
  const listRequests: CapturedRouteRequest[] = [];
  const patchRequests: CapturedRouteRequest[] = [];
  const billingPreviewRequests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern('/api/cases'), async (route) => {
    await fulfillJson(route, { data: [] });
  });

  await page.route(apiPathPattern('/api/visit-vehicle-resources'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: PROPOSAL_BULK_VEHICLE_ID,
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
          available: true,
          site: {
            id: PROPOSAL_BULK_SITE_ID,
            name: 'RouteMock 提案薬局',
          },
        },
      ],
    });
  });

  await page.route(
    apiPathPattern('/api/visit-schedule-proposals/billing-preview-batch'),
    async (route) => {
      billingPreviewRequests.push(captureRouteRequest(route));
      await fulfillJson(route, { data: {} });
    },
  );

  await page.route(apiPathPattern('/api/visit-schedule-proposals'), async (route) => {
    if (route.request().method() !== 'GET') {
      await fulfillJson(route, { message: 'Unexpected proposal list method in route mock' }, 405);
      return;
    }

    listRequests.push(captureRouteRequest(route));
    await fulfillJson(route, { data: PROPOSAL_BULK_ROUTE_MOCK_PROPOSALS });
  });

  await page.route(
    new RegExp(
      '^(?:https?://[^/]+)?/api/visit-schedule-proposals/(?!billing-preview-batch/?(?:\\?|$))[^/?]+/?(?:\\?.*)?$',
    ),
    async (route) => {
      const request = route.request();
      const proposalId = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() ?? '');
      const proposal = PROPOSAL_BULK_ROUTE_MOCK_PROPOSALS.find((item) => item.id === proposalId);

      if (!proposal) {
        await fulfillJson(route, { message: 'Unknown route-mocked proposal' }, 404);
        return;
      }

      if (request.method() === 'GET') {
        await fulfillJson(route, { data: buildProposalBulkRouteMockDetail(proposal) });
        return;
      }

      if (request.method() === 'PATCH') {
        patchRequests.push(captureRouteRequest(route));

        if (proposalId === PROPOSAL_BULK_FAILURE_ID) {
          await fulfillJson(route, { message: PROPOSAL_BULK_UNSAFE_ERROR_MESSAGE }, 409);
          return;
        }

        await fulfillJson(route, {
          data: {
            ...proposal,
            proposal_status: 'rejected',
            patient_contact_status: 'declined',
          },
        });
        return;
      }

      await fulfillJson(route, { message: 'Unexpected proposal detail method in route mock' }, 405);
    },
  );

  return { billingPreviewRequests, listRequests, patchRequests };
}

async function installScheduleProposalSearchRouteMocks(page: Page) {
  const listRequests: CapturedRouteRequest[] = [];
  const billingPreviewRequests: CapturedRouteRequest[] = [];

  await page.route(apiPathPattern('/api/cases'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: PROPOSAL_SEARCH_CASE_A_ID,
          status: 'active',
          primary_pharmacist_id: PROPOSAL_BULK_PHARMACIST_ID,
          primary_pharmacist_name: '薬剤師A',
          patient: {
            id: PROPOSAL_SEARCH_PATIENT_A_ID,
            name: '佐藤太郎',
            residences: [
              {
                address: '東京都千代田区1-1-1 RouteMock 101号室',
                lat: null,
                lng: null,
              },
            ],
          },
        },
        {
          id: PROPOSAL_SEARCH_CASE_B_ID,
          status: 'active',
          primary_pharmacist_id: PROPOSAL_BULK_PHARMACIST_ID,
          primary_pharmacist_name: '薬剤師A',
          patient: {
            id: PROPOSAL_SEARCH_PATIENT_B_ID,
            name: '佐藤太郎',
            residences: [
              {
                address: '東京都中央区2-2-2 RouteMock 202号室',
                lat: null,
                lng: null,
              },
            ],
          },
        },
      ],
    });
  });

  await page.route(apiPathPattern('/api/visit-vehicle-resources'), async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: PROPOSAL_BULK_VEHICLE_ID,
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
          available: true,
          site: {
            id: PROPOSAL_BULK_SITE_ID,
            name: 'RouteMock 提案薬局',
          },
        },
      ],
    });
  });

  await page.route(
    apiPathPattern('/api/visit-schedule-proposals/billing-preview-batch'),
    async (route) => {
      billingPreviewRequests.push(captureRouteRequest(route));
      await fulfillJson(route, { data: {} });
    },
  );

  await page.route(apiPathPattern('/api/visit-schedule-proposals'), async (route) => {
    if (route.request().method() !== 'GET') {
      await fulfillJson(route, { message: 'Unexpected proposal list method in route mock' }, 405);
      return;
    }

    listRequests.push(captureRouteRequest(route));
    const url = new URL(route.request().url());
    const caseId = url.searchParams.get('case_id');
    const patientId = url.searchParams.get('patient_id');
    const data =
      caseId || patientId
        ? PROPOSAL_SEARCH_ROUTE_MOCK_PROPOSALS.filter(
            (proposal) =>
              (!caseId || proposal.case_id === caseId) &&
              (!patientId || proposal.case_.patient.id === patientId),
          )
        : PROPOSAL_SEARCH_ROUTE_MOCK_PROPOSALS;

    await fulfillJson(route, { data });
  });

  await page.route(
    new RegExp(
      '^(?:https?://[^/]+)?/api/visit-schedule-proposals/(?!billing-preview-batch/?(?:\\?|$))[^/?]+/?(?:\\?.*)?$',
    ),
    async (route) => {
      const proposalId = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').pop() ?? '',
      );
      const proposal = PROPOSAL_SEARCH_ROUTE_MOCK_PROPOSALS.find((item) => item.id === proposalId);
      if (!proposal) {
        await fulfillJson(route, { message: 'Unknown route-mocked proposal' }, 404);
        return;
      }
      await fulfillJson(route, { data: buildProposalBulkRouteMockDetail(proposal) });
    },
  );

  return { billingPreviewRequests, listRequests };
}

test.describe('schedule proposals route-mocked bulk safety smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('filters same-name proposal search to the exact case and preserves 44px controls', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Proposal same-name search proof uses a single chromium route-mocked pass.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 768, height: 1024 });
    const { billingPreviewRequests, listRequests } =
      await installScheduleProposalSearchRouteMocks(page);

    await openStableRoute(
      page,
      `/schedules/proposals?workspace=dashboard&status=proposed&date_from=${PROPOSAL_BULK_DATE}&date_to=${PROPOSAL_BULK_DATE}`,
    );

    await expect(page.getByRole('heading', { name: '訪問候補ダッシュボード' })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => listRequests.length, {
        message: 'same-name proposal dashboard should fetch proposals through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => billingPreviewRequests.length, {
        message: 'same-name proposal dashboard should keep billing previews route-mocked',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    const firstTarget = proposalBulkTargetName('佐藤太郎', '09:00 - 10:00', {
      caseId: PROPOSAL_SEARCH_CASE_A_ID,
      proposalId: PROPOSAL_SEARCH_A_ID,
    });
    const secondTarget = proposalBulkTargetName('佐藤太郎', '10:30 - 11:30', {
      caseId: PROPOSAL_SEARCH_CASE_B_ID,
      proposalId: PROPOSAL_SEARCH_B_ID,
    });
    await expect(
      page.getByRole('button', { name: `${firstTarget} の確定フローを開く` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${secondTarget} の確定フローを開く` }),
    ).toBeVisible();

    await page.getByLabel('ケース/患者検索').fill('佐藤');
    const secondSearchResult = page.getByRole('button', {
      name: `佐藤太郎 / ケース ${shortEntityIdentifier(PROPOSAL_SEARCH_CASE_B_ID)} / 患者識別 ${shortEntityIdentifier(PROPOSAL_SEARCH_PATIENT_B_ID)} / 主担当 薬剤師A で候補を絞り込む`,
    });
    await expect(secondSearchResult).toBeVisible();
    await expect(secondSearchResult).not.toContainText('東京都中央区2-2-2');
    await expectMinTouchBox(secondSearchResult, 'same-name second search result');
    await secondSearchResult.click();

    await expect
      .poll(
        () => {
          const latestUrl = listRequests.at(-1)?.url;
          if (!latestUrl) return false;
          const params = new URL(latestUrl).searchParams;
          return (
            params.get('case_id') === PROPOSAL_SEARCH_CASE_B_ID &&
            params.get('patient_id') === PROPOSAL_SEARCH_PATIENT_B_ID
          );
        },
        {
          message: 'same-name search should refetch proposals for the exact selected case/patient',
          timeout: 15_000,
        },
      )
      .toBe(true);

    await expect(
      page.getByRole('button', { name: `${firstTarget} の確定フローを開く` }),
    ).toHaveCount(0);
    const detailButton = page.getByRole('button', { name: `${secondTarget} の確定フローを開く` });
    const approveButton = page.getByRole('button', {
      name: `${secondTarget} を承認して患者連絡へ進める`,
    });
    const proposalCheckbox = page.getByRole('checkbox', { name: `${secondTarget} の候補を選択` });
    await expect(detailButton).toBeVisible();
    await expect(approveButton).toBeVisible();
    await expectMinTouchBox(detailButton, 'same-name filtered detail button');
    await expectMinTouchBox(approveButton, 'same-name filtered approve button');
    await expectMinTouchBox(proposalCheckbox, 'same-name filtered proposal checkbox');

    await detailButton.click();
    const detailDialog = page.getByRole('dialog', { name: '訪問日時確定フロー' });
    await expect(detailDialog).toBeVisible();
    await expectMinTouchBox(
      detailDialog.getByRole('button', { name: `${secondTarget} を承認して患者連絡へ進める` }),
      'same-name detail approve button',
    );

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('東京都千代田区1-1-1 RouteMock');
    expect(bodyText).not.toContain('東京都中央区2-2-2 RouteMock');
    expect(errors).toEqual([]);
  });

  test('keeps proposal bulk reject keyboard flow PHI-minimized and target-specific', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Proposal bulk keyboard proof uses a single chromium route-mocked pass.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    const { billingPreviewRequests, listRequests, patchRequests } =
      await installScheduleProposalBulkRouteMocks(page);

    await openStableRoute(
      page,
      `/schedules/proposals?workspace=dashboard&status=proposed&date_from=${PROPOSAL_BULK_DATE}&date_to=${PROPOSAL_BULK_DATE}`,
    );

    await expect(page.getByRole('heading', { name: '訪問候補ダッシュボード' })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => listRequests.length, {
        message: 'proposal dashboard should fetch proposals through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => billingPreviewRequests.length, {
        message: 'proposal dashboard should keep billing previews route-mocked',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByText('山田花子')).toBeVisible();
    await expect(page.getByText('佐藤太郎')).toBeVisible();

    const selectAllCheckbox = page.getByRole('checkbox', { name: '表示中の候補をすべて選択' });
    await selectAllCheckbox.focus();
    await expect(selectAllCheckbox).toBeFocused();
    await page.keyboard.press('Space');
    const successTarget = proposalBulkTargetName('山田花子', '09:00 - 10:00', {
      caseId: 'proposal_bulk_route_mock_case_success',
      proposalId: PROPOSAL_BULK_SUCCESS_ID,
    });
    const failureTarget = proposalBulkTargetName('佐藤太郎', '10:30 - 11:30', {
      caseId: 'proposal_bulk_route_mock_case_failure',
      proposalId: PROPOSAL_BULK_FAILURE_ID,
    });
    await expect(
      page.getByRole('checkbox', { name: `${successTarget} の候補を選択` }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByRole('checkbox', { name: `${failureTarget} の候補を選択` }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByRole('button', { name: `${successTarget} の確定フローを開く` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${failureTarget} の確定フローを開く` }),
    ).toBeVisible();

    const rejectButton = page.getByRole('button', {
      name: '選択中2件の訪問候補を一括却下',
    });
    await expect(rejectButton).toBeEnabled();
    await rejectButton.focus();
    await expect(rejectButton).toBeFocused();
    await page.keyboard.press('Enter');

    const rejectDialog = page.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括却下しますか',
    });
    await expect(rejectDialog).toBeVisible();
    const rejectReasonInput = rejectDialog.getByLabel('却下理由');
    const confirmRejectButton = rejectDialog.getByRole('button', { name: '2件を一括却下' });
    await expect(rejectReasonInput).toBeFocused();
    await expect(rejectReasonInput).toHaveAttribute('aria-invalid', 'true');
    await expect(confirmRejectButton).toBeDisabled();

    await rejectReasonInput.fill(`  ${PROPOSAL_BULK_REJECT_REASON}  `);
    await expect(confirmRejectButton).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(rejectDialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmRejectButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => patchRequests.length, {
        message: 'bulk reject should PATCH both selected proposals through the route mock',
        timeout: 10_000,
      })
      .toBe(2);
    const patchBodiesByProposalId = new Map(
      patchRequests.map((request) => [
        new URL(request.url).pathname.split('/').pop(),
        request.body,
      ]),
    );
    expect(patchBodiesByProposalId.get(PROPOSAL_BULK_SUCCESS_ID)).toEqual({
      action: 'reject',
      reject_reason: PROPOSAL_BULK_REJECT_REASON,
    });
    expect(patchBodiesByProposalId.get(PROPOSAL_BULK_FAILURE_ID)).toEqual({
      action: 'reject',
      reject_reason: PROPOSAL_BULK_REJECT_REASON,
    });

    const toast = page.locator('[data-sonner-toast]').filter({
      hasText:
        '2件中1件を処理しました。1件は未更新です。選択中の候補を確認して再試行してください。',
    });
    await expect(toast).toBeVisible();
    const toastText = (await page.locator('[data-sonner-toast]').allInnerTexts()).join('\n');
    expect(toastText).not.toContain('山田花子');
    expect(toastText).not.toContain('佐藤太郎');
    expect(toastText).not.toContain('東京都新宿区9-9-9');
    expect(toastText).not.toContain('090-1234-5678');
    expect(toastText).not.toContain('アムロジピン');

    const partialAlert = page.getByTestId('proposal-bulk-partial-failure');
    await expect(partialAlert).toBeVisible();
    await expect(partialAlert).toContainText('2件中1件を処理しました。1件は未更新です。');
    await expect(partialAlert).toContainText('佐藤太郎');
    await expect(partialAlert).toContainText('2026/05/08');
    await expect(partialAlert).toContainText('薬剤師A');
    await expect(partialAlert).toContainText('社用車A');
    await expect(partialAlert).toContainText(
      '未更新理由: サーバー側の状態変更または入力確認により未更新です。再取得後に候補状態を確認してください。',
    );
    await expect(partialAlert).not.toContainText('東京都新宿区9-9-9');
    await expect(partialAlert).not.toContainText('090-1234-5678');
    await expect(partialAlert).not.toContainText('アムロジピン');
    await expect(partialAlert).not.toContainText('処方詳細');

    await expect(
      page.getByRole('checkbox', { name: `${successTarget} の候補を選択` }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByRole('checkbox', { name: `${failureTarget} の候補を選択` }),
    ).toHaveAttribute('aria-checked', 'true');

    await partialAlert
      .getByRole('button', {
        name: `佐藤太郎 2026/05/08 10:30 - 11:30 / 候補 ${shortEntityIdentifier(PROPOSAL_BULK_FAILURE_ID)} の未更新候補を詳細で確認`,
      })
      .click();
    await expect(page.getByTestId('schedule-proposal-active-row')).toContainText('佐藤太郎');
    await expect(page.getByRole('dialog', { name: '訪問日時確定フロー' })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('schedule-proposals-bulk-reject-keyboard.png'),
      fullPage: true,
    });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('東京都新宿区9-9-9');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('アムロジピン');
    expect(bodyText).not.toContain('処方詳細');
    const unexpectedErrors = errors.filter((message) => {
      const isExpectedHttpFailure =
        message ===
        `http:409 http://localhost:3012/api/visit-schedule-proposals/${PROPOSAL_BULK_FAILURE_ID}`;
      const isExpectedConsoleFailure =
        message ===
        'console:Failed to load resource: the server responded with a status of 409 (Conflict)';

      return !isExpectedHttpFailure && !isExpectedConsoleFailure;
    });
    expect(unexpectedErrors).toEqual([]);
  });
});

test.describe('schedule day route-mocked Gantt smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachRouteMockSession(context);
  });

  test('keeps tablet portrait Gantt overflow inside the scroll region', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Tablet Gantt portrait proof uses an explicit chromium viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 768, height: 1024 });
    const { dayBoardRequests } = await installScheduleDayGanttRouteMocks(page);

    await openStableRoute(page, `/schedules?view=list&tab=confirmed&date=${GANTT_DATE}`);

    await expect
      .poll(() => dayBoardRequests.length, {
        message: 'schedule Gantt smoke should fetch the day board through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const board = page.getByRole('region', { name: '今日のスケジュール — 全員' });
    await expect(board.getByRole('heading', { name: '今日のスケジュール — 全員' })).toBeVisible({
      timeout: 30_000,
    });

    const pharmacistAList = board.getByRole('list', { name: '薬剤師A(薬)の今日の予定' });
    const pharmacistBList = board.getByRole('list', { name: '薬剤師B(薬)の今日の予定' });
    await expect(pharmacistAList).toBeVisible();
    await expect(pharmacistBList).toBeVisible();
    await expect(
      pharmacistAList.getByRole('listitem', { name: /ガントE2E 同時A様、準備チェック完了/ }),
    ).toBeVisible();
    await expect(
      pharmacistAList.getByRole('listitem', {
        name: /ガントE2E 同時B様、準備 2\/5、未完: 持参薬・物品確認/,
      }),
    ).toBeVisible();
    await expect(
      pharmacistBList.getByRole('listitem', {
        name: /ガントE2E 連鎖重なり三号様、準備チェック完了/,
      }),
    ).toBeVisible();
    await expect(board.getByRole('region', { name: '車両リソース' })).toBeVisible();
    await expect(board.getByRole('region', { name: '訪問ルート' })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);

    await page.screenshot({
      path: testInfo.outputPath('schedule-day-gantt-tablet-portrait.png'),
      fullPage: true,
    });

    const workRequestLink = pharmacistAList.getByRole('link', {
      name: 'ガントE2E 同時A様の訪問を依頼',
    });
    await expect(workRequestLink).toHaveAttribute(
      'href',
      /work_request_type=staff_work_request_visit/,
    );
    await expectMinTouchBox(workRequestLink, 'schedule board work-request link');

    expect(errors).toEqual([]);
  });

  test('keeps tablet landscape Gantt labels and overlap stacks readable', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Tablet Gantt landscape proof uses an explicit chromium viewport.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1024, height: 768 });
    const { dayBoardRequests } = await installScheduleDayGanttRouteMocks(page);

    await openStableRoute(page, `/schedules?view=list&tab=confirmed&date=${GANTT_DATE}`);

    await expect
      .poll(() => dayBoardRequests.length, {
        message: 'schedule Gantt smoke should fetch the day board through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    const board = page.getByRole('region', { name: '今日のスケジュール — 全員' });
    await expect(board).toBeVisible();
    await expect(board.getByText('余白 360分')).toBeVisible();
    await expect(board.getByText('余白 330分')).toBeVisible();
    await expect(
      board.getByRole('listitem', { name: /ガントE2E 重なり長い患者名一号様、準備 2\/5/ }),
    ).toBeVisible();
    await expect(
      board.getByRole('listitem', { name: /ガントE2E 連鎖重なり三号様、準備チェック完了/ }),
    ).toBeVisible();
    const routeRegion = board.getByRole('region', { name: '訪問ルート' });
    await expect(routeRegion).toBeVisible();
    await expect(
      routeRegion
        .getByRole('listitem')
        .filter({ hasText: 'ガントE2E 重なり長い患者名一号様' })
        .filter({ hasText: '09:30 / 車両未割当' }),
    ).toBeVisible();
    await expect(
      routeRegion
        .getByRole('listitem')
        .filter({ hasText: 'ガントE2E 連鎖重なり三号様' })
        .filter({ hasText: '10:30 / 車両未割当' }),
    ).toBeVisible();
    await expect(board.getByRole('region', { name: '車両リソース' })).toContainText(
      'RouteMock 軽バン',
    );

    await expectNoPageHorizontalOverflow(page);
    await expectNoVisibleBoxOverlap(routeRegion.getByRole('listitem'));

    await page.screenshot({
      path: testInfo.outputPath('schedule-day-gantt-tablet-landscape.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});

test.describe('shared external viewer route-mocked smoke', () => {
  test('strips OTP query from shared URL and sends OTP only as request header', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    const { selfReportRequests, viewerRequests } = await installSharedViewerRouteMock(page);

    await openStableRoute(page, `/shared/${SHARED_TOKEN}?otp=${SHARED_OTP}`);

    await expect(page).toHaveURL(new RegExp(`/shared/${SHARED_TOKEN}$`));
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByLabel('OTP')).toHaveValue('');
    expect(viewerRequests).toHaveLength(0);

    for (let attempt = 0; attempt < 3 && viewerRequests.length === 0; attempt += 1) {
      const otpInput = page.getByLabel('OTP');
      await otpInput.fill('');
      await otpInput.pressSequentially(SHARED_OTP);
      await expect(otpInput).toHaveValue(SHARED_OTP);
      await page.getByRole('button', { name: '閲覧する' }).click();
      await expect
        .poll(() => viewerRequests.length, { timeout: 3_000 })
        .toBeGreaterThan(0)
        .catch(() => null);
    }

    await expect
      .poll(() => viewerRequests.length, {
        message: 'shared viewer should fetch with route-mocked OTP header',
        timeout: 10_000,
      })
      .toBe(1);
    await expect(page.getByText('共有E2E 患者')).toBeVisible();
    await expect(page.getByText('血圧と服薬状況を家族と共有')).toBeVisible();
    expect(viewerRequests[0]?.headers['x-otp']).toBe(SHARED_OTP);
    expect(new URL(viewerRequests[0]!.url).searchParams.has('otp')).toBe(false);

    await page.getByLabel('報告者氏名').fill('共有E2E 家族');
    await page.getByLabel('件名').fill('残薬が増えてきた');
    await page.getByLabel('内容').fill('夕食後の薬が残っています。');
    await page.getByRole('button', { name: '薬局へ送信' }).click();

    await expect
      .poll(() => selfReportRequests.length, {
        message: 'shared viewer should submit self-report with OTP header only',
        timeout: 10_000,
      })
      .toBe(1);
    expect(selfReportRequests[0]?.headers['x-otp']).toBe(SHARED_OTP);
    expect(new URL(selfReportRequests[0]!.url).searchParams.has('otp')).toBe(false);
    expect(selfReportRequests[0]?.body).toMatchObject({
      reported_by_name: '共有E2E 家族',
      subject: '残薬が増えてきた',
      content: '夕食後の薬が残っています。',
    });
    expect(selfReportRequests[0]?.body).not.toHaveProperty('otp');
    expect(page.url()).not.toContain(SHARED_OTP);
    expect(errors).toEqual([]);
  });
});

test.describe('pharmacy cooperation route-mocked browser workflow smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('proves share consent, link activation, visit, billing, and report draft flow', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    const requests = await installPharmacyCooperationRouteMocks(page);

    await openStableRoute(page, '/workflow/pharmacy-cooperation');
    await expect(page.getByTestId('pharmacy-cooperation-workflow')).toBeVisible({
      timeout: 30_000,
    });
    const shareCasesTable = page.getByRole('table', { name: '患者共有ケース一覧' });
    const shareCaseRow = shareCasesTable.getByRole('row').filter({
      hasText: PHARMACY_COOP_SHARE_CASE_ID,
    });
    await expect(shareCaseRow).toBeVisible();
    await expect(page.getByText('薬局間RouteMock 患者')).toHaveCount(0);
    await expect(page.getByText('東京都千代田区RouteMock')).toHaveCount(0);

    await page.getByLabel('患者共有同意日').fill('2026-06-19');
    await page.getByLabel('患者共有同意者').fill('患者家族 RouteMock');
    await page.getByLabel('患者共有同意記録ID').fill('pharmacy_coop_route_consent_record');
    await page.getByLabel('患者共有同意添付ID').fill('pharmacy_coop_route_file');
    await page.getByLabel('患者共有同意有効期限').fill('2026-12-31');
    await page.getByLabel('患者共有同意PDF出力').check();
    await page.getByLabel('患者共有同意添付閲覧').check();
    await page.getByRole('button', { name: /同意登録/ }).click();

    await expect
      .poll(
        () =>
          requests.patientShareConsents.some(
            (request) =>
              request.method === 'POST' &&
              (request.body as { consent_record_id?: string } | null)?.consent_record_id ===
                'pharmacy_coop_route_consent_record',
          ),
        { message: 'workflow should register consent with file attachment scope' },
      )
      .toBe(true);
    await expect(shareCaseRow.getByText('協力薬局確認待ち')).toBeVisible({ timeout: 10_000 });

    await shareCaseRow.getByRole('button', { name: /基幹承認/ }).click();
    await expect(page.getByRole('heading', { name: '患者リンクを基幹承認します' })).toBeVisible();
    await page.getByRole('button', { name: '基幹承認する' }).click();
    await expect
      .poll(
        () =>
          requests.patientLinks.some(
            (request) =>
              request.method === 'PATCH' &&
              (request.body as { decision?: string } | null)?.decision === 'base_approve',
          ),
        { message: 'workflow should base-approve the patient link' },
      )
      .toBe(true);

    await shareCaseRow
      .getByLabel(`${PHARMACY_COOP_SHARE_CASE_ID} の協力側ID`)
      .fill('route_partner_patient');
    await shareCaseRow
      .getByLabel(`${PHARMACY_COOP_SHARE_CASE_ID} の協力側氏名`, { exact: true })
      .fill('連携 確認');
    await shareCaseRow
      .getByLabel(`${PHARMACY_COOP_SHARE_CASE_ID} の協力側生年月日`)
      .fill('1942-04-12');
    await shareCaseRow.getByRole('button', { name: /協力受諾/ }).click();
    await expect(page.getByRole('heading', { name: '患者リンクを協力受諾します' })).toBeVisible();
    await page.getByRole('button', { name: '協力受諾する' }).click();
    await expect
      .poll(
        () =>
          requests.patientLinks.some(
            (request) =>
              request.method === 'PATCH' &&
              (request.body as { decision?: string } | null)?.decision === 'accept',
          ),
        { message: 'workflow should accept the patient link after identity confirmation' },
      )
      .toBe(true);

    await expect(shareCaseRow.getByText('承認済み')).toBeVisible({ timeout: 10_000 });
    await shareCaseRow.getByRole('button', { name: /共有開始/ }).click();
    await expect(
      page.getByRole('heading', { name: '患者共有ケースを共有開始します' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '共有開始する' }).click();
    await expect
      .poll(() => requests.shareCaseActivations.length, {
        message: 'workflow should activate the patient share case',
      })
      .toBe(1);
    await expect(shareCaseRow.getByText('共有中')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByLabel('薬局間連携メッセージ本文')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('薬局間連携メッセージ本文').fill('共有ケースの確認事項です');
    await page.getByRole('button', { name: /メッセージ送信/ }).click();
    await expect
      .poll(
        () =>
          requests.messageThreads.some((request) => {
            const body = request.body as {
              share_case_id?: string;
              visit_request_id?: string;
            } | null;
            return (
              request.method === 'POST' &&
              body?.share_case_id === PHARMACY_COOP_SHARE_CASE_ID &&
              body.visit_request_id === undefined
            );
          }),
        { message: 'workflow should post a share-case scoped cooperation message' },
      )
      .toBe(true);
    await expect(page.getByText('共有ケースの確認事項です')).toBeVisible({ timeout: 10_000 });

    await page.getByLabel('訪問依頼の希望開始').fill('2026-06-20T10:30');
    await page.getByLabel('訪問依頼の希望終了').fill('2026-06-20T11:30');
    await page.getByLabel('訪問依頼の依頼理由').fill('退院直後の服薬確認が必要です');
    await page.getByLabel('訪問依頼の医師指示').fill('血圧と副作用を確認');
    await page.getByLabel('訪問依頼の持参薬・物品').fill('分包済み一包\n残薬バッグ');
    await page.getByLabel('訪問依頼の居宅注意事項').fill('家族同席予定');
    await page.getByRole('button', { name: /訪問依頼を作成/ }).click();

    await expect
      .poll(
        () =>
          requests.visitRequests.some(
            (request) =>
              request.method === 'POST' && request.url.includes('/api/pharmacy-visit-requests'),
          ),
        { message: 'workflow should create a pharmacy visit request' },
      )
      .toBe(true);
    const createVisitRequest = requests.visitRequests.find((request) => request.method === 'POST');
    expect(createVisitRequest?.body).toMatchObject({
      share_case_id: PHARMACY_COOP_SHARE_CASE_ID,
      urgency: 'normal',
      visit_type: 'regular',
      request_reason: '退院直後の服薬確認が必要です',
      physician_instruction: '血圧と副作用を確認',
      carry_items: ['分包済み一包', '残薬バッグ'],
      patient_home_notes: '家族同席予定',
    });
    await expect(page.getByText('退院直後の服薬確認が必要です')).toHaveCount(0);

    const visitRequestsTable = page.getByRole('table', { name: '協力薬局訪問依頼一覧' });
    await expect(
      visitRequestsTable.getByRole('row').filter({ hasText: PHARMACY_COOP_VISIT_REQUEST_ID }),
    ).toBeVisible({ timeout: 10_000 });
    const messageTargetSelect = page.getByLabel('メッセージの対象');
    await expect(
      messageTargetSelect.locator('option', { hasText: PHARMACY_COOP_VISIT_REQUEST_ID }),
    ).toHaveCount(1);
    await messageTargetSelect.selectOption(PHARMACY_COOP_VISIT_REQUEST_ID);
    await page.getByLabel('薬局間連携メッセージ本文').fill('訪問依頼の確認事項です');
    await page.getByRole('button', { name: /メッセージ送信/ }).click();
    await expect
      .poll(
        () =>
          requests.messageThreads.some((request) => {
            const body = request.body as {
              share_case_id?: string;
              visit_request_id?: string;
            } | null;
            return (
              request.method === 'POST' &&
              body?.share_case_id === PHARMACY_COOP_SHARE_CASE_ID &&
              body.visit_request_id === PHARMACY_COOP_VISIT_REQUEST_ID
            );
          }),
        { message: 'workflow should post a visit-request scoped cooperation message' },
      )
      .toBe(true);
    await expect(page.getByText('訪問依頼の確認事項です')).toBeVisible({ timeout: 10_000 });

    await visitRequestsTable
      .getByRole('button', {
        name: `${PHARMACY_COOP_VISIT_REQUEST_ID} RouteMock協力薬局 の訪問依頼を受諾`,
      })
      .click();
    await expect(page.getByRole('heading', { name: '訪問依頼を受諾します' })).toBeVisible();
    await page.getByRole('button', { name: '受諾する' }).click();
    await expect
      .poll(
        () =>
          requests.visitRequestDecisions.some(
            (request) =>
              request.method === 'POST' &&
              (request.body as { decision?: string } | null)?.decision === 'accept',
          ),
        { message: 'workflow should accept the visit request' },
      )
      .toBe(true);

    await page.getByLabel('協力訪問記録の訪問日時').fill('2026-06-20T10:45');
    await page.getByLabel('協力訪問記録の薬剤師ID').fill('route_pharmacist');
    await page.getByLabel('協力訪問記録の薬剤師名').fill('協力 RouteMock');
    await page.getByLabel('協力訪問記録の元記録ID').fill('source_visit_record_route');
    await page.getByLabel('協力訪問記録の服薬状況').fill('確認済み');
    await page.getByLabel('協力訪問記録の残薬').fill('残薬なし');
    await page.getByLabel('協力訪問記録の副作用疑い').fill('疑いなし');
    await page.getByLabel('協力訪問記録の保管状況').fill('良好');
    await page.getByLabel('協力訪問記録の提案').fill('継続確認');
    await page.getByRole('button', { name: /下書き保存/ }).click();

    await expect
      .poll(
        () =>
          requests.partnerVisitRecords.some(
            (request) =>
              request.method === 'POST' && request.url.includes('/api/partner-visit-records'),
          ),
        { message: 'workflow should save a partner visit record draft' },
      )
      .toBe(true);
    const createRecordRequest = requests.partnerVisitRecords.find(
      (request) => request.method === 'POST',
    );
    expect(createRecordRequest?.body).toMatchObject({
      visit_request_id: PHARMACY_COOP_VISIT_REQUEST_ID,
      pharmacist_id: 'route_pharmacist',
      pharmacist_name: '協力 RouteMock',
      source_visit_record_id: 'source_visit_record_route',
      record_content: {
        medication_adherence: '確認済み',
        remaining_medications: '残薬なし',
        suspected_adverse_effects: '疑いなし',
        storage_status: '良好',
        proposals: '継続確認',
      },
    });

    const partnerRecordsTable = page.getByRole('table', { name: '協力訪問記録一覧' });
    const partnerRecordRow = partnerRecordsTable.getByRole('row').filter({
      hasText: PHARMACY_COOP_PARTNER_RECORD_ID,
    });
    await expect(partnerRecordRow).toBeVisible({ timeout: 10_000 });
    await partnerRecordRow
      .getByRole('button', {
        name: `${PHARMACY_COOP_PARTNER_RECORD_ID} RouteMock協力薬局 の協力訪問記録を提出`,
      })
      .click();
    await expect(page.getByRole('heading', { name: '協力訪問記録を提出します' })).toBeVisible();
    await page.getByRole('button', { name: '提出する' }).click();
    await expect
      .poll(() => requests.partnerVisitRecordSubmits.length, {
        message: 'workflow should submit the partner visit record',
      })
      .toBe(1);
    await partnerRecordRow
      .getByRole('button', {
        name: `${PHARMACY_COOP_PARTNER_RECORD_ID} RouteMock協力薬局 の協力訪問記録を確認して報告書ドラフトを作成`,
      })
      .click();
    await expect(
      page.getByRole('heading', {
        name: '協力訪問記録を確認し報告書ドラフトを作成します',
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: '確認+報告する' }).click();
    await expect
      .poll(
        () =>
          requests.partnerVisitRecordReviews.some(
            (request) =>
              request.method === 'POST' &&
              (request.body as { decision?: string; doctor_report_required?: boolean } | null)
                ?.decision === 'confirm' &&
              (request.body as { doctor_report_required?: boolean } | null)
                ?.doctor_report_required === true,
          ),
        { message: 'workflow should confirm the partner record with report requirement' },
      )
      .toBe(true);

    await partnerRecordRow
      .getByRole('button', {
        name: `${PHARMACY_COOP_PARTNER_RECORD_ID} RouteMock協力薬局 の報告書ドラフトを作成`,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: '医師向け報告書ドラフトを作成します' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '報告書ドラフトを作成する' }).click();
    await expect
      .poll(() => requests.reportDrafts.length, {
        message: 'workflow should create a physician report draft',
      })
      .toBe(1);
    await expect(page.getByTestId('pharmacy-cooperation-report-result')).toBeVisible();
    await expect(page.getByRole('link', { name: /報告書を開く/ })).toHaveAttribute(
      'href',
      `/reports/${PHARMACY_COOP_REPORT_ID}`,
    );

    await openStableRoute(page, '/billing/partner-cooperation');
    await expect(page.getByTestId('partner-cooperation-billing')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel('対象月').fill('2026-06');
    await expect(page.getByText(/選択中: RouteMock基幹薬局/)).toBeVisible();
    await page.getByRole('button', { name: /候補を生成/ }).click();
    await expect
      .poll(
        () =>
          requests.billingCandidates.some(
            (request) =>
              request.method === 'POST' && request.url.includes('/api/visit-billing-candidates'),
          ),
        { message: 'billing page should generate partner cooperation billing candidates' },
      )
      .toBe(true);
    const billingPost = requests.billingCandidates.find((request) => request.method === 'POST');
    expect(billingPost?.body).toEqual({ billing_month: PHARMACY_COOP_BILLING_MONTH });
    const billingCandidatesTable = page.getByRole('table', {
      name: '薬局間協力請求候補一覧',
    });
    await expect(page.getByLabel('請求候補内検索')).toBeVisible();
    await page.getByLabel('請求候補内検索').fill('RouteMock協力薬局');
    const billingCandidateRow = billingCandidatesTable
      .getByRole('row')
      .filter({ hasText: 'RouteMock協力薬局' })
      .filter({ hasText: '8,800円' });
    await expect(billingCandidateRow).toBeVisible({
      timeout: 10_000,
    });
    await expect(billingCandidateRow.getByText('有償/加算')).toBeVisible();
    await page.getByLabel('請求候補内検索').clear();
    await page.getByRole('button', { name: /請求書ドラフト/ }).click();
    await expect
      .poll(
        () =>
          requests.pharmacyInvoices.some(
            (request) =>
              request.method === 'POST' && request.url.includes('/api/pharmacy-invoices'),
          ),
        { message: 'billing page should create an invoice draft' },
      )
      .toBe(true);
    const invoicePost = requests.pharmacyInvoices.find((request) => request.method === 'POST');
    expect(invoicePost?.body).toMatchObject({
      billing_month: PHARMACY_COOP_BILLING_MONTH,
      contract_id: PHARMACY_COOP_CONTRACT_ID,
      document_kind: 'invoice',
    });
    const invoiceDraftResult = page.getByTestId('partner-invoice-draft-result');
    await expect(invoiceDraftResult).toBeVisible();
    await expect(invoiceDraftResult.getByRole('link', { name: /PDFを開く/ })).toHaveAttribute(
      'href',
      new RegExp(`/api/pharmacy-invoices/${PHARMACY_COOP_INVOICE_ID}/pdf\\?purpose=`),
    );
    await expect(page.getByLabel('月次ドキュメント内検索')).toBeVisible();
    await page.getByLabel('月次ドキュメント内検索').fill('RM-COOP-001');
    await expect(
      page
        .getByRole('table', { name: '薬局間月次ドキュメント一覧' })
        .getByRole('row')
        .filter({ hasText: 'RM-COOP-001' })
        .filter({ hasText: '9,680円' }),
    ).toBeVisible();
    const overflowWidth = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowWidth).toBeLessThanOrEqual(1);
    const axeResults = await new AxeBuilder({ page })
      .include('[data-testid="partner-cooperation-billing"]')
      .analyze();
    const severeViolations = axeResults.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    );
    expect(summarizeAxeViolations(severeViolations)).toEqual([]);
    await expect(page.getByText('薬局間RouteMock 患者')).toHaveCount(0);
    await expect(page.getByText('東京都千代田区RouteMock')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('billing candidates route-mocked workbench smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('preserves patient and month query context while disabling patient-filtered close', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/dashboard');
    await expect(page.getByTestId('app-shell-main')).toBeVisible();
    errors.length = 0;

    const requests = await installBillingWorkbenchRouteMocks(page);
    await openStableRoute(
      page,
      `/billing/candidates?billing_month=${BILLING_MONTH}&patient_id=${BILLING_PATIENT_ID}&workflow_from=visit_record&visit_record_id=visit_route_mock_record&schedule_id=visit_route_mock_schedule`,
    );

    await expect(page.getByRole('heading', { name: '月次請求候補' })).toBeVisible();
    await expect
      .poll(() => requests.length, {
        message: 'billing candidates GET should be route-mocked',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: '訪問記録から確認中' })).toBeVisible();
    await expect(page.getByRole('link', { name: '訪問記録へ戻る' })).toHaveAttribute(
      'href',
      '/visits/visit_route_mock_record',
    );
    await expect(page.getByText(/visit_record_id:/)).toHaveCount(0);
    await expect(page.getByText(/schedule_id:/)).toHaveCount(0);
    await expect(page.getByText('患者で絞り込み中', { exact: true })).toBeVisible();
    await expect(page.getByText(`患者ID ${BILLING_PATIENT_ID}`)).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: '請求RouteMock 患者' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '月次締め' })).toBeDisabled();

    const listRequestUrls = requests
      .filter((request) => request.method === 'GET')
      .map((request) => new URL(request.url));
    expect(
      listRequestUrls.some((url) => url.searchParams.get('billing_month') === BILLING_MONTH),
    ).toBe(true);
    expect(
      listRequestUrls.some((url) => url.searchParams.get('patient_id') === BILLING_PATIENT_ID),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('formulary route-mocked management smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachRouteMockSession(context);
  });

  test('shows adopted-drug impact queues and runs freshness check', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context);
    const { impactRequests, jobRequests } = await installFormularyRouteMocks(page);

    await openStableRoute(page, '/admin/formulary');

    await expect(page.getByRole('heading', { name: '採用薬マスター' })).toBeVisible();
    await expect(page.getByText('採用薬リスト運用')).toBeVisible();
    await expect(page.getByText('影響レビューキュー')).toBeVisible();
    await expect(page.getByRole('button', { name: /ハイリスク採用品/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /LASA注意採用品/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /規制薬採用品/ })).toBeVisible();
    await expect(page.getByText('RouteMock 採用薬錠5mg').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: '鮮度チェック' })).toBeVisible();

    await page.getByRole('button', { name: /ハイリスク採用品/ }).click();
    await expect
      .poll(
        () =>
          impactRequests.some(
            (request) => new URL(request.url).searchParams.get('queue') === 'high_risk',
          ),
        {
          message: 'formulary impact route should be queried with the high-risk queue',
          timeout: 10_000,
        },
      )
      .toBe(true);

    await page.getByRole('button', { name: /30日以内差分/ }).click();
    await expect
      .poll(
        () =>
          impactRequests.some(
            (request) => new URL(request.url).searchParams.get('queue') === 'recently_changed',
          ),
        {
          message: 'formulary impact route should be queried with the selected queue',
          timeout: 10_000,
        },
      )
      .toBe(true);

    await page.getByRole('button', { name: '鮮度チェック' }).click();
    await expect
      .poll(() => jobRequests.length, {
        message: 'freshness check job should be invoked from the formulary UI',
        timeout: 10_000,
      })
      .toBe(1);
    expect(jobRequests[0]?.method).toBe('POST');
    expect(errors).toEqual([]);
  });

  test('mobile formulary keeps safety actions usable without horizontal overflow', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium');

    const { page, errors } = await createInstrumentedPage(context);
    const { impactRequests } = await installFormularyRouteMocks(page);

    await openStableRoute(page, '/admin/formulary');

    await expect(page.getByRole('heading', { name: '採用薬マスター' })).toBeVisible();
    await expect(page.getByText('影響レビューキュー')).toBeVisible();
    await expect(page.getByText('RouteMock 採用薬錠5mg').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /ハイリスク採用品\s*1/ })).toBeVisible({
      timeout: 15_000,
    });

    const highRiskButton = page.getByRole('button', { name: /ハイリスク採用品/ });
    const followUpButton = page.getByRole('button', { name: '安全性フォローアップ作成' });
    await expect(highRiskButton).toBeVisible();
    await expect(followUpButton).toBeVisible();

    const overflowWidth = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    const highRiskBox = await highRiskButton.boundingBox();
    const followUpBox = await followUpButton.boundingBox();

    await highRiskButton.click();
    await expect
      .poll(
        () =>
          impactRequests.some(
            (request) => new URL(request.url).searchParams.get('queue') === 'high_risk',
          ),
        {
          message: 'mobile formulary should query the high-risk queue',
          timeout: 10_000,
        },
      )
      .toBe(true);

    expect(errors).toEqual([]);
    expect(overflowWidth).toBeLessThanOrEqual(1);
    expect(highRiskBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(followUpBox?.height ?? 0).toBeGreaterThanOrEqual(40);
  });
});

test.describe('visit record route-mocked offline save smoke', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('stores offline SOAP save in encrypted IndexedDB draft and sync queue without POSTing', async ({
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });
    const { preparationRequests, scheduleRequests, visitRecordRequests } =
      await installOfflineVisitRecordRouteMocks(page);

    await openStableRoute(page, `/visits/${OFFLINE_SCHEDULE_ID}/record`);
    await seedOfflineEncryptionKey(page);

    await expect
      .poll(() => scheduleRequests.length, {
        message: 'offline smoke should fetch schedule detail through route mock',
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => preparationRequests.length, {
        message: 'offline smoke should fetch preparation detail through route mock',
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByLabel('主観情報')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('現在オフラインです。保存すると端末に下書きし、再接続後に同期します。'),
    ).toBeVisible();

    const soap = {
      subjective: 'Offline route-mocked S: 食後に眠気あり',
      objective: 'Offline route-mocked O: 残薬1包、血圧安定',
      assessment: 'Offline route-mocked A: 眠気は軽度で経過観察',
      plan: 'Offline route-mocked P: 次回訪問で眠気を再確認',
    };

    await page.getByLabel('主観情報').fill(soap.subjective);
    await page.getByLabel('客観情報').fill(soap.objective);
    await page.getByLabel('薬学的評価').fill(soap.assessment);
    await page.getByLabel('計画・介入').fill(soap.plan);
    await page.getByRole('combobox', { name: /訪問結果/ }).click();
    await page.getByRole('option', { name: '延期' }).click();
    const saveButton = page.getByRole('button', { name: '保存', exact: true });
    await expect(saveButton).toHaveAttribute('type', 'submit');
    await saveButton.click();

    await expect(
      page.getByText('オフラインで下書きを保存しました。再接続後に自動同期します。'),
    ).toBeVisible();
    expect(visitRecordRequests).toHaveLength(0);

    await expect
      .poll(() => readOfflineVisitDraftState(page, OFFLINE_SCHEDULE_ID), {
        message: 'offline visit draft and sync queue should be persisted',
      })
      .toMatchObject({
        draftContainsPlaintext: false,
        queueContainsPlaintext: false,
        queueEntityType: 'visit_record',
        queueScopeId: OFFLINE_SCHEDULE_ID,
      });

    const offlineState = await readOfflineVisitDraftState(page, OFFLINE_SCHEDULE_ID);
    expect(offlineState.draftStructuredSoap?.startsWith('encv1:')).toBe(true);
    expect(offlineState.queuePayload?.startsWith('encv1:')).toBe(true);
    expect(errors).toEqual([]);
  });
});
