import type { DesignScreenEntry } from './design-screen-map-contract';

export const NEW_DESIGN_SCREENS: DesignScreenEntry[] = [
  // ── 新ターゲット(design/images/new、2026-06-11〜最優先)──────
  // route は暫定。new-design-analysis の読解結果で調整する
  {
    screenId: 'new_01_dashboard',
    targetImage: 'images/new/01_dashboard.png',
    route: '/dashboard',
    setup: async (page) => {
      await page.waitForSelector(
        '[data-testid="dashboard-urgent-now"], [data-testid="dashboard-today-flow"], [data-testid="dashboard-process-now"]',
        { timeout: 60_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_02_patient_list',
    targetImage: 'images/new/02_patient_list.png',
    route: '/patients',
    setup: async (page) => {
      await page
        .waitForSelector(
          '[data-testid="patient-board-card"], [data-testid="patients-board-grid"]',
          {
            timeout: 30_000,
          },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_03_schedule',
    targetImage: 'images/new/03_schedule.png',
    route: '/schedules',
  },
  {
    screenId: 'new_04_visit',
    targetImage: 'images/new/04_visit.png',
    route: '/visits',
    setup: async (page) => {
      // cold compile 直後はスケルトンのまま撮れてしまうため、準備カードの描画を待つ
      await page
        .waitForSelector('[data-testid="visit-prep-card"], [data-testid="visits-today-list"]', {
          timeout: 20_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_05_import',
    targetImage: 'images/new/05_import.png',
    route: '/prescriptions/intake',
  },
  {
    screenId: 'new_06_card',
    targetImage: 'images/new/06_card.png',
    // prisma/seed-design-demo.ts の田中一郎(セット監査待ちサイクル)
    route: '/patients/cmnhdemopt001amq9ph-os',
    setup: async (page) => {
      await page.getByRole('tab', { name: /^薬剤・訪問:/ }).click();
      await page.waitForSelector('[data-testid="card-prescription-section"]', {
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_07_dispense',
    targetImage: 'images/new/07_dispense.png',
    route: '/dispense',
    setup: async (page) => {
      // 調剤キュー先頭を選択し、「いまの1件」(比較テーブル+チェックリスト)の描画まで待つ
      await page.getByTestId('dispense-queue-row').first().click();
      await page
        .waitForSelector(
          '[data-testid="dispense-comparison-table"], [data-testid="dispense-checklist"]',
          { timeout: 90_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_08_audit',
    targetImage: 'images/new/08_audit.png',
    route: '/audit',
    setup: async (page) => {
      // 新 DispensingWorkbench（phase="audit"）の工程タブが active になった状態の描画を待つ。
      // active な工程タブは aria-current="page" の <Link> 1 件のみ（route 別に一意）。
      // 旧 audit-workbench の audit-queue-row / audit-count-table / two-person-banner は撤去済み。
      await page
        .waitForSelector('a[aria-current="page"]', {
          timeout: 20_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_09_set',
    targetImage: 'images/new/09_set.png',
    route: '/set',
    setup: async (page) => {
      // 新 DispensingWorkbench（phase="setp"）の工程タブが active になった状態の描画を待つ。
      // 旧 set-workspace の set-workspace-row / set-pending-card は撤去済み。
      await page
        .waitForSelector('a[aria-current="page"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_10_report',
    targetImage: 'images/new/10_report.png',
    route: '/reports',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="report-draft-row"], [data-testid="report-waiting-box"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_11_billing',
    targetImage: 'images/new/11_billing.png',
    route: '/billing',
    setup: async (page) => {
      await page
        .waitForSelector(
          '[data-testid="billing-check-review-row"], [data-testid="billing-check-review-table"], [data-testid="billing-check"]',
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_12_handoff',
    targetImage: 'images/new/12_handoff.png',
    route: '/handoff',
  },
  {
    screenId: 'new_13_master',
    targetImage: 'images/new/13_master.png',
    route: '/admin',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="master-hub-card"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_14_settings',
    targetImage: 'images/new/14_settings.png',
    route: '/settings',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="policy-safety-card"], [data-testid="policy-row"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
];
