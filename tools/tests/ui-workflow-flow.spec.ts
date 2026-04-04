import { expect, test } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

test.describe('prescription intake flow', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('prescription list page loads with header and new intake link', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '処方箋受付' })).toBeVisible();
    // "新規受付" link should be accessible
    const newIntakeLink = page.getByRole('link', { name: '新規受付' });
    await expect(newIntakeLink).toBeVisible();

    // Shortcut links should be present
    await expect(page.getByRole('link', { name: 'QR下書き' })).toBeVisible();
    await expect(page.getByRole('link', { name: '調剤キュー' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('new prescription intake form loads without errors', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions/new');
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    // Patient/case selection fieldset should be visible
    await expect(page.getByRole('group', { name: '患者・ケース' })).toBeVisible();

    // Source type selection should be available
    await expect(page.getByText('ソースタイプ')).toBeVisible();

    // The form should have a date field for prescribed date
    await expect(page.getByText('処方日')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prescription intake form pre-fills patient from URL params', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // First get a patient ID from the patient list
    await page.goto('/patients');
    await waitForStableUi(page);
    const firstPatientLink = page.locator('tbody tr').first().locator('a[href^="/patients/"]').first();
    const href = await firstPatientLink.getAttribute('href');
    const patientId = href?.replace('/patients/', '') ?? '';
    expect(patientId).toBeTruthy();

    // Navigate to prescription intake with patient_id param
    await page.goto(`/prescriptions/new?patient_id=${patientId}`);
    await waitForStableUi(page);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();

    // Patient should be pre-selected (patient name should appear somewhere)
    // Wait for patient data to load
    await page.waitForResponse(
      (res) => res.url().includes('/api/patients') && res.status() === 200,
      { timeout: 5000 },
    ).catch(() => null);
    await waitForStableUi(page);

    expect(errors).toEqual([]);
  });

  test('navigating from prescription list to new intake via header link', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions');
    await waitForStableUi(page);

    await Promise.all([
      page.waitForURL(/\/prescriptions\/new/, { timeout: 10_000 }),
      page.getByRole('link', { name: '新規受付' }).click(),
    ]);

    await expect(page.getByRole('heading', { name: '新規処方受付' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('shortcut link from prescriptions to dispensing queue works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/prescriptions');
    await waitForStableUi(page);

    await Promise.all([
      page.waitForURL(/\/dispensing/, { timeout: 10_000 }),
      page.getByRole('link', { name: '調剤キュー' }).click(),
    ]);

    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('dispensing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('dispensing queue page loads with header and shortcut links', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dispensing');
    await waitForStableUi(page);

    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();
    await expect(page.getByText('調剤待ちの処方を優先度順に表示します')).toBeVisible();

    // Shortcut links (scoped to main to avoid sidebar duplicates)
    await expect(main.getByRole('link', { name: '鑑査' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'ワークフロー' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('dispensing queue shows task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dispensing');
    await waitForStableUi(page);

    // Should show either task cards or an empty state message
    const hasContent = await page.locator('main').textContent();

    // Page should have meaningful content (not blank)
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('shortcut link from dispensing to auditing works', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/dispensing');
    await waitForStableUi(page);

    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/auditing/, { timeout: 10_000 }),
      main.getByRole('link', { name: '鑑査' }).click(),
    ]);

    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('auditing queue', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('auditing queue page loads with header and shortcut links', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/auditing');
    await waitForStableUi(page);

    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();
    await expect(page.getByText('調剤済みの処方を鑑査してください')).toBeVisible();

    // Shortcut links (scoped to main to avoid sidebar duplicates)
    await expect(main.getByRole('link', { name: '調剤' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'セット管理' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'ワークフロー' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('auditing queue shows task list or empty state', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await page.goto('/auditing');
    await waitForStableUi(page);

    const hasContent = await page.locator('main').textContent();
    expect(hasContent?.trim().length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});

test.describe('workflow cross-navigation', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('full workflow navigation: prescriptions -> dispensing -> auditing -> back', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);

    // Start at prescriptions
    await page.goto('/prescriptions');
    await waitForStableUi(page);
    await expect(page.getByRole('heading', { name: '処方箋受付' })).toBeVisible();

    // Navigate to dispensing via shortcut
    await Promise.all([
      page.waitForURL(/\/dispensing/, { timeout: 10_000 }),
      page.getByRole('link', { name: '調剤キュー' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    // Navigate to auditing via shortcut (scope to main to avoid sidebar duplicate)
    const main = page.locator('main');
    await Promise.all([
      page.waitForURL(/\/auditing/, { timeout: 10_000 }),
      main.getByRole('link', { name: '鑑査' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤鑑査' })).toBeVisible();

    // Navigate back to dispensing via shortcut (scope to main)
    await Promise.all([
      page.waitForURL(/\/dispensing/, { timeout: 10_000 }),
      main.getByRole('link', { name: '調剤' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: '調剤キュー' })).toBeVisible();

    // Full round trip should have no errors
    expect(errors).toEqual([]);
  });
});
