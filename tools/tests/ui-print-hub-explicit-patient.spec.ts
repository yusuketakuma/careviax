import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession } from './helpers/local-auth';

const PRINT_HUB_PATH = '/reports/print';
const EXACT_PRINT_PATH =
  '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1';

async function installExactDocumentMocks(page: Page) {
  await page.route('**/api/patients/patient_1/header-summary', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          patient_id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1940-01-01',
          gender: 'male',
          gender_label: '男性',
          care_level: null,
          care_level_label: null,
          home_status_label: null,
          residence_label: null,
          primary_diagnosis: null,
          intervention_start_date: null,
          primary_pharmacist_name: null,
          backup_pharmacist_name: null,
          primary_staff_name: null,
          backup_staff_name: null,
          first_visit_date: null,
          last_prescribed_date: null,
          next_prescription_expected_date: null,
          safety: {
            allergy: null,
            renal: null,
            handling_tags: [],
            swallowing: null,
            cautions: [],
            safety_tags: [],
            visible_safety_tags: [],
            hidden_safety_tag_count: 0,
          },
        },
      }),
    }),
  );
  await page.route('**/api/patients/patient_1/documents', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
          print_readiness: {
            overall_status: 'ready',
            missing_required_count: 0,
            warning_count: 0,
            template_versions: [],
            checks: [
              {
                key: 'patient_profile',
                label: '患者基本情報',
                completed: true,
                severity: 'required',
                description: '差し込みできます。',
                action_href: '/patients/patient_1/edit',
                action_label: '基本情報を編集',
              },
            ],
          },
          first_visit_documents: [
            {
              id: 'doc_1',
              case_id: 'case_1',
              document_url: '/api/files/document_1',
              delivered_at: '2026-06-16T00:00:00.000Z',
              delivered_to: '山田 花子',
              created_at: '2026-06-16T00:00:00.000Z',
              updated_at: '2026-06-16T00:00:00.000Z',
              emergency_contacts: [],
              history: [],
            },
          ],
        },
      }),
    }),
  );
}

test.beforeEach(async ({ context }) => {
  await attachLocalSession(context);
});

test('keeps missing targets zero-fetch and verifies the exact print flow at mobile and 200%', async ({
  page,
}) => {
  const patientReads: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/api\/(patients|care-reports|set-plans|first-visit-documents)/.test(url.pathname)) {
      patientReads.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto(PRINT_HUB_PATH, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('print-submit-button')).toBeDisabled();
  await expect(page.getByText(/印刷リンクから開き直してください/).first()).toBeVisible();
  expect(patientReads).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="print-hub-root"] button:not([role="checkbox"]), ' +
          '[data-testid="print-hub-root"] a[href], ' +
          '[data-testid="print-hub-root"] label[for]',
      ),
    ).filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
    });
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      undersizedControls: controls.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).length,
    };
  });
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  expect(mobileLayout.undersizedControls).toBe(0);

  patientReads.length = 0;
  await installExactDocumentMocks(page);
  await page.goto(EXACT_PRINT_PATH, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('print-submit-button')).toBeEnabled();
  expect(patientReads).toEqual([
    'GET /api/patients/patient_1/header-summary',
    'GET /api/patients/patient_1/documents',
  ]);
  await expect(page.getByText('山田 太郎 様').first()).toBeVisible();
  await expect(page.getByText('1940年1月1日').first()).toBeVisible();

  await page.getByTestId('print-submit-button').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: '印刷対象を確認' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByTestId('print-submit-button').focus();
  await page.keyboard.press('Enter');
  const confirmInput = dialog.locator('input').first();
  const patientName = await confirmInput.getAttribute('placeholder');
  expect(patientName?.trim()).toBeTruthy();
  await confirmInput.fill(patientName!);
  await expect(dialog.getByRole('button', { name: 'この対象を印刷' })).toBeEnabled();

  await page.setViewportSize({ width: 720, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  const zoomLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dialogVisible: Boolean(document.querySelector('[role="alertdialog"]')),
  }));
  expect(zoomLayout.dialogVisible).toBe(true);
  expect(zoomLayout.scrollWidth).toBeLessThanOrEqual(zoomLayout.clientWidth + 1);

  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
  const axeResults = await new AxeBuilder({ page }).analyze();
  expect(
    axeResults.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});
