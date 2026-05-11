import { expect, test, type Page, type Route } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, waitForStableUi } from './helpers/local-auth';

const SHARED_TOKEN = 'shared-route-mock-token';
const SHARED_OTP = '472913';
const BILLING_MONTH = '2026-04-01';
const BILLING_PATIENT_ID = 'billing_route_mock_patient';
const OFFLINE_SCHEDULE_ID = 'offline_route_mock_schedule';
const OFFLINE_PATIENT_ID = 'offline_route_mock_patient';
const OFFLINE_DB_NAME = 'CareViaXOffline';
const OFFLINE_KEY_DB_NAME = 'careviax-offline-keys';
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
  const requests: CapturedRequest[] = [];

  await page.route(`**/api/external-access/${SHARED_TOKEN}`, async (route) => {
    requests.push(captureRouteRequest(route));
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

  return requests;
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
    const sharedRequests = await installSharedViewerRouteMock(page);

    await page.goto(`/shared/${SHARED_TOKEN}?otp=${SHARED_OTP}`);
    await waitForStableUi(page);

    await expect(page).toHaveURL(new RegExp(`/shared/${SHARED_TOKEN}$`));
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByLabel('OTP')).toHaveValue('');
    expect(sharedRequests).toHaveLength(0);

    await page.getByLabel('OTP').fill(SHARED_OTP);
    await page.getByRole('button', { name: '閲覧する' }).click();

    await expect
      .poll(() => sharedRequests.length, {
        message: 'shared viewer should fetch with route-mocked OTP header',
        timeout: 10_000,
      })
      .toBe(1);
    await expect(page.getByText('共有E2E 患者')).toBeVisible();
    await expect(page.getByText('血圧と服薬状況を家族と共有')).toBeVisible();
    expect(sharedRequests[0]?.headers['x-otp']).toBe(SHARED_OTP);
    expect(new URL(sharedRequests[0]!.url).searchParams.has('otp')).toBe(false);
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
