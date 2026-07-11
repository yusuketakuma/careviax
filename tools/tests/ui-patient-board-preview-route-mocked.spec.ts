import { expect, test } from '@playwright/test';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';

const BOARD_RESPONSE = {
  data: [
    {
      patient_id: 'preview_patient_a',
      name: 'テスト患者A',
      age: 80,
      residence_kind: 'home',
      residence_label: '在宅',
      attention: 'urgent_now',
      safety_tags: ['renal'],
      next_visit_date: '2026-07-12',
      next_visit_time: '10:00',
      next_visit_label: null,
      current_step: 'audit',
      status_text: '監査前の確認が必要です',
      status_tone: 'critical',
      operation_summary: ['連絡先あり'],
      foundation_summary: {
        status: 'ready',
        label: '情報確認済み',
        items: ['連絡先あり'],
      },
      foundation_issue_keys: [],
      foundation_href: '/patients/preview_patient_a#patient-foundation',
      link_label: '監査へ',
      link_href: '/audit',
    },
    {
      patient_id: 'preview_patient_b',
      name: 'テスト患者B',
      age: 81,
      residence_kind: 'facility',
      residence_label: '施設',
      attention: 'external_wait',
      safety_tags: [],
      next_visit_date: null,
      next_visit_time: null,
      next_visit_label: '日程調整中',
      current_step: 'decision',
      status_text: '外部からの回答を待っています',
      status_tone: 'external',
      operation_summary: [],
      foundation_summary: null,
      foundation_issue_keys: [],
      foundation_href: '/patients/preview_patient_b#patient-foundation',
      link_label: '連携を確認',
      link_href: '/communications/requests',
    },
  ],
  meta: {
    generated_at: '2026-07-11T12:00:00.000Z',
    scope: 'mine',
    limit: 60,
    returned_count: 2,
    has_more: false,
    next_cursor: null,
    total_count: 2,
    count_basis: {
      total_count: 'filtered_result_exact',
      chip_counts: 'scope_search_foundation_exact',
      foundation_issue_counts: 'scope_search_without_active_foundation_issue_exact',
      board_summary: 'scope_search_foundation_exact',
    },
    filters_applied: {
      scope: 'mine',
      q_present: false,
      foundation_issue: null,
      card_filter: 'all',
      sort: 'priority',
    },
    facets: {
      chip_counts: { urgent_now: 1, external_wait: 1, visit_today: 0, paused: 0 },
      foundation_issue_counts: {
        needs_confirmation: 0,
        missing_contact: 0,
        missing_consent_plan: 0,
        missing_parking: 0,
        missing_care_level: 0,
        missing_insurance: 0,
        missing_care_team: 0,
      },
      today_facility_patient_count: 0,
      today_visit_count: 0,
      safety_tagged_count: 1,
    },
    rail: { next_action: null, blocked_reasons: [] },
    assigned_total: 2,
  },
} as const;

test.describe('patient board selected preview', () => {
  test('uses one card DTO for desktop preview and the mobile sheet', async ({ context }) => {
    await attachLocalSession(context);
    const page = await context.newPage();
    await page.route('**/api/patients/board?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(BOARD_RESPONSE),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await openStableRoute(page, '/patients');
    await expect(page.getByTestId('patients-board-grid')).toBeVisible();
    await expect(page.getByTestId('patient-board-preview-placeholder')).toBeVisible();
    const cardLinks = page.getByTestId('patient-board-card-link');
    await expect(cardLinks.nth(0)).toHaveAttribute('href', '/patients/preview_patient_a');
    await expect(cardLinks.nth(1)).toHaveAttribute('href', '/patients/preview_patient_b');

    await page.getByRole('button', { name: 'テスト患者Aを右プレビュー' }).click();
    const desktopPreview = page.getByTestId('patient-board-selected-preview');
    await expect(desktopPreview).toBeVisible();
    await expect(desktopPreview.getByRole('heading', { name: 'テスト患者A' })).toBeVisible();
    await expect(desktopPreview).toContainText('監査前の確認が必要です');
    await expect(desktopPreview.getByRole('link', { name: '患者詳細' })).toHaveAttribute(
      'href',
      '/patients/preview_patient_a',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'テスト患者Bをプレビュー' }).click();
    const sheet = page.getByRole('dialog', { name: '患者プレビュー' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'テスト患者B' })).toBeVisible();
    await expect(sheet).toContainText('外部からの回答を待っています');
    await expect(sheet.getByRole('link', { name: '患者詳細' })).toHaveAttribute(
      'href',
      '/patients/preview_patient_b',
    );

    const closeButton = sheet.getByRole('button', { name: '患者プレビューを閉じる' });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const viewportMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);
  });
});
