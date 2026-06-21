import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage } from './helpers/local-auth';
import {
  ensureScheduleVehicleResourceFixtures,
  SCHEDULE_VEHICLE_FIXTURE_IDS as IDS,
} from './helpers/schedule-vehicle-resource-fixtures';

const ORG_ID = 'cmnhseedorg0000amq9ph-os';

test.describe('schedule vehicle resource constraints', () => {
  test.beforeEach(async ({ context }) => {
    await ensureScheduleVehicleResourceFixtures();
    await attachLocalSession(context);
  });

  test('recurring generation accepts a same-site selected vehicle resource', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const response = await apiFetch(page, {
      path: '/api/visit-schedules/generate',
      method: 'POST',
      body: {
        case_id: IDS.caseId,
        visit_type: 'regular',
        pharmacist_id: IDS.userId,
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: IDS.acceptanceDate,
        end_date: IDS.acceptanceDate,
        vehicle_resource_id: IDS.acceptanceVehicle,
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vehicle_resource_id: IDS.acceptanceVehicle,
          site_id: IDS.siteId,
          pharmacist_id: IDS.userId,
        }),
      ]),
    );
    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('recurring generation rejects a selected vehicle resource at stop capacity', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const response = await apiFetch(page, {
      path: '/api/visit-schedules/generate',
      method: 'POST',
      body: {
        case_id: IDS.caseId,
        visit_type: 'regular',
        pharmacist_id: IDS.userId,
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: IDS.rejectionDate,
        end_date: IDS.rejectionDate,
        vehicle_resource_id: IDS.capacityVehicle,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: 'E2E上限1台 で訪問できる件数は最大 1 件です',
    });
    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('recurring generation rejects a selected vehicle resource from another site', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const response = await apiFetch(page, {
      path: '/api/visit-schedules/generate',
      method: 'POST',
      body: {
        case_id: IDS.caseId,
        visit_type: 'regular',
        pharmacist_id: IDS.userId,
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: IDS.rejectionDate,
        end_date: IDS.rejectionDate,
        vehicle_resource_id: IDS.otherSiteVehicle,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('proposal generation assigns the backup pharmacist when the primary has no shift', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const response = await apiFetch(page, {
      path: '/api/visit-schedule-proposals',
      method: 'POST',
      body: {
        case_id: IDS.substituteCase,
        visit_type: 'regular',
        priority: 'normal',
        candidate_count: 1,
        start_date: IDS.substituteDate,
        preferred_pharmacist_id: IDS.userId,
        idempotency_key: uniqueIdempotencyKey('substitute'),
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          case_id: IDS.substituteCase,
          proposed_pharmacist_id: IDS.substituteBackupUser,
          assignment_mode: 'fallback',
          escalation_reason: '担当薬剤師の勤務枠が見つからなかったため代替薬剤師を割り当て',
        }),
      ]),
    );
    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('proposal generation counts selected vehicle capacity across multiple pharmacists', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const response = await apiFetch(page, {
      path: '/api/visit-schedule-proposals',
      method: 'POST',
      body: {
        case_id: IDS.caseId,
        visit_type: 'regular',
        priority: 'normal',
        candidate_count: 1,
        start_date: IDS.sharedCapacityDate,
        preferred_pharmacist_id: IDS.userId,
        vehicle_resource_id: IDS.sharedCapacityVehicle,
        idempotency_key: uniqueIdempotencyKey('shared-capacity'),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: 'シフト・休日・期限条件に合う候補を生成できませんでした',
      details: {
        rejections: expect.arrayContaining([
          expect.objectContaining({
            pharmacist_id: IDS.userId,
            reason_code: 'vehicle_capacity',
            detail: 'E2E共有上限1台 で訪問できる件数は最大 1 件です',
          }),
        ]),
      },
    });
    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });
});

async function createApiPage(context: BrowserContext) {
  const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
  await page.goto('/api/health', { waitUntil: 'domcontentloaded' });
  return { page, errors };
}

async function apiFetch(
  page: Page,
  args: { path: string; method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
) {
  return page.evaluate(
    async ({ path, method, body, orgId }) => {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
    { ...args, orgId: ORG_ID },
  );
}

function uniqueIdempotencyKey(scope: string) {
  return `e2e-schedule-vehicle:${scope}:${randomUUID()}`;
}

function withoutExpectedValidationConsole(errors: string[]) {
  return errors.filter(
    (message) =>
      !message.includes(
        'console:Failed to load resource: the server responded with a status of 400',
      ),
  );
}
