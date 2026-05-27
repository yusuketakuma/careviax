import { expect, test, type Page, type Route } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import {
  attachLocalSession,
  AUTH_SECRET,
  createInstrumentedPage,
  LOCAL_USER,
  waitForStableUi,
} from './helpers/local-auth';

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

test.use({ serviceWorkers: 'block' });

type CapturedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

function readRouteBody(route: Route) {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

function captureRouteRequest(route: Route): CapturedRequest {
  const request = route.request();
  return {
    method: request.method(),
    url: request.url(),
    headers: request.headers(),
    body: readRouteBody(route),
  };
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

async function installSharedViewerRouteMock(page: Page) {
  const viewerRequests: CapturedRequest[] = [];
  const selfReportRequests: CapturedRequest[] = [];

  await page.route(`**/api/external-access/${SHARED_TOKEN}/self-report`, async (route) => {
    selfReportRequests.push(captureRouteRequest(route));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id: 'shared_route_mock_self_report' } }),
    });
  });

  await page.route(`**/api/external-access/${SHARED_TOKEN}`, async (route) => {
    viewerRequests.push(captureRouteRequest(route));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  return { selfReportRequests, viewerRequests };
}

async function installBillingWorkbenchRouteMocks(page: Page) {
  const requests: CapturedRequest[] = [];

  await page.route('**/api/billing-candidates**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() !== 'GET' || requestUrl.pathname !== '/api/billing-candidates') {
      await route.continue();
      return;
    }

    requests.push(captureRouteRequest(route));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  return requests;
}

async function installFormularyRouteMocks(page: Page) {
  const impactRequests: CapturedRequest[] = [];
  const jobRequests: CapturedRequest[] = [];

  await page.route('**/api/notifications/stream**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route(/\/api\/notifications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], hasMore: false, nextCursor: null }),
    });
  });

  await page.route('**/api/pharmacy-sites**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: FORMULARY_SITE_ID, name: 'RouteMock 本店', address: '東京都千代田区' }],
      }),
    });
  });

  await page.route('**/api/drug-master-imports/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route('**/api/drug-master-import-logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/pharmacy-drug-stocks/impact**', async (route) => {
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route(/\/api\/pharmacy-drug-stocks(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        site: { id: FORMULARY_SITE_ID, name: 'RouteMock 本店' },
        data: [],
      }),
    });
  });

  await page.route('**/api/pharmacy-drug-stock-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/pharmacy-drug-stocks/usage-mismatch**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route('**/api/pharmacy-drug-stock-requests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [],
        summary: {
          status: 'pending',
          total_count: 0,
          overdue_count: 0,
          overdue_days: 7,
          oldest_pending_created_at: null,
          notification_level: 'clear',
        },
      }),
    });
  });

  await page.route('**/api/drug-masters**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname !== '/api/drug-masters') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route(`**/api/drug-masters/${FORMULARY_DRUG_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route(
    `**/api/drug-masters/${FORMULARY_DRUG_ID}/generic-recommendations**`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    },
  );

  await page.route('**/api/jobs/drug-master-freshness-check', async (route) => {
    jobRequests.push(captureRouteRequest(route));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobType: 'drug-master-freshness-check', processedCount: 1 }),
    });
  });

  return { impactRequests, jobRequests };
}

async function installOfflineVisitRecordRouteMocks(page: Page) {
  const visitRecordRequests: CapturedRequest[] = [];

  await page.route(`**/api/visit-schedules/${OFFLINE_SCHEDULE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: OFFLINE_SCHEDULE_ID,
        patient_id: OFFLINE_PATIENT_ID,
        cycle_id: null,
        scheduled_date: '2026-04-28T00:00:00.000Z',
        schedule_status: 'ready',
        visit_type: 'regular',
        carry_items_status: 'ready',
        recurrence_rule: null,
      }),
    });
  });

  await page.route(`**/api/visit-preparations/${OFFLINE_SCHEDULE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    });
  });

  await page.route('**/api/visit-records', async (route) => {
    if (route.request().method() === 'POST') {
      visitRecordRequests.push(captureRouteRequest(route));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'offline save smoke should not POST visit records' }),
      });
      return;
    }

    await route.continue();
  });

  return visitRecordRequests;
}

test.describe('shared external viewer route-mocked smoke', () => {
  test('strips OTP query from shared URL and sends OTP only as request header', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    const { selfReportRequests, viewerRequests } = await installSharedViewerRouteMock(page);

    await page.goto(`/shared/${SHARED_TOKEN}?otp=${SHARED_OTP}`);
    await waitForStableUi(page);

    await expect(page).toHaveURL(new RegExp(`/shared/${SHARED_TOKEN}$`));
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByLabel('OTP')).toHaveValue('');
    expect(viewerRequests).toHaveLength(0);

    await page.getByLabel('OTP').fill(SHARED_OTP);
    await page.getByRole('button', { name: '閲覧する' }).click();

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
    await page.goto('/dashboard');
    await waitForStableUi(page);
    await expect(page.getByTestId('app-shell-main')).toBeVisible();
    errors.length = 0;

    const requests = await installBillingWorkbenchRouteMocks(page);
    await page.goto(
      `/billing/candidates?billing_month=${BILLING_MONTH}&patient_id=${BILLING_PATIENT_ID}&workflow_from=visit_record&visit_record_id=visit_route_mock_record&schedule_id=visit_route_mock_schedule`,
    );
    await waitForStableUi(page);

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

    await page.goto('/admin/formulary');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '採用薬マスター' })).toBeVisible();
    await expect(page.getByText('採用薬リスト運用')).toBeVisible();
    await expect(page.getByText('影響レビューキュー')).toBeVisible();
    await expect(page.getByRole('button', { name: /ハイリスク採用品/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /LASA注意採用品/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /規制薬採用品/ })).toBeVisible();
    await expect(page.getByText('RouteMock 採用薬錠5mg').first()).toBeVisible();
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
    const visitRecordRequests = await installOfflineVisitRecordRouteMocks(page);

    await page.goto(`/visits/${OFFLINE_SCHEDULE_ID}/record`);
    await waitForStableUi(page);
    await seedOfflineEncryptionKey(page);

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
    await page.getByRole('button', { name: '保存', exact: true }).click();

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
