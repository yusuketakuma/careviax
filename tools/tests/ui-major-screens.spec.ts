import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { PLAYWRIGHT_UI_SCREENSHOT_DIR } from './helpers/artifacts';
import {
  attachLocalSession,
  createInstrumentedPage,
  openStableRoute,
  reloadStablePage,
  shouldIgnoreConsoleError,
} from './helpers/local-auth';
const SCREENSHOT_DIR = PLAYWRIGHT_UI_SCREENSHOT_DIR;
const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph-os_dev?schema=public'
).replace(/\?.*$/, '');

test.setTimeout(180_000);

const ROOT_ROUTES = [
  { name: 'dashboard', route: '/dashboard' },
  { name: 'my-day', route: '/my-day' },
  { name: 'patients', route: '/patients' },
  { name: 'patients-new', route: '/patients/new' },
  { name: 'workflow', route: '/workflow' },
  { name: 'prescriptions', route: '/prescriptions' },
  { name: 'prescriptions-new', route: '/prescriptions/new' },
  { name: 'qr-scan', route: '/qr-scan' },
  { name: 'dispensing', route: '/dispensing' },
  { name: 'auditing', route: '/auditing' },
  { name: 'medication-sets', route: '/medication-sets' },
  { name: 'schedules', route: '/schedules' },
  { name: 'schedule-proposals', route: '/schedules/proposals' },
  { name: 'visits', route: '/visits' },
  { name: 'reports', route: '/reports' },
  { name: 'conferences', route: '/conferences' },
  { name: 'billing', route: '/billing' },
  { name: 'billing-candidates', route: '/billing/candidates' },
  { name: 'communications-requests', route: '/communications/requests' },
  { name: 'notifications', route: '/notifications' },
  { name: 'external', route: '/external' },
  { name: 'settings', route: '/settings' },
  { name: 'admin', route: '/admin' },
] as const;

const DEMO_IDS = {
  patient: 'ui_demo_patient_1',
  residence: 'ui_demo_residence_1',
  contact: 'ui_demo_contact_1',
  condition: 'ui_demo_condition_1',
  caseId: 'ui_demo_case_1',
  consent: 'ui_demo_consent_1',
  packaging: 'ui_demo_packaging_1',
  medication: 'ui_demo_medication_1',
  managementPlan: 'ui_demo_management_plan_1',
  task: 'ui_demo_task_1',
  grant: 'ui_demo_grant_1',
  selfReport: 'ui_demo_self_report_1',
  communicationRequest: 'ui_demo_comm_request_1',
  communicationEvent: 'ui_demo_comm_event_1',
  careReport: 'ui_demo_care_report_1',
  visitSchedule: 'ui_demo_visit_schedule_1',
  visitRecord: 'ui_demo_visit_record_1',
} as const;

type DemoContext = {
  orgId: string;
  siteId: string | null;
  userId: string;
  patientId: string;
  patientName: string;
  patientKana: string;
  address: string;
  conditionName: string;
  contactName: string;
  medicationName: string;
  managementPlanId: string;
  reportId: string;
  scheduleId: string;
  visitRecordId: string;
  selfReportSubject: string;
  externalShareName: string;
};

let demoContext: DemoContext;

function jsonb(value: unknown) {
  return JSON.stringify(value);
}

async function ensureUiDemoData() {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const baseResult = await client.query<{
      org_id: string;
      site_id: string | null;
      user_id: string;
    }>(`
      SELECT
        o.id AS org_id,
        ps.id AS site_id,
        u.id AS user_id
      FROM "Organization" o
      JOIN "User" u ON u.org_id = o.id
      LEFT JOIN "PharmacySite" ps ON ps.org_id = o.id
      ORDER BY u.created_at ASC
      LIMIT 1
    `);

    const base = baseResult.rows[0];
    if (!base) {
      throw new Error('UI demo seed requires Organization and User records');
    }

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + 1);
    const nextVisitDate = new Date();
    nextVisitDate.setDate(nextVisitDate.getDate() + 14);

    const address = '東京都千代田区丸の内1-2-3 サンプルハイツ 305';
    const conditionName = '高血圧';
    const contactName = '山田 京子';
    const medicationName = 'アムロジピン錠 5mg';
    const selfReportSubject = '服薬後のふらつきについて';
    const externalShareName = '山田 京子';
    const patientName = 'UIデモ E2E 太郎';
    const patientKana = 'ユーデモ イーツーイー タロウ';

    await client.query(
      `
        INSERT INTO "Patient" (
          "id","org_id","name","name_kana","birth_date","gender","billing_support_flag","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'1948-04-12','female',true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "birth_date" = EXCLUDED."birth_date",
            "gender" = EXCLUDED."gender",
            "billing_support_flag" = true,
            "updated_at" = NOW()
      `,
      [DEMO_IDS.patient, base.org_id, patientName, patientKana]
    );

    await client.query(
      `
        UPDATE "Residence"
        SET "is_primary" = false,
            "updated_at" = NOW()
        WHERE "patient_id" = $1
      `,
      [DEMO_IDS.patient]
    );

    await client.query(
      `
        INSERT INTO "Residence" (
          "id","org_id","patient_id","address","building_id","unit_name","is_primary","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "address" = EXCLUDED."address",
            "building_id" = EXCLUDED."building_id",
            "unit_name" = EXCLUDED."unit_name",
            "is_primary" = true,
            "updated_at" = NOW()
      `,
      [DEMO_IDS.residence, base.org_id, DEMO_IDS.patient, address, 'facility-demo-1', '305号室']
    );

    await client.query(
      `
        INSERT INTO "ContactParty" (
          "id","org_id","patient_id","name","relation","phone","email","organization_name","department","address","is_primary","is_emergency_contact","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'child',$5,$6,$7,$8,$9,true,true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "name" = EXCLUDED."name",
            "phone" = EXCLUDED."phone",
            "email" = EXCLUDED."email",
            "organization_name" = EXCLUDED."organization_name",
            "department" = EXCLUDED."department",
            "address" = EXCLUDED."address",
            "is_primary" = true,
            "is_emergency_contact" = true,
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.contact,
        base.org_id,
        DEMO_IDS.patient,
        contactName,
        '090-1111-2222',
        'kyoko@example.com',
        'サンプル家族',
        '家族連絡先',
        '東京都千代田区丸の内1-2-3',
      ]
    );

    await client.query(
      `
        INSERT INTO "PatientCondition" (
          "id","org_id","patient_id","condition_type","name","is_primary","is_active","noted_at","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'disease',$4,true,true,CURRENT_DATE,$5,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "name" = EXCLUDED."name",
            "is_primary" = true,
            "is_active" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [DEMO_IDS.condition, base.org_id, DEMO_IDS.patient, conditionName, '定期的な血圧チェックが必要']
    );

    await client.query(
      `
        INSERT INTO "CareCase" (
          "id","org_id","patient_id","status","referral_source","referral_date","start_date","primary_pharmacist_id","required_visit_support","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'active',$4,CURRENT_DATE,CURRENT_DATE,$5,$6::jsonb,$7,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "status" = 'active',
            "referral_source" = EXCLUDED."referral_source",
            "referral_date" = CURRENT_DATE,
            "start_date" = CURRENT_DATE,
            "primary_pharmacist_id" = EXCLUDED."primary_pharmacist_id",
            "required_visit_support" = EXCLUDED."required_visit_support",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.caseId,
        base.org_id,
        DEMO_IDS.patient,
        '地域包括支援センター',
        base.user_id,
        jsonb({
          home_visit_intake: {
            requester: {
              organization_name: '地域包括支援センター',
              profession: 'care',
              contact_name: '相談 支援子',
              preferred_contact_method: 'phone',
            },
            reported_age: 82,
            care_level: 'care_3',
            parking_available: false,
            medication_support_methods: ['unit_dose', 'calendar'],
            special_medical_procedures: ['home_oxygen'],
            special_medical_notes: '在宅酸素使用中',
          },
        }),
        'UI検証用の進行ケース',
      ]
    );

    await client.query(
      `
        INSERT INTO "ConsentRecord" (
          "id","org_id","patient_id","case_id","consent_type","method","obtained_date","is_active","access_restricted","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'visit_medication_management','paper_scan',CURRENT_DATE,true,false,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "obtained_date" = CURRENT_DATE,
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [DEMO_IDS.consent, base.org_id, DEMO_IDS.patient, DEMO_IDS.caseId]
    );

    await client.query(
      `
        INSERT INTO "PatientPackagingProfile" (
          "id","org_id","patient_id","default_packaging_method","medication_box_color","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,'unit_dose','blue',$4,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "default_packaging_method" = 'unit_dose',
            "patient_id" = EXCLUDED."patient_id",
            "medication_box_color" = 'blue',
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [DEMO_IDS.packaging, base.org_id, DEMO_IDS.patient, '朝昼夕で一包化']
    );

    await client.query(
      `
        INSERT INTO "MedicationProfile" (
          "id","org_id","patient_id","drug_name","dose","frequency","start_date","prescriber","is_current","source","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,true,'manual',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "drug_name" = EXCLUDED."drug_name",
            "dose" = EXCLUDED."dose",
            "frequency" = EXCLUDED."frequency",
            "start_date" = CURRENT_DATE,
            "prescriber" = EXCLUDED."prescriber",
            "is_current" = true,
            "updated_at" = NOW()
      `,
      [DEMO_IDS.medication, base.org_id, DEMO_IDS.patient, medicationName, '1錠', '1日1回 朝食後', '東京内科クリニック']
    );

    await client.query(
      `
        INSERT INTO "Task" (
          "id","org_id","task_type","title","description","status","priority","assigned_to","due_date","related_entity_type","related_entity_id","created_at","updated_at"
        ) VALUES ($1,$2,'patient_followup',$3,$4,'pending','high',$5,$6,'patient',$7,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "title" = EXCLUDED."title",
            "description" = EXCLUDED."description",
            "status" = 'pending',
            "priority" = 'high',
            "assigned_to" = EXCLUDED."assigned_to",
            "due_date" = EXCLUDED."due_date",
            "related_entity_id" = EXCLUDED."related_entity_id",
            "updated_at" = NOW()
      `,
      [DEMO_IDS.task, base.org_id, '訪問前の服薬確認', 'ご家族へ持参薬確認の電話', base.user_id, nextWeek, DEMO_IDS.patient]
    );

    await client.query(
      `
        INSERT INTO "ExternalAccessGrant" (
          "id","org_id","patient_id","token_hash","expires_at","granted_to_name","granted_to_contact","scope","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "expires_at" = EXCLUDED."expires_at",
            "granted_to_name" = EXCLUDED."granted_to_name",
            "granted_to_contact" = EXCLUDED."granted_to_contact",
            "scope" = EXCLUDED."scope",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.grant,
        base.org_id,
        DEMO_IDS.patient,
        'ui-demo-token-hash',
        nextWeek,
        externalShareName,
        '090-3333-4444',
        jsonb({ medications: true, schedules: true }),
      ]
    );

    await client.query(
      `
        INSERT INTO "PatientSelfReport" (
          "id","org_id","patient_id","external_access_grant_id","reported_by_name","relation","category","subject","content","requested_callback","preferred_contact_time","status","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,'submitted',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "external_access_grant_id" = EXCLUDED."external_access_grant_id",
            "subject" = EXCLUDED."subject",
            "content" = EXCLUDED."content",
            "requested_callback" = true,
            "preferred_contact_time" = EXCLUDED."preferred_contact_time",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.selfReport,
        base.org_id,
        DEMO_IDS.patient,
        DEMO_IDS.grant,
        externalShareName,
        '家族',
        '副作用',
        selfReportSubject,
        '朝食後に少しふらつきがあるとのこと。',
        '午前中',
      ]
    );

    await client.query(
      `
        INSERT INTO "CommunicationRequest" (
          "id","org_id","patient_id","case_id","request_type","recipient_name","recipient_role","related_entity_type","related_entity_id","status","subject","content","requested_by","requested_at","due_date","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'care_manager_followup',$5,'care_manager','patient',$3,'sent',$6,$7,$8,NOW(),$9,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "status" = 'sent',
            "subject" = EXCLUDED."subject",
            "content" = EXCLUDED."content",
            "requested_by" = EXCLUDED."requested_by",
            "due_date" = EXCLUDED."due_date",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.communicationRequest,
        base.org_id,
        DEMO_IDS.patient,
        DEMO_IDS.caseId,
        '鈴木ケアマネ',
        '訪問前の確認事項',
        '次回訪問時の残薬状況を共有してください。',
        base.user_id,
        nextWeek,
      ]
    );

    await client.query(
      `
        INSERT INTO "CommunicationEvent" (
          "id","org_id","patient_id","case_id","event_type","channel","direction","counterpart_name","subject","content","occurred_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'care_manager_report','phone','outbound',$5,$6,$7,NOW(),NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "counterpart_name" = EXCLUDED."counterpart_name",
            "subject" = EXCLUDED."subject",
            "content" = EXCLUDED."content",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.communicationEvent,
        base.org_id,
        DEMO_IDS.patient,
        DEMO_IDS.caseId,
        '鈴木ケアマネ',
        '架電メモ',
        '来週の訪問予定を共有済み',
      ]
    );

    await client.query(
      `
        INSERT INTO "ManagementPlan" (
          "id","org_id","case_id","version","title","summary","content","created_by","approved_by","approved_at","reviewed_by","reviewed_at","effective_from","next_review_date","status","created_at","updated_at"
        ) VALUES ($1,$2,$3,1,$4,$5,$6::jsonb,$7,$7,NOW(),$7,NOW(),CURRENT_DATE,$8,'approved',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "title" = EXCLUDED."title",
            "summary" = EXCLUDED."summary",
            "content" = EXCLUDED."content",
            "created_by" = EXCLUDED."created_by",
            "approved_by" = EXCLUDED."approved_by",
            "approved_at" = NOW(),
            "reviewed_by" = EXCLUDED."reviewed_by",
            "reviewed_at" = NOW(),
            "effective_from" = CURRENT_DATE,
            "next_review_date" = EXCLUDED."next_review_date",
            "status" = 'approved',
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.managementPlan,
        base.org_id,
        DEMO_IDS.caseId,
        '訪問薬剤管理指導計画書',
        '服薬状況と残薬確認を中心に継続支援する計画です。',
        jsonb({
          goals: ['服薬遵守の維持', '残薬の適正化'],
          interventions: ['一包化継続', '家族への服薬確認依頼'],
          review_points: ['血圧推移', 'ふらつき再発の有無'],
        }),
        base.user_id,
        nextVisitDate,
      ]
    );

    await client.query(
      `
        INSERT INTO "CareReport" (
          "id","org_id","patient_id","case_id","report_type","status","content","created_by","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'physician_report','response_waiting',$5::jsonb,$6,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "report_type" = EXCLUDED."report_type",
            "status" = 'response_waiting',
            "content" = EXCLUDED."content",
            "created_by" = EXCLUDED."created_by",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.careReport,
        base.org_id,
        DEMO_IDS.patient,
        DEMO_IDS.caseId,
        jsonb({
          patient: {
            name: patientName,
            birth_date: '1948-04-12',
            gender: 'female',
          },
          report_date: new Date().toISOString(),
          visit_date: scheduleDate.toISOString(),
          pharmacist_name: 'UI検証薬剤師',
          prescriber: {
            name: '東京内科クリニック',
            institution: '東京内科クリニック',
          },
          prescriptions: [
            {
              drug_name: medicationName,
              dose: '1錠',
              frequency: '1日1回 朝食後',
              days: 30,
            },
          ],
          medication_management: {
            compliance_summary: '服薬は概ね良好です。',
            adherence_score: 4,
            self_management: '家族支援あり',
            calendar_used: true,
          },
          adverse_events: {
            has_events: false,
            events: [],
          },
          functional_assessment: {
            sleep: '問題なし',
            cognition: '問題なし',
            diet_oral: '食欲良好',
            mobility: '杖歩行',
            excretion: '問題なし',
          },
          residual_medications: [
            {
              drug_name: medicationName,
              remaining_qty: 5,
              excess_days: 5,
              reduction_proposal: false,
            },
          ],
          assessment: '血圧は安定しています。',
          plan: '次回訪問で残薬を再確認します。',
          physician_communication: '必要時に処方見直しを相談します。',
          warnings: [],
        }),
        base.user_id,
      ]
    );

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","pharmacist_id","assignment_mode","route_order","confirmed_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'regular','normal','ready',$5,$6,'primary',1,NOW(),NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "schedule_status" = 'ready',
            "scheduled_date" = EXCLUDED."scheduled_date",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "confirmed_at" = NOW(),
            "updated_at" = NOW()
      `,
      [DEMO_IDS.visitSchedule, base.org_id, DEMO_IDS.caseId, base.site_id, scheduleDate, base.user_id]
    );

    await client.query(
      `
        INSERT INTO "VisitRecord" (
          "id","org_id","schedule_id","patient_id","pharmacist_id","visit_date","outcome_status","soap_subjective","soap_objective","soap_assessment","soap_plan","next_visit_suggestion_date","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,$5,NOW(),'completed',$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "schedule_id" = EXCLUDED."schedule_id",
            "patient_id" = EXCLUDED."patient_id",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "visit_date" = NOW(),
            "outcome_status" = 'completed',
            "soap_subjective" = EXCLUDED."soap_subjective",
            "soap_objective" = EXCLUDED."soap_objective",
            "soap_assessment" = EXCLUDED."soap_assessment",
            "soap_plan" = EXCLUDED."soap_plan",
            "next_visit_suggestion_date" = EXCLUDED."next_visit_suggestion_date",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.visitRecord,
        base.org_id,
        DEMO_IDS.visitSchedule,
        DEMO_IDS.patient,
        base.user_id,
        'めまいは軽減',
        '血圧 132/78 mmHg',
        '服薬継続で問題なし',
        '次回訪問で残薬確認',
        nextVisitDate,
      ]
    );

    return {
      orgId: base.org_id,
      siteId: base.site_id,
      userId: base.user_id,
      patientId: DEMO_IDS.patient,
      patientName,
      patientKana,
      address,
      conditionName,
      contactName,
      medicationName,
      managementPlanId: DEMO_IDS.managementPlan,
      reportId: DEMO_IDS.careReport,
      scheduleId: DEMO_IDS.visitSchedule,
      visitRecordId: DEMO_IDS.visitRecord,
      selfReportSubject,
      externalShareName,
    } satisfies DemoContext;
  } finally {
    await client.end();
  }
}

async function dismissSheetOverlayIfPresent(page: Page) {
  const overlay = page.locator('[data-slot="sheet-overlay"][data-open]').first();
  if (await overlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
  }
}

async function writeScreenshot(page: Page, name: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
    caret: 'initial',
  });
}

async function openPatientDetailRoute(
  page: Page,
  patientId: string,
  options: { view?: 'card' | 'profile'; tab?: string } = {},
) {
  // Default /patients/[id] is the card workspace; the legacy tab UI lives at ?view=profile.
  const view = options.view ?? 'card';
  const params = new URLSearchParams();
  if (view === 'profile') {
    params.set('view', 'profile');
    if (options.tab) params.set('tab', options.tab);
  }
  const query = params.toString();
  await openStableRoute(page, `/patients/${patientId}${query ? `?${query}` : ''}`);

  const readyMarker = page.getByTestId(
    view === 'profile' ? 'patient-detail-tablist' : 'card-workspace',
  );
  const loading = page.locator('main').getByText('読み込み中...');
  if (await readyMarker.isVisible({ timeout: 60_000 }).catch(() => false)) {
    return;
  }

  if (await loading.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await reloadStablePage(page);
  }

  await expect(readyMarker).toBeVisible({ timeout: 60_000 });
}

async function fetchFirstPatientId(page: Page) {
  const response = await page.request.get('/api/patients?per_page=5');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    data?: Array<{ id: string }>;
  };
  const patientId = payload.data?.[0]?.id;
  expect(patientId).toBeTruthy();
  return patientId!;
}

async function waitForPatientsSearch(page: Page, query: string) {
  const response = await page.waitForResponse((candidate) => {
    if (candidate.request().method() !== 'GET') return false;

    const url = new URL(candidate.url());
    return url.pathname === '/api/patients' && url.searchParams.get('q') === query;
  });

  expect(response.ok()).toBeTruthy();
}

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  demoContext = await ensureUiDemoData();
});

test('login screen renders without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !shouldIgnoreConsoleError(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  await openStableRoute(page, '/login');

  await expect(page.getByRole('heading', { name: 'PH-OS' })).toBeVisible();
  await expect(page.getByText('在宅訪問薬局プラットフォーム')).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByLabel('パスワード')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await writeScreenshot(page, 'login');
  expect(errors).toEqual([]);
});

test.describe('major authenticated screens', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  for (const entry of ROOT_ROUTES) {
    test(`${entry.name} screen renders cleanly`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(context);
      await openStableRoute(page, entry.route);

      await expect(page.locator('main')).toBeVisible();
      await writeScreenshot(page, entry.name);
      expect(errors).toEqual([]);
    });
  }

  test('patients screen shows representative backend fields', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/patients');

    await Promise.all([
      waitForPatientsSearch(page, demoContext.patientName),
      page.getByLabel('患者検索').fill(demoContext.patientName),
    ]);

    const patientLink = page.locator(
      `main a[href="/patients/${demoContext.patientId}"]:visible`
    ).first();
    await expect(patientLink).toContainText(demoContext.patientName, { timeout: 30_000 });
    await expect(patientLink).toHaveAttribute('href', `/patients/${demoContext.patientId}`, {
      timeout: 30_000,
    });
    await writeScreenshot(page, 'patients-data');
    expect(errors).toEqual([]);
  });

  test('patient detail screen renders cleanly', async ({ context }) => {
    const bootstrap = await context.newPage();
    const patientId = await fetchFirstPatientId(bootstrap);
    await bootstrap.close();

    const { page, errors } = await createInstrumentedPage(context);
    await openPatientDetailRoute(page, patientId);

    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await writeScreenshot(page, 'patient-detail');
    expect(errors).toEqual([]);
  });

  test('patient detail screen surfaces representative backend data', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    // The profile basic tab renders side rails at xl, so widen the viewport to keep
    // the intake summary card columns readable (and visible to the assertions).
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPatientDetailRoute(page, demoContext.patientId, { view: 'profile', tab: 'basic' });
    await dismissSheetOverlayIfPresent(page);

    await expect(page.locator('main').getByText(demoContext.patientName).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('main').getByText(demoContext.patientKana).first()).toBeVisible({
      timeout: 60_000,
    });
    const intakeSummaryCard = page.getByTestId('patient-intake-summary-card');
    await expect(intakeSummaryCard).toBeVisible();
    await expect(page.locator('main').getByText('訪問薬剤管理 新規依頼受付票').first()).toBeVisible();
    await expect(intakeSummaryCard).toContainText('要介護 3');
    await expect(intakeSummaryCard).toContainText('在宅酸素');
    await expect(intakeSummaryCard).toContainText('一包化');
    await expect(intakeSummaryCard).toContainText('カレンダー');
    await expect(page.locator('main').getByText(demoContext.conditionName).first()).toBeVisible();
    await writeScreenshot(page, 'patient-detail-data');
    expect(errors).toEqual([]);
  });

  const dynamicRoutes = [
    { name: 'patient-consent', route: () => `/patients/${demoContext.patientId}/consent` },
    { name: 'patient-medications', route: () => `/patients/${demoContext.patientId}/medications` },
    { name: 'patient-prescriptions', route: () => `/patients/${demoContext.patientId}/prescriptions` },
    { name: 'patient-share', route: () => `/patients/${demoContext.patientId}/share` },
    { name: 'report-detail', route: () => `/reports/${demoContext.reportId}` },
    { name: 'visit-detail', route: () => `/visits/${demoContext.visitRecordId}` },
    { name: 'visit-record', route: () => `/visits/${demoContext.scheduleId}/record` },
  ] as const;

  for (const entry of dynamicRoutes) {
    test(`${entry.name} screen renders cleanly`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(context);
      await openStableRoute(page, entry.route());

      await expect(page.locator('main')).toBeVisible();
      await writeScreenshot(page, entry.name);
      expect(errors).toEqual([]);
    });
  }

  const sharedChromeRoutes = [
    {
      name: 'report-print',
      route: () => `/reports/${demoContext.reportId}/print`,
      heading: '報告書 印刷ビュー',
      backLabel: '報告書詳細へ戻る',
      expectPrintButton: true,
    },
    {
      name: 'management-plan-print',
      route: () =>
        `/patients/${demoContext.patientId}/management-plan/print?planId=${demoContext.managementPlanId}`,
      heading: '管理計画書 印刷ビュー',
      backLabel: '患者詳細へ戻る',
      expectPrintButton: true,
    },
    {
      name: 'patient-medications-print',
      route: () => `/patients/${demoContext.patientId}/medications/print`,
      heading: '薬歴・服薬一覧 印刷ビュー',
      backLabel: '服薬管理へ戻る',
      expectPrintButton: true,
    },
    {
      name: 'patient-visit-records-print',
      route: () => `/patients/${demoContext.patientId}/visit-records/print`,
      heading: '訪問記録一覧 印刷ビュー',
      backLabel: '患者詳細へ戻る',
      expectPrintButton: true,
    },
  ] as const;

  for (const entry of sharedChromeRoutes) {
    test(`${entry.name} screen renders shared chrome cleanly`, async ({ context }) => {
      const { page, errors } = await createInstrumentedPage(context);
      await openStableRoute(page, entry.route());

      await expect(page.getByRole('heading', { name: entry.heading })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByRole('link', { name: entry.backLabel })).toBeVisible();
      await expect(page.getByTestId('app-shell-print-route')).toBeVisible();
      await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
      await expect(page.getByTestId('print-layout-root')).toBeVisible();
      if (entry.expectPrintButton) {
        await expect(page.getByRole('button', { name: '印刷', exact: true })).toBeVisible();
      }
      await writeScreenshot(page, entry.name);
      expect(errors).toEqual([]);
    });
  }

  test('patient share screen exposes backend share and self-report data', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, `/patients/${demoContext.patientId}/share`);

    await expect(page.locator('main').getByText('共有済みリンクと連絡文脈')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('main').getByText(demoContext.selfReportSubject).first()).toBeVisible({
      timeout: 60_000,
    });
    await writeScreenshot(page, 'patient-share-data');
    expect(errors).toEqual([]);
  });

  test('patient medications screen exposes medication profile data', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, `/patients/${demoContext.patientId}/medications`);

    await expect(page.locator('main').getByText(demoContext.medicationName).first()).toBeVisible({
      timeout: 60_000,
    });
    await writeScreenshot(page, 'patient-medications-data');
    expect(errors).toEqual([]);
  });

  test('reports list keeps direct detail and patient navigation visible', async ({ context }) => {
    const { page, errors } = await createInstrumentedPage(context);
    await openStableRoute(page, '/reports');

    const reportLink = page.locator(`main a[href="/reports/${demoContext.reportId}"]:visible`).first();
    await expect(reportLink).toBeVisible({ timeout: 60_000 });
    await expect(reportLink).toHaveAttribute('href', /\/reports\/[^/]+$/);
    await expect(page.getByRole('button', { name: '詳細を開く' }).first()).toBeVisible();

    const patientLink = page.locator(`main a[href="/patients/${demoContext.patientId}"]:visible`).first();
    await expect(patientLink).toBeVisible();
    await expect(patientLink).toHaveAttribute('href', `/patients/${demoContext.patientId}`);

    await writeScreenshot(page, 'reports-list-navigation');
    expect(errors).toEqual([]);
  });
});
