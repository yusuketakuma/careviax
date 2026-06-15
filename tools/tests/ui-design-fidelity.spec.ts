import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';
import {
  DESIGN_FIDELITY_OUTPUT_DIR,
  DESIGN_IMAGE_ROOT,
  DESIGN_SCREENS,
  DESIGN_VIEWPORT,
  filterScreens,
} from './helpers/design-screen-map';
import { attachLocalSession, openStableRoute } from './helpers/local-auth';

/**
 * デザイン忠実度検証ループ用の現状撮影。
 *
 * design/images/{P0,P1} のターゲット PNG と同寸(既定 1600x1000)で実装画面を撮影し、
 * tools/tests/.artifacts/design-fidelity/{screen_id}.actual.png に保存する。
 * 比較レポート(capture-report.json)に actual/target のパス対を出力し、
 * 「実装 → 撮影 → 差分指摘 → 修正」のループはこの対を見比べて回す。
 *
 * 実行例:
 *   pnpm test:e2e:local -- ui-design-fidelity
 *   DESIGN_SCREEN_IDS=p0_07,p0_08 pnpm test:e2e:local -- ui-design-fidelity
 */

const screens = filterScreens(DESIGN_SCREENS);

type CaptureRecord = {
  screenId: string;
  status: 'captured' | 'unmapped';
  route: string | null;
  actualImage: string | null;
  targetImage: string;
  note?: string;
};

const captureRecords: CaptureRecord[] = [];

test.describe('design fidelity captures', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium のみで撮影する');

  test.beforeAll(async () => {
    await fs.mkdir(DESIGN_FIDELITY_OUTPUT_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    if (captureRecords.length === 0) return;
    const reportPath = path.join(DESIGN_FIDELITY_OUTPUT_DIR, 'capture-report.json');
    const existing = await fs
      .readFile(reportPath, 'utf-8')
      .then((raw) => JSON.parse(raw) as Record<string, CaptureRecord>)
      .catch(() => ({}) as Record<string, CaptureRecord>);
    for (const record of captureRecords) {
      existing[record.screenId] = record;
    }
    await fs.writeFile(reportPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
  });

  for (const entry of screens) {
    test(`capture ${entry.screenId}`, async ({ browser }) => {
      const targetImage = path.join(DESIGN_IMAGE_ROOT, entry.targetImage);

      if (!entry.route) {
        captureRecords.push({
          screenId: entry.screenId,
          status: 'unmapped',
          route: null,
          actualImage: null,
          targetImage,
          note: entry.note,
        });
        test.skip(true, entry.note ?? '対応ルート未確定');
        return;
      }

      const context = await browser.newContext({
        viewport: entry.viewport ?? DESIGN_VIEWPORT,
      });
      try {
        if (entry.auth !== false) {
          await attachLocalSession(context);
        }
        const page = await context.newPage();
        await openStableRoute(page, entry.route);
        if (entry.setup) {
          await entry.setup(page);
        }

        // ローディングスケルトン(role=status)が残っていれば描画完了まで待つ。
        // 出続ける画面でも撮影自体は続行する(タイムアウトは握りつぶす)。
        await page
          .waitForFunction(
            () => document.querySelectorAll('[role="status"]').length === 0,
            undefined,
            { timeout: 20_000 },
          )
          .catch(() => {});
        await page.addStyleTag({
          content: `
            nextjs-portal,
            [data-nextjs-toast],
            [data-nextjs-dev-tools-button] {
              display: none !important;
            }
          `,
        });
        await page.waitForTimeout(500);

        const actualImage = path.join(DESIGN_FIDELITY_OUTPUT_DIR, `${entry.screenId}.actual.png`);
        await page.screenshot({ path: actualImage, animations: 'disabled' });
        captureRecords.push({
          screenId: entry.screenId,
          status: 'captured',
          route: entry.route,
          actualImage,
          targetImage,
          note: entry.note,
        });
      } finally {
        await context.close();
      }
    });
  }
});
