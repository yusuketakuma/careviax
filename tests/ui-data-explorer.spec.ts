import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  attachLocalSession,
  createInstrumentedPage,
  waitForStableUi,
} from './helpers/local-auth';

const SCREENSHOT_DIR = path.join(process.cwd(), 'artifacts', 'playwright-audit', 'screenshots');

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

  await page.goto('/admin/data-explorer');
  await waitForStableUi(page);

  const modelSearch = page.getByPlaceholder('モデル名で検索');
  await expect(modelSearch).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('全テーブルを一覧・閲覧・更新します。')).toBeVisible();
  await expect(page.locator('main')).toContainText('AuditLog');
  await expect(page.locator('main')).toContainText('Patient');

  await modelSearch.fill('LabelDictionary');
  await expect(page.locator('main')).toContainText('LabelDictionary');
  await expect(page.locator('main')).toContainText('backend only');
  await expect(page.locator('main')).toContainText('1 rows');

  await writeScreenshot(page, 'data-explorer-label-dictionary');
  expect(errors).toEqual([]);
});
