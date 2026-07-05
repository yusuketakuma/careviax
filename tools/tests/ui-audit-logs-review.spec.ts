import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { PLAYWRIGHT_SCREENSHOT_DIR } from './helpers/artifacts';
import { apiPathPattern, fulfillJson, readRouteBody } from './helpers/route-mocks';

const AUDIT_LOGS_RESPONSE = {
  data: [
    {
      id: 'audit_high_1',
      created_at: '2026-07-05T09:00:00.000Z',
      actor_id: 'admin_1',
      actor_name: '監査 管理者',
      patient_id: null,
      action: 'break_glass_access',
      target_type: 'patient',
      target_id: 'safe-patient-001',
      ip_address: '127.0.0.1',
      user_agent: 'Playwright',
      changes: {
        reason_note_present: true,
        reason_note_length: 18,
        reason_note_redacted: true,
      },
      risk_tier: 'high',
      risk_label: '高リスク',
      redaction_state: 'redacted',
      review_state: 'pending',
      reviewed_at: null,
      reviewed_by: null,
      reason_code: null,
    },
    {
      id: 'audit_standard_1',
      created_at: '2026-07-05T09:05:00.000Z',
      actor_id: 'clerk_1',
      actor_name: '事務 担当',
      patient_id: null,
      action: 'audit_log_viewed',
      target_type: 'audit_log',
      target_id: 'safe-audit-001',
      ip_address: '127.0.0.1',
      user_agent: 'Playwright',
      changes: {
        filters_present: true,
      },
      risk_tier: 'standard',
      risk_label: '通常',
      redaction_state: 'minimized',
      review_state: 'pending',
      reviewed_at: null,
      reviewed_by: null,
      reason_code: null,
    },
  ],
  pagination: {
    page: 1,
    pageSize: 100,
    total: 2,
    totalPages: 1,
  },
  summary: {
    high_risk_unreviewed_count: 1,
    review_dashboard: {
      total_count: 2,
      filters: {
        risk_tier: null,
        review_state: null,
        target_type: null,
        action: null,
        date_from: null,
        date_to: null,
        actor_used: false,
        reviewed_by_used: false,
      },
      high_risk: {
        total: 1,
        pending_review: 1,
        reviewed: 0,
      },
      standard: {
        total: 1,
        pending_review: 1,
        reviewed: 0,
      },
      review_state: {
        pending: 2,
        reviewed: 0,
      },
    },
  },
};

test.use({ serviceWorkers: 'block' });

async function installAuditLogMocks(page: Page) {
  const reviewBodies: unknown[] = [];
  let standardReviewAttempts = 0;

  await page.route(apiPathPattern('/api/notifications'), (route) =>
    fulfillJson(route, { data: [], hasMore: false, nextCursor: null }),
  );
  await page.route(apiPathPattern('/api/nav-badges'), (route) =>
    fulfillJson(route, { data: { notifications: 0, handoff: 0, audits: 1 } }),
  );
  await page.route(apiPathPattern('/api/audit-logs/audit_high_1/review'), async (route) => {
    reviewBodies.push(readRouteBody(route));
    await fulfillJson(route, {
      data: {
        audit_log_id: 'audit_high_1',
        review_state: 'reviewed',
        reviewed_at: '2026-07-05T09:10:00.000Z',
        reviewed_by: 'admin_1',
        reason_code: 'expected_access',
      },
    });
  });
  await page.route(apiPathPattern('/api/audit-logs/audit_standard_1/review'), async (route) => {
    standardReviewAttempts += 1;
    reviewBodies.push(readRouteBody(route));
    if (standardReviewAttempts === 1) {
      await fulfillJson(route, { message: '監査ログレビューを更新できませんでした' }, 500);
      return;
    }
    await fulfillJson(route, {
      data: {
        audit_log_id: 'audit_standard_1',
        review_state: 'reviewed',
        reviewed_at: '2026-07-05T09:11:00.000Z',
        reviewed_by: 'admin_1',
        reason_code: 'admin_reviewed',
      },
    });
  });
  await page.route(apiPathPattern('/api/audit-logs'), (route) =>
    fulfillJson(route, AUDIT_LOGS_RESPONSE),
  );

  return {
    reviewBodies,
    getStandardReviewAttempts: () => standardReviewAttempts,
  };
}

async function writeScreenshot(page: Page, name: string) {
  await fs.mkdir(PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(PLAYWRIGHT_SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    caret: 'initial',
  });
}

function filterExpectedRetryErrors(errors: string[]) {
  return errors.filter(
    (error) =>
      !error.includes('/api/audit-logs/audit_standard_1/review') &&
      error !==
        'console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  );
}

test.describe('admin audit log review dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('requires explicit high-risk review confirmation and keeps row retry visible', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'single desktop smoke covers the high-risk dialog and row retry contract.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    const mocks = await installAuditLogMocks(page);

    await openStableRoute(page, '/admin/audit-logs');

    await expect(page.getByRole('heading', { name: '監査ログ', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('高リスク未レビュー（現在条件内）')).toBeVisible();

    const highRiskReviewButton = page
      .getByRole('button', {
        name: /高リスク.*監査 管理者.*break_glass_access.*patient safe-patient-001をレビュー済みにする/,
      })
      .first();
    await highRiskReviewButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: '高リスク監査ログをレビュー済みにする' });
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: 'レビュー済みにする' });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel('レビュー理由').selectOption('expected_access');
    await dialog
      .getByRole('checkbox', { name: /対象ログを確認しました/ })
      .first()
      .click();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(dialog).toBeHidden();
    expect(mocks.reviewBodies).toContainEqual({
      review_state: 'reviewed',
      reason_code: 'expected_access',
    });

    const standardReviewButton = page
      .getByRole('button', {
        name: /通常.*事務 担当.*監査ログ閲覧.*audit_log safe-audit-001をレビュー済みにする/,
      })
      .first();
    await standardReviewButton.click();
    await expect(
      page.getByRole('alert').filter({ hasText: '監査ログレビューを更新できませんでした' }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole('button', {
          name: /通常.*事務 担当.*監査ログ閲覧.*audit_log safe-audit-001をレビュー済みにする/,
        })
        .first(),
    ).toHaveText(/再試行/);
    await standardReviewButton.click();

    await expect
      .poll(() => mocks.getStandardReviewAttempts(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2);
    expect(filterExpectedRetryErrors(errors)).toEqual([]);

    await writeScreenshot(page, 'audit-logs-review-dashboard-confirmation');
  });
});
