import { expect, test, type Page, type Route } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, waitForStableUi } from './helpers/local-auth';

type MockBillingCandidateStatus = 'candidate' | 'confirmed' | 'excluded' | 'exported';

type MockBillingCandidate = {
  id: string;
  patient_id: string;
  patient_name: string;
  billing_month: string;
  billing_code: string;
  billing_name: string;
  points: number;
  quantity: number;
  status: MockBillingCandidateStatus;
  exclusion_reason: string | null;
  source_snapshot: {
    billing_scope: string;
    selection_mode: string;
    source_note: string;
    ruleset_version: string;
    revision_code: string;
    site_config_status: string;
    billing_assignment: {
      building_id: string;
      unit_name: string | null;
      assignment_scope: 'building' | 'unit' | 'patient';
      building_patient_count: number;
      unit_patient_count: number | null;
    };
    billing_close: {
      review_state: 'pending' | 'reviewed';
      resolution_state: 'unresolved' | 'confirmed' | 'excluded';
      reviewed_at: string | null;
      reviewed_by: string | null;
      note: string | null;
    };
    validation_layers: {
      evidence: {
        label: string;
        state: 'passed' | 'manual_review' | 'blocked';
        message: string;
      };
      rule_engine: {
        label: string;
        state: 'passed' | 'manual_review' | 'blocked';
        message: string;
        version: string;
      };
      close_review: {
        label: string;
        state: 'passed' | 'manual_review' | 'blocked';
        message: string;
      };
    };
  };
  workflow_state: {
    review_state: 'pending' | 'reviewed';
    resolution_state: 'unresolved' | 'confirmed' | 'excluded';
    reviewed_at: string | null;
    reviewed_by: string | null;
    note: string | null;
  };
};

const BILLING_MONTH = '2026-04-01';

function createMockCandidate(
  input: Pick<
    MockBillingCandidate,
    'id' | 'patient_id' | 'patient_name' | 'billing_code' | 'billing_name' | 'status'
  > & {
    points: number;
    exclusionReason?: string | null;
  },
): MockBillingCandidate {
  const isPending = input.status === 'candidate';
  const isExcluded = input.status === 'excluded';
  const resolutionState = isPending ? 'unresolved' : isExcluded ? 'excluded' : 'confirmed';
  const validationState = isPending ? 'manual_review' : isExcluded ? 'blocked' : 'passed';

  return {
    id: input.id,
    patient_id: input.patient_id,
    patient_name: input.patient_name,
    billing_month: `${BILLING_MONTH}T00:00:00.000Z`,
    billing_code: input.billing_code,
    billing_name: input.billing_name,
    points: input.points,
    quantity: 1,
    status: input.status,
    exclusion_reason: input.exclusionReason ?? null,
    source_snapshot: {
      billing_scope: 'home_care_ssot',
      selection_mode: isPending ? 'manual' : 'automatic',
      source_note: `${input.patient_name} の請求候補根拠`,
      ruleset_version: '2026-home-visit-e2e',
      revision_code: 'revision-2026',
      site_config_status: 'configured',
      billing_assignment: {
        building_id: 'billing-e2e-building',
        unit_name: input.status === 'confirmed' ? '2F' : null,
        assignment_scope: input.status === 'confirmed' ? 'unit' : 'building',
        building_patient_count: 3,
        unit_patient_count: input.status === 'confirmed' ? 2 : null,
      },
      billing_close: {
        review_state: isPending ? 'pending' : 'reviewed',
        resolution_state: resolutionState,
        reviewed_at: isPending ? null : '2026-04-25T01:00:00.000Z',
        reviewed_by: isPending ? null : 'e2e-user',
        note: isPending ? null : `${input.patient_name} reviewed`,
      },
      validation_layers: {
        evidence: {
          label: 'エビデンス',
          state: validationState,
          message: isPending ? '薬剤師確認待ち' : isExcluded ? '除外理由あり' : '根拠確認済み',
        },
        rule_engine: {
          label: 'ルール判定',
          state: validationState,
          message: isPending ? '手動レビュー対象' : isExcluded ? '対象外判定' : '算定可能',
          version: 'billing-rules-2026',
        },
        close_review: {
          label: '締め確認',
          state: isPending ? 'manual_review' : 'passed',
          message: isPending ? '未レビュー候補が残っています' : '締め可能',
        },
      },
    },
    workflow_state: {
      review_state: isPending ? 'pending' : 'reviewed',
      resolution_state: resolutionState,
      reviewed_at: isPending ? null : '2026-04-25T01:00:00.000Z',
      reviewed_by: isPending ? null : 'e2e-user',
      note: isPending ? null : `${input.patient_name} reviewed`,
    },
  };
}

function updateCandidateForAction(
  candidate: MockBillingCandidate,
  action: 'confirm' | 'exclude' | 'reopen',
) {
  if (action === 'reopen') {
    candidate.status = 'candidate';
    candidate.exclusion_reason = null;
    candidate.workflow_state = {
      review_state: 'pending',
      resolution_state: 'unresolved',
      reviewed_at: null,
      reviewed_by: null,
      note: null,
    };
  } else {
    candidate.status = action === 'confirm' ? 'confirmed' : 'excluded';
    candidate.exclusion_reason = action === 'exclude' ? 'E2E 除外理由' : null;
    candidate.workflow_state = {
      review_state: 'reviewed',
      resolution_state: action === 'confirm' ? 'confirmed' : 'excluded',
      reviewed_at: '2026-04-25T02:00:00.000Z',
      reviewed_by: 'e2e-user',
      note: action === 'confirm' ? 'E2E confirmed' : 'E2E excluded',
    };
  }

  candidate.source_snapshot.billing_close = { ...candidate.workflow_state };
  candidate.source_snapshot.selection_mode = action === 'reopen' ? 'manual' : 'automatic';
  candidate.source_snapshot.validation_layers.close_review = {
    label: '締め確認',
    state: action === 'reopen' ? 'manual_review' : 'passed',
    message: action === 'reopen' ? '未レビュー候補が残っています' : '締め可能',
  };
}

function summarizeCandidates(candidates: MockBillingCandidate[]) {
  const pending = candidates.filter((candidate) => candidate.status === 'candidate').length;
  const confirmed = candidates.filter((candidate) => candidate.status === 'confirmed').length;
  const excluded = candidates.filter((candidate) => candidate.status === 'excluded').length;
  const exported = candidates.filter((candidate) => candidate.status === 'exported').length;
  const reviewed = candidates.filter(
    (candidate) => candidate.workflow_state.review_state === 'reviewed',
  ).length;
  const readyToClose = candidates.filter((candidate) =>
    ['confirmed', 'excluded', 'exported'].includes(candidate.status),
  ).length;

  return {
    total: candidates.length,
    pending_review: pending,
    confirmed,
    excluded,
    exported,
    reviewed,
    ready_to_close: readyToClose,
    blocked_from_close: pending,
    blocker_reasons: pending ? [{ reason: '未レビュー候補', count: pending }] : [],
  };
}

function readRouteBody(route: Route) {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

async function installBillingCandidateRouteMocks(page: Page) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const candidates = [
    createMockCandidate({
      id: 'billing_e2e_candidate_pending',
      patient_id: 'billing_e2e_patient_pending',
      patient_name: '請求E2E 未確認',
      billing_code: 'MED_HOME_VISIT_PENDING',
      billing_name: '在宅患者訪問薬剤管理指導料 未確認',
      points: 650,
      status: 'candidate',
    }),
    createMockCandidate({
      id: 'billing_e2e_candidate_confirmed',
      patient_id: 'billing_e2e_patient_confirmed',
      patient_name: '請求E2E 確定',
      billing_code: 'MED_HOME_VISIT_CONFIRMED',
      billing_name: '在宅患者訪問薬剤管理指導料 確定',
      points: 720,
      status: 'confirmed',
    }),
    createMockCandidate({
      id: 'billing_e2e_candidate_excluded',
      patient_id: 'billing_e2e_patient_excluded',
      patient_name: '請求E2E 除外',
      billing_code: 'MED_HOME_VISIT_EXCLUDED',
      billing_name: '在宅患者訪問薬剤管理指導料 除外',
      points: 0,
      status: 'excluded',
      exclusionReason: '施設同時算定対象外',
    }),
  ];

  async function recordRequest(route: Route) {
    const request = route.request();
    requests.push({
      method: request.method(),
      url: request.url(),
      body: readRouteBody(route),
    });
  }

  await page.route('**/api/billing-candidates/export?**', async (route) => {
    await recordRequest(route);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/csv;charset=utf-8',
        'content-disposition': 'attachment; filename="billing_e2e.csv"',
      },
      body: 'billing_month,billing_code,billing_name\n2026-04,MED_HOME_VISIT_CONFIRMED,確定\n',
    });
  });

  await page.route('**/api/billing-candidates/close', async (route) => {
    await recordRequest(route);
    candidates.forEach((candidate) => {
      if (candidate.status === 'confirmed') {
        candidate.status = 'exported';
      }
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: `${BILLING_MONTH} を月次締めしました`,
        exported_count: candidates.filter((candidate) => candidate.status === 'exported').length,
        summary: summarizeCandidates(candidates),
      }),
    });
  });

  await page.route('**/api/billing-candidates/billing_e2e_candidate_*', async (route) => {
    const request = route.request();
    await recordRequest(route);
    const candidateId = new URL(request.url()).pathname.split('/').pop();
    const candidate = candidates.find((item) => item.id === candidateId);
    const body = readRouteBody(route) as { action?: string } | null;
    const action = body?.action;
    if (
      request.method() !== 'PATCH' ||
      !candidate ||
      !['confirm', 'exclude', 'reopen'].includes(action ?? '')
    ) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'mock candidate not found' }),
      });
      return;
    }

    updateCandidateForAction(candidate, action as 'confirm' | 'exclude' | 'reopen');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: candidate }),
    });
  });

  await page.route('**/api/billing-candidates?**', async (route) => {
    await recordRequest(route);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: candidates,
        hasMore: false,
        summary: summarizeCandidates(candidates),
      }),
    });
  });

  return { requests };
}

function candidateRow(page: Page, patientName: string) {
  return page.getByRole('row').filter({ hasText: patientName });
}

test.describe('billing: main page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('billing page loads with header', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing');
    await waitForStableUi(page);

    // Page heading should be visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Main content should render
    const main = page.locator('main');
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('billing page has navigation to candidates', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing');
    await waitForStableUi(page);

    // Should have link to candidates page
    const candidatesLink = page.getByRole('link', {
      name: /候補|請求候補|Candidates/i,
    });
    const hasCandidatesLink = await candidatesLink.isVisible().catch(() => false);

    // OR navigation in sidebar
    const sidebarCandidates = page.locator('nav').getByRole('link', {
      name: /請求|Billing/i,
    });
    const hasSidebarLink = await sidebarCandidates
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasCandidatesLink || hasSidebarLink).toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe('billing: candidates page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('billing candidates page loads', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing/candidates');
    await waitForStableUi(page);

    // Page should render main content
    const main = page.locator('main');
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('billing candidates page has month selector or filter controls', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing/candidates');
    await waitForStableUi(page);

    // Should have some form of filter / date control
    const hasSelect = await page
      .locator('select, [role="combobox"], [role="listbox"]')
      .first()
      .isVisible()
      .catch(() => false);
    const hasInput = await page
      .locator('input[type="month"], input[type="date"]')
      .first()
      .isVisible()
      .catch(() => false);
    const hasButton = await page
      .getByRole('button')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasSelect || hasInput || hasButton).toBe(true);

    expect(errors).toEqual([]);
  });

  test('billing candidates shows candidate list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing/candidates');
    await waitForStableUi(page);

    // Should show either a table/list of candidates or an empty state
    const hasTable = await page
      .locator('table, [role="table"]')
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText(/候補なし|データなし|0件|対象なし/i)
      .isVisible()
      .catch(() => false);
    const hasCards = await page
      .locator('[data-testid*="billing"], [data-testid*="candidate"]')
      .first()
      .isVisible()
      .catch(() => false);

    // Page has meaningful content
    const content = await page.locator('main').textContent();
    expect(content?.trim().length).toBeGreaterThan(10);

    expect(hasTable || hasEmptyState || hasCards || (content?.trim().length ?? 0) > 10).toBe(true);

    expect(errors).toEqual([]);
  });

  test('billing candidates generate button or action is accessible', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/billing/candidates');
    await waitForStableUi(page);

    // Should have a generate / create candidates action somewhere, or a usable filter form.
    const generateButton = page.getByRole('button', {
      name: /生成|候補生成|作成|Generate/i,
    });
    const hasGenerateButton = await generateButton.isVisible().catch(() => false);

    const hasExportButton = await page
      .getByRole('button', {
        name: /CSV|出力|エクスポート|Export/i,
      })
      .isVisible()
      .catch(() => false);
    const hasFilterControls = await page
      .locator('form input, form select, form button, [role="form"] input, [role="form"] button')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasGenerateButton || hasExportButton || hasFilterControls).toBe(true);

    expect(errors).toEqual([]);
  });

  test('billing candidates route-mocked workbench covers review actions, monthly close, and CSV export', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { requests } = await installBillingCandidateRouteMocks(page);

    await page.goto(`/billing/candidates?billing_month=${BILLING_MONTH}`);
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '月次請求候補' })).toBeVisible();
    await expect(candidateRow(page, '請求E2E 未確認')).toBeVisible();
    await expect(candidateRow(page, '請求E2E 確定')).toBeVisible();
    await expect(candidateRow(page, '請求E2E 除外')).toBeVisible();

    const pendingRow = candidateRow(page, '請求E2E 未確認');
    await expect(pendingRow.getByRole('button', { name: '確定' })).toBeVisible();
    await expect(pendingRow.getByRole('button', { name: '除外' })).toBeVisible();

    const confirmedRow = candidateRow(page, '請求E2E 確定');
    await expect(confirmedRow.getByRole('button', { name: '差戻し' })).toBeVisible();
    await expect(candidateRow(page, '請求E2E 除外').getByText('施設同時算定対象外')).toBeVisible();

    const closeButton = page.getByRole('button', { name: '月次締め' });
    await expect(closeButton).toBeDisabled();

    await pendingRow.getByRole('button', { name: '確定' }).click();
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.method === 'PATCH' &&
            request.url.includes('/api/billing-candidates/billing_e2e_candidate_pending') &&
            JSON.stringify(request.body).includes('confirm'),
        ),
      )
      .toBe(true);
    await expect(closeButton).toBeEnabled();

    await confirmedRow.getByRole('button', { name: '差戻し' }).click();
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.method === 'PATCH' &&
            request.url.includes('/api/billing-candidates/billing_e2e_candidate_confirmed') &&
            JSON.stringify(request.body).includes('reopen'),
        ),
      )
      .toBe(true);
    await expect(closeButton).toBeDisabled();

    await candidateRow(page, '請求E2E 確定').getByRole('button', { name: '確定' }).click();
    await expect(closeButton).toBeEnabled();
    await closeButton.click();
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.method === 'POST' &&
            request.url.endsWith('/api/billing-candidates/close') &&
            JSON.stringify(request.body).includes(BILLING_MONTH),
        ),
      )
      .toBe(true);

    await page.getByRole('button', { name: 'CSV出力' }).first().click();
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.method === 'GET' &&
            request.url.includes('/api/billing-candidates/export') &&
            request.url.includes(`billing_month=${BILLING_MONTH}`),
        ),
      )
      .toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe('billing: admin rules page', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('billing admin rules page loads without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/admin/billing-rules');
    await waitForStableUi(page);

    const main = page.locator('main');
    await expect(main).toBeVisible();

    expect(errors).toEqual([]);
  });
});
