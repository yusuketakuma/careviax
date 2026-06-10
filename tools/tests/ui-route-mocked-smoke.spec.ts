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

test.use({ serviceWorkers: 'block' });

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

  await page.route(apiPathPattern('/api/pharmacy-sites'), async (route) => {
    await fulfillJson(route, {
      data: [{ id: FORMULARY_SITE_ID, name: 'RouteMock 本店', address: '東京都千代田区' }],
    });
  });

  await page.route(apiPathPattern('/api/drug-master-imports/status'), async (route) => {
    await fulfillJson(route, {
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
    await fulfillJson(route, { jobType: 'drug-master-freshness-check', processedCount: 1 });
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

  return { routeRequests, scheduleRequests };
}

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
    const { scheduleRequests } = await installScheduleDayGanttRouteMocks(page);

    await openStableRoute(page, `/schedules?view=list&tab=confirmed&date=${GANTT_DATE}`);

    await expect
      .poll(() => scheduleRequests.length, {
        message: 'schedule Gantt smoke should fetch schedules through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'タブレット日次ガント' })).toBeVisible({
      timeout: 30_000,
    });

    const table = page.getByRole('table', {
      name: /日次ガント表。行は時間帯、列は薬剤師、セルは患者訪問予定を示します。/,
    });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /薬剤師A/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /薬剤師B/ })).toBeVisible();
    await expect(table.getByRole('group', { name: /薬剤師 薬剤師A.*同時刻 2件/ })).toHaveCount(2);
    await expect(table.getByRole('group', { name: /薬剤師 薬剤師B.*重なり 3件/ })).toHaveCount(3);

    const scroller = table.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-x-auto ")][1]',
    );
    await expect(scroller).toHaveAttribute('role', 'region');
    await expect(scroller).toHaveAttribute('aria-labelledby', 'schedule-day-gantt-heading');
    await expect(scroller).toHaveAttribute('aria-describedby', 'schedule-day-gantt-scroll-help');
    const scrollMetrics = await scroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth + 100);
    await scroller.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await scroller.focus();
    await expect(scroller).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft), {
        message: 'focused Gantt scroll region should respond to keyboard horizontal scroll',
        timeout: 3_000,
      })
      .toBeGreaterThan(0);
    await expectNoPageHorizontalOverflow(page);
    await expectNoVisibleBoxOverlap(table.locator('[role="group"][aria-label^="薬剤師"]'));

    await page.screenshot({
      path: testInfo.outputPath('schedule-day-gantt-tablet-portrait.png'),
      fullPage: true,
    });

    const confirmedCard = page.locator('#schedule-gantt_route_mock_same_start_1');
    await expect(confirmedCard).toBeVisible();
    const preparationButton = confirmedCard.getByRole('button', {
      name: /ガントE2E 同時A.*訪問準備を開く/,
    });
    await expect(preparationButton).toBeVisible();
    await expect(preparationButton).toBeEnabled();
    await preparationButton.focus();
    await expect(preparationButton).toBeFocused();
    await preparationButton.click();
    await expect(
      page.getByRole('dialog', { name: 'ガントE2E 同時Aの訪問準備チェック' }),
    ).toBeVisible();

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
    const { routeRequests, scheduleRequests } = await installScheduleDayGanttRouteMocks(page);

    await openStableRoute(page, `/schedules?view=list&tab=confirmed&date=${GANTT_DATE}`);

    await expect
      .poll(() => scheduleRequests.length, {
        message: 'schedule Gantt smoke should fetch schedules through the route mock',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => routeRequests.length, {
        message: 'schedule Gantt smoke should keep route preview calls mocked',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    const table = page.getByRole('table', {
      name: /日次ガント表。行は時間帯、列は薬剤師、セルは患者訪問予定を示します。/,
    });
    await expect(page.getByRole('heading', { name: 'タブレット日次ガント' })).toBeVisible();
    await expect(table).toBeVisible();
    await expect(table.getByText('同時刻 2件')).toBeVisible();
    await expect(table.getByText('重なり 3件')).toBeVisible();
    await expect(
      table.getByRole('group', {
        name: /薬剤師 薬剤師B.*患者 ガントE2E 重なり長い患者名一号.*重なり 3件.*ルート順 1/,
      }),
    ).toBeVisible();
    await expect(
      table.getByRole('group', {
        name: /薬剤師 薬剤師B.*患者 ガントE2E 連鎖重なり三号.*重なり 3件.*ルート順 3/,
      }),
    ).toBeVisible();
    await expect(table.getByRole('rowheader', { name: '09:30' })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: '10:30' })).toBeVisible();

    await expectNoPageHorizontalOverflow(page);
    await expectNoVisibleBoxOverlap(table.locator('[role="group"][aria-label^="薬剤師"]'));

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
    await expect(page.getByText('患者で絞り込み中')).toBeVisible();
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
