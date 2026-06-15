import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import {
  attachLocalSession,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
} from './helpers/local-auth';

const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');

const VISIT_WORKFLOW_IDS = {
  patient: 'e2e_visit_workflow_patient',
  caseId: 'e2e_visit_workflow_case',
  careManager: 'e2e_visit_workflow_care_manager',
  schedule: 'e2e_visit_workflow_schedule',
  preparation: 'e2e_visit_workflow_preparation',
  visitRecord: 'e2e_visit_workflow_record',
  careReport: 'e2e_visit_workflow_report',
  billingCandidate: 'e2e_visit_workflow_billing',
  conferenceNote: 'e2e_visit_workflow_conference',
} as const;

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Visit workflow fixtures require PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(DB_CONNECTION_STRING);
  const databaseName = url.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || databaseName !== 'ph_os_e2e') {
    throw new Error('Visit workflow fixtures can only run against local ph_os_e2e');
  }
}

test.setTimeout(420_000);

function jsonb(value: unknown) {
  return JSON.stringify(value);
}

const structuredPhysicianReportContent = {
  patient: { name: '訪問後 太郎', birth_date: '1948-01-15', gender: 'male' },
  report_date: '2026-04-25',
  visit_date: '2026-04-25',
  pharmacist_name: '薬剤師 E2E',
  prescriber: { name: '青葉 医師', institution: '青葉内科' },
  prescriptions: [
    {
      drug_name: 'アムロジピン錠5mg',
      dose: '1錠',
      frequency: '1日1回朝食後',
      days: 14,
    },
  ],
  medication_management: {
    compliance_summary: '退院後の服薬支援と残薬確認を継続しています。',
    adherence_score: 88,
    self_management: '薬剤カレンダーと家族確認を併用しています。',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    sleep: '睡眠は安定しています。',
    cognition: '服薬手順の理解に大きな変化はありません。',
    diet_oral: '食事と水分摂取は維持できています。',
    mobility: '屋内移動は見守りで可能です。',
    excretion: '排泄状況に大きな変化はありません。',
  },
  residual_medications: [
    {
      drug_name: 'アムロジピン錠5mg',
      remaining_qty: 6,
      excess_days: 3,
      reduction_proposal: false,
    },
  ],
  assessment: '服薬管理は現行支援で維持できています。',
  plan: '次回訪問で残薬とカレンダー利用状況を再確認します。',
  physician_communication: '処方継続で問題ありません。',
  warnings: [],
};

async function openFirstPatientCard(page: Page) {
  await openStableRoute(page, '/patients');
  const firstLink = page
    .locator('a[href^="/patients/"]:not([href="/patients/new"])')
    .filter({ visible: true })
    .first();
  await expect(firstLink).toBeVisible({ timeout: 30_000 });
  const href = await firstLink.getAttribute('href');
  expect(href).toBeTruthy();
  await openStableRoute(page, href!);

  const cardWorkspace = page.getByTestId('card-workspace');
  const loading = page.locator('main').getByText('読み込み中...');
  if (await cardWorkspace.isVisible({ timeout: 60_000 }).catch(() => false)) {
    return;
  }

  if (await loading.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await reloadStablePage(page);
  }

  await expect(cardWorkspace).toBeVisible({ timeout: 60_000 });
}

async function openVisitDetailPage(page: Page, visitRecordId: string) {
  const visitDetailPath = `/visits/${visitRecordId}`;
  const main = page.locator('main');
  const detailReady = main.getByRole('link', { name: '訪問記録 PDF を開く' });
  const loading = main.getByText('読み込み中...');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openStableRoute(page, visitDetailPath);

    if (await detailReady.isVisible({ timeout: 180_000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 60_000 });
      return;
    }
  }

  await expect(detailReady).toBeVisible({ timeout: 180_000 });
  await expect(loading).toBeHidden({ timeout: 60_000 });
}

async function openReportDetailPage(page: Page, reportId: string) {
  const main = page.locator('main');
  const reportReady = main.getByRole('heading', { name: /主治医|報告書/ }).first();
  const loading = main.getByText('読み込み中...');
  const reportApiPath = `/api/care-reports/${reportId}`;

  await openStableRoute(page, '/dashboard');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reportResponsePromise = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return url.pathname === reportApiPath && response.request().method() === 'GET';
        },
        { timeout: 120_000 },
      )
      .catch(() => null);

    if (attempt === 0) {
      await openStableRoute(page, `/reports/${reportId}`);
    } else {
      await reloadStablePage(page);
    }

    const reportResponse = await reportResponsePromise;
    if (reportResponse && !reportResponse.ok()) {
      throw new Error(
        `Care report detail API failed: ${reportResponse.status()} ${reportResponse.url()}`,
      );
    }

    if (await reportReady.isVisible({ timeout: 60_000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 60_000 });
      return;
    }

    if (!(await loading.isVisible({ timeout: 1_000 }).catch(() => false))) {
      break;
    }
  }

  await expect(reportReady).toBeVisible({ timeout: 120_000 });
  await expect(loading).toBeHidden({ timeout: 60_000 });
}

async function ensureVisitWorkflowFixture() {
  assertSafeE2eDatabase();

  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const baseResult = await client.query<{
      org_id: string;
      user_id: string;
      site_id: string | null;
    }>(
      `
        SELECT u.org_id, u.id AS user_id, m.site_id
        FROM "User" u
        LEFT JOIN "Membership" m ON m.user_id = u.id AND m.org_id = u.org_id
        WHERE lower(u.email) = lower('demo@ph-os.example.com')
        ORDER BY m.created_at DESC NULLS LAST, u.created_at DESC
        LIMIT 1
      `,
    );
    const base = baseResult.rows[0];
    if (!base) throw new Error('Visit workflow fixture requires the local auth user');

    await client.query(
      `
        INSERT INTO "Patient" (
          "id","org_id","name","name_kana","birth_date","gender","billing_support_flag","created_at","updated_at"
        ) VALUES ($1,$2,'訪問後WF E2E 太郎','ホウモンゴワークフロー イーツーイー タロウ','1942-04-01','other',true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "billing_support_flag" = true,
            "updated_at" = NOW()
      `,
      [VISIT_WORKFLOW_IDS.patient, base.org_id],
    );

    await client.query(
      `
        INSERT INTO "CareCase" (
          "id","org_id","patient_id","status","referral_date","start_date","primary_pharmacist_id","required_visit_support","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'active','2026-04-01','2026-04-01',$4,$5::jsonb,'E2E visit-detail post-visit workflow case',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "status" = 'active',
            "primary_pharmacist_id" = EXCLUDED."primary_pharmacist_id",
            "required_visit_support" = EXCLUDED."required_visit_support",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.caseId,
        base.org_id,
        VISIT_WORKFLOW_IDS.patient,
        base.user_id,
        jsonb({
          initial_transition_management_expected: true,
          medication_support_methods: ['calendar'],
        }),
      ],
    );

    await client.query(
      `
        INSERT INTO "CareTeamLink" (
          "id","org_id","case_id","role","name","organization_name","phone","fax","is_primary","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'care_manager','青山 E2E ケアマネ','青山ケアプランセンター','03-0000-0000','03-0000-0001',true,'訪問後WF fixture contact',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "role" = EXCLUDED."role",
            "name" = EXCLUDED."name",
            "organization_name" = EXCLUDED."organization_name",
            "phone" = EXCLUDED."phone",
            "fax" = EXCLUDED."fax",
            "is_primary" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [VISIT_WORKFLOW_IDS.careManager, base.org_id, VISIT_WORKFLOW_IDS.caseId],
    );

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","time_window_start","time_window_end","pharmacist_id","assignment_mode","route_order","confirmed_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'regular','normal','completed','2026-04-25','09:00','10:00',$5,'primary',21,NOW(),NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "visit_type" = EXCLUDED."visit_type",
            "schedule_status" = EXCLUDED."schedule_status",
            "scheduled_date" = EXCLUDED."scheduled_date",
            "time_window_start" = EXCLUDED."time_window_start",
            "time_window_end" = EXCLUDED."time_window_end",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "assignment_mode" = EXCLUDED."assignment_mode",
            "route_order" = EXCLUDED."route_order",
            "confirmed_at" = NOW(),
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.schedule,
        base.org_id,
        VISIT_WORKFLOW_IDS.caseId,
        base.site_id,
        base.user_id,
      ],
    );

    await client.query(
      `
        INSERT INTO "VisitPreparation" (
          "id","org_id","schedule_id","checklist","medication_changes_reviewed","carry_items_confirmed","previous_issues_reviewed","route_confirmed","offline_synced","prepared_by","prepared_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,'{}'::jsonb,true,true,true,true,true,$4,'2026-04-24T10:00:00Z',NOW(),NOW())
        ON CONFLICT ("schedule_id") DO UPDATE
        SET "checklist" = EXCLUDED."checklist",
            "medication_changes_reviewed" = true,
            "carry_items_confirmed" = true,
            "previous_issues_reviewed" = true,
            "route_confirmed" = true,
            "offline_synced" = true,
            "prepared_by" = EXCLUDED."prepared_by",
            "prepared_at" = EXCLUDED."prepared_at",
            "updated_at" = NOW()
      `,
      [VISIT_WORKFLOW_IDS.preparation, base.org_id, VISIT_WORKFLOW_IDS.schedule, base.user_id],
    );

    await client.query(
      `
        INSERT INTO "VisitRecord" (
          "id","org_id","schedule_id","patient_id","pharmacist_id","visit_date","outcome_status","soap_subjective","soap_objective","soap_assessment","soap_plan","structured_soap","next_visit_suggestion_date","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,'2026-04-25T09:30:00Z','completed',$6,$7,$8,$9,$10::jsonb,'2026-05-09',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "schedule_id" = EXCLUDED."schedule_id",
            "patient_id" = EXCLUDED."patient_id",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "visit_date" = EXCLUDED."visit_date",
            "outcome_status" = EXCLUDED."outcome_status",
            "soap_subjective" = EXCLUDED."soap_subjective",
            "soap_objective" = EXCLUDED."soap_objective",
            "soap_assessment" = EXCLUDED."soap_assessment",
            "soap_plan" = EXCLUDED."soap_plan",
            "structured_soap" = EXCLUDED."structured_soap",
            "next_visit_suggestion_date" = EXCLUDED."next_visit_suggestion_date",
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.visitRecord,
        base.org_id,
        VISIT_WORKFLOW_IDS.schedule,
        VISIT_WORKFLOW_IDS.patient,
        base.user_id,
        '退院後の服薬は継続できているが、夕食後薬で飲み忘れがある。',
        '残薬は夕食後薬が3包。血圧 128/76 mmHg。',
        '服薬カレンダーで改善傾向。退院前カンファの合意事項を継続確認する。',
        'ケアマネへ共有し、次回訪問で残薬と副作用を再確認する。',
        jsonb({
          subjective: {
            symptom_checks: ['服薬継続'],
            free_text: '退院後の服薬は継続できているが、夕食後薬で飲み忘れがある。',
          },
          objective: {
            medication_status: '服薬カレンダーで管理',
            adherence_score: 4,
            side_effect_checks: ['めまいなし', 'ふらつきなし'],
            adverse_events: { has_events: false, events: [] },
            free_text: '残薬は夕食後薬が3包。血圧 128/76 mmHg。',
          },
          assessment: {
            problem_checks: ['adherence_decline'],
            free_text: '服薬支援は継続で問題なし',
          },
          plan: {
            intervention_checks: ['care_manager_report', 'residual_medication_followup'],
            next_visit_date: '2026-05-09',
            care_manager_report_items: '残薬状況と服薬カレンダー運用を共有',
            free_text: 'ケアマネへ共有し、次回訪問で残薬を確認する',
          },
          residual_medications: [
            {
              drug_name: '夕食後薬',
              remaining_quantity: 3,
              excess_days: 3,
              is_reduction_target: true,
            },
          ],
          home_visit_2026: {
            medication_review_completed: true,
            residual_medication_checked: true,
            adverse_event_checked: true,
            polypharmacy_reviewed: true,
            after_hours_contact_confirmed: true,
          },
        }),
      ],
    );

    await client.query(
      `
        INSERT INTO "CareReport" (
          "id","org_id","visit_record_id","patient_id","case_id","report_type","status","content","created_by","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,'physician_report','draft',$6::jsonb,$7,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "visit_record_id" = EXCLUDED."visit_record_id",
            "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "report_type" = EXCLUDED."report_type",
            "status" = EXCLUDED."status",
            "content" = EXCLUDED."content",
            "created_by" = EXCLUDED."created_by",
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.careReport,
        base.org_id,
        VISIT_WORKFLOW_IDS.visitRecord,
        VISIT_WORKFLOW_IDS.patient,
        VISIT_WORKFLOW_IDS.caseId,
        jsonb(structuredPhysicianReportContent),
        base.user_id,
      ],
    );

    await client.query(
      `
        INSERT INTO "BillingCandidate" (
          "id","org_id","patient_id","dedupe_key","billing_month","billing_code","billing_name","points","quantity","source_snapshot","status","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'2026-04-01','MED_HOME_VISIT_E2E','在宅患者訪問薬剤管理指導料 E2E',650,1,$5::jsonb,'candidate',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "dedupe_key" = EXCLUDED."dedupe_key",
            "billing_month" = EXCLUDED."billing_month",
            "billing_code" = EXCLUDED."billing_code",
            "billing_name" = EXCLUDED."billing_name",
            "points" = EXCLUDED."points",
            "quantity" = EXCLUDED."quantity",
            "source_snapshot" = EXCLUDED."source_snapshot",
            "status" = EXCLUDED."status",
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.billingCandidate,
        base.org_id,
        VISIT_WORKFLOW_IDS.patient,
        `visit-detail-workflow:${VISIT_WORKFLOW_IDS.visitRecord}:2026-04`,
        jsonb({ visit_record_id: VISIT_WORKFLOW_IDS.visitRecord }),
      ],
    );

    await client.query(
      `
        INSERT INTO "ConferenceNote" (
          "id","org_id","case_id","patient_id","note_type","title","content","structured_content","metadata","billing_eligible","billing_code","follow_up_date","follow_up_completed","participants","conference_date","action_items","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'pre_discharge','退院前カンファ E2E','退院後の服薬支援と初回訪問を確認',$5::jsonb,$6::jsonb,true,'B011-6','2026-04-26',false,$7::jsonb,'2026-04-23T01:00:00Z',$8::jsonb,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "patient_id" = EXCLUDED."patient_id",
            "note_type" = EXCLUDED."note_type",
            "title" = EXCLUDED."title",
            "content" = EXCLUDED."content",
            "structured_content" = EXCLUDED."structured_content",
            "metadata" = EXCLUDED."metadata",
            "billing_eligible" = EXCLUDED."billing_eligible",
            "billing_code" = EXCLUDED."billing_code",
            "follow_up_date" = EXCLUDED."follow_up_date",
            "follow_up_completed" = false,
            "participants" = EXCLUDED."participants",
            "conference_date" = EXCLUDED."conference_date",
            "action_items" = EXCLUDED."action_items",
            "updated_at" = NOW()
      `,
      [
        VISIT_WORKFLOW_IDS.conferenceNote,
        base.org_id,
        VISIT_WORKFLOW_IDS.caseId,
        VISIT_WORKFLOW_IDS.patient,
        jsonb({
          sections: [
            { key: 'discharge_plan', title: '退院予定', body: '4/25 退院後すぐに服薬確認' },
            { key: 'agreed_actions', title: '合意事項', body: '残薬をケアマネへ共有' },
          ],
        }),
        jsonb({
          sync_summary: {
            billing_candidate_id: VISIT_WORKFLOW_IDS.billingCandidate,
            report_draft_ids: [VISIT_WORKFLOW_IDS.careReport],
          },
        }),
        jsonb([{ name: '青山 E2E ケアマネ', role: 'care_manager' }]),
        jsonb([{ title: '残薬をケアマネへ共有' }]),
      ],
    );

    return VISIT_WORKFLOW_IDS;
  } finally {
    await client.end();
  }
}

test.describe('detail page layout', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('patient card workspace keeps grouped layout and integrated profile summary', async ({
    context,
  }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openFirstPatientCard(page);

    await expect(page.getByTestId('page-scaffold')).toBeVisible();
    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();
    await expect(page.getByTestId('patient-detail-tablist')).toHaveCount(0);

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(errors).toEqual([]);
  });

  test('visit detail keeps grouped layout and action cluster visible', async ({ context }) => {
    const ids = await ensureVisitWorkflowFixture();
    const { page, errors } = await createInstrumentedPage(context);
    await openVisitDetailPage(page, ids.visitRecord);

    await expect(page.getByTestId('page-scaffold')).toBeVisible();
    await expect(page.getByRole('link', { name: '訪問記録 PDF を開く' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: /報告書生成|生成中/ })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(errors).toEqual([]);
  });

  test('visit detail shows DB-backed post-visit workflow report, billing, and conference context', async ({
    context,
  }) => {
    const ids = await ensureVisitWorkflowFixture();
    await attachLocalSession(context);
    const { page, errors } = await createInstrumentedPage(context);

    await openVisitDetailPage(page, ids.visitRecord);

    const main = page.locator('main');
    await expect(main.getByRole('link', { name: '訪問記録 PDF を開く' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(main.getByText('訪問後ワークフロー')).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole('heading', { name: '報告書作成' })).toBeVisible();
    await expect(main.getByText('作成済み報告書 1件')).toBeVisible();
    await expect(main.getByRole('link', { name: /報告書を確認/ })).toHaveAttribute(
      'href',
      `/reports/${ids.careReport}`,
    );

    await expect(main.getByRole('heading', { name: '算定レビュー' })).toBeVisible();
    const billingWorkflowCard = main.locator('article').filter({ hasText: '算定レビュー' });
    await expect(main.getByRole('link', { name: /^請求候補を確認$/ })).toHaveAttribute(
      'href',
      `/billing/candidates?billing_month=2026-04-01&patient_id=${ids.patient}&workflow_from=visit_record&visit_record_id=${ids.visitRecord}&schedule_id=${ids.schedule}`,
      { timeout: 60_000 },
    );
    await expect(billingWorkflowCard.getByText('候補', { exact: true })).toBeVisible();
    await expect(billingWorkflowCard.getByText('1件', { exact: true })).toBeVisible();

    await expect(main.getByRole('heading', { name: '会議アクション回収' })).toBeVisible();
    const conferenceWorkflowCard = main
      .locator('article')
      .filter({ hasText: '会議アクション回収' });
    await expect(conferenceWorkflowCard.getByText(/合意事項 \d+件/)).toBeVisible();
    await expect(
      conferenceWorkflowCard.getByText('退院前カンファ: 退院前カンファ E2E'),
    ).toBeVisible();
    await expect(main.getByRole('link', { name: /会議を確認/ })).toHaveAttribute(
      'href',
      `/conferences?patient_id=${ids.patient}`,
    );

    expect(errors).toEqual([]);
  });

  test('report detail renders DB-backed structured report content without runtime errors', async ({
    context,
  }) => {
    const ids = await ensureVisitWorkflowFixture();
    await attachLocalSession(context);
    const { page, errors } = await createInstrumentedPage(context);

    await openReportDetailPage(page, ids.careReport);

    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: /主治医|報告書/ }).first()).toBeVisible();
    const medicationManagementHeading = main.getByRole('heading', { name: '服薬管理状況' });
    await medicationManagementHeading.scrollIntoViewIfNeeded();
    await expect(medicationManagementHeading).toBeVisible();
    await expect(main.getByRole('heading', { name: '残薬状況' })).toBeVisible();
    await expect(main.getByText('退院後の服薬支援と残薬確認を継続しています。')).toBeVisible();
    await expect(main.getByText('訪問後WF E2E 主治医報告')).toHaveCount(0);

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('main h1').length,
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.h1Count).toBe(1);
    expect(errors).toEqual([]);
  });
});
