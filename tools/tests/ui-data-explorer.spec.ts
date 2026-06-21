import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { PLAYWRIGHT_SCREENSHOT_DIR } from './helpers/artifacts';

const SCREENSHOT_DIR = PLAYWRIGHT_SCREENSHOT_DIR;

async function writeScreenshot(page: Page, name: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test('admin data explorer surfaces backend-only seed coverage', async ({ context }) => {
  const { page, errors } = await createInstrumentedPage(context);

  await openStableRoute(page, '/admin/data-explorer');

  const modelSearch = page.getByPlaceholder('モデル名で検索');
  await expect(modelSearch).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'データ探索' })).toBeVisible();
  await expect(page.locator('main')).toContainText('AuditLog', { timeout: 15_000 });
  await expect(page.locator('main')).toContainText('Patient', { timeout: 15_000 });

  await modelSearch.fill('Organization');
  const organizationModel = page.getByRole('button', { name: /Organization/ });
  await expect(organizationModel).toBeVisible({ timeout: 15_000 });
  await organizationModel.click();
  await expect(
    page.getByRole('button', { name: 'Organization テーブルの 1 行目を選択' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main')).toContainText('backend only');
  await expect(page.locator('main')).toContainText(/rows/);

  await writeScreenshot(page, 'data-explorer-organization');
  expect(errors).toEqual([]);
});
