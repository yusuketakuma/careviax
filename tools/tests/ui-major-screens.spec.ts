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
  { name: 'dispensing', route: '/dispense' },
  { name: 'audit', route: '/audit' },
  { name: 'medication-sets', route: '/set' },
  { name: 'set-audit', route: '/set-audit' },
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
  partnerPharmacy: 'ui_demo_partner_pharmacy_1',
  pharmacyPartnership: 'ui_demo_pharmacy_partnership_1',
  pharmacyContract: 'ui_demo_pharmacy_contract_1',
  pharmacyContractVersion: 'ui_demo_pharmacy_contract_version_1',
  pharmacyContractFeeRule: 'ui_demo_pharmacy_contract_fee_rule_1',
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
  partnershipId: string;
  contractId: string;
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

function dateKeyFromOffset(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function billingMonthFromDateKey(dateKey: string) {
  return `${dateKey.slice(0, 8)}01`;
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
      [DEMO_IDS.patient, base.org_id, patientName, patientKana],
    );

    await client.query(
      `
        UPDATE "Residence"
        SET "is_primary" = false,
            "updated_at" = NOW()
        WHERE "patient_id" = $1
      `,
      [DEMO_IDS.patient],
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
      [DEMO_IDS.residence, base.org_id, DEMO_IDS.patient, address, 'facility-demo-1', '305号室'],
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
      ],
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
      [
        DEMO_IDS.condition,
        base.org_id,
        DEMO_IDS.patient,
        conditionName,
        '定期的な血圧チェックが必要',
      ],
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
      ],
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
      [DEMO_IDS.consent, base.org_id, DEMO_IDS.patient, DEMO_IDS.caseId],
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
      [DEMO_IDS.packaging, base.org_id, DEMO_IDS.patient, '朝昼夕で一包化'],
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
      [
        DEMO_IDS.medication,
        base.org_id,
        DEMO_IDS.patient,
        medicationName,
        '1錠',
        '1日1回 朝食後',
        '東京内科クリニック',
      ],
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
      [
        DEMO_IDS.task,
        base.org_id,
        '訪問前の服薬確認',
        'ご家族へ持参薬確認の電話',
        base.user_id,
        nextWeek,
        DEMO_IDS.patient,
      ],
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
      ],
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
      ],
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
      ],
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
      ],
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
      ],
    );

    await client.query(
      `
        INSERT INTO "PartnerPharmacy" (
          "id","org_id","pharmacy_code","name","address","tel","fax","contact_name","available_services","status","created_by","updated_by","created_at","updated_at"
        ) VALUES ($1,$2,'UI-DEMO-PARTNER-001',$3,$4,$5,$6,$7,$8::jsonb,'active',$9,$9,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "pharmacy_code" = EXCLUDED."pharmacy_code",
            "name" = EXCLUDED."name",
            "address" = EXCLUDED."address",
            "tel" = EXCLUDED."tel",
            "fax" = EXCLUDED."fax",
            "contact_name" = EXCLUDED."contact_name",
            "available_services" = EXCLUDED."available_services",
            "status" = 'active',
            "updated_by" = EXCLUDED."updated_by",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.partnerPharmacy,
        base.org_id,
        'UIデモ協力薬局',
        '東京都千代田区丸の内2-2-2',
        '03-1111-2222',
        '03-1111-3333',
        '連携 担当',
        jsonb(['home_visit_support', 'temporary_visit']),
        base.user_id,
      ],
    );

    await client.query(
      `
        INSERT INTO "PharmacyPartnership" (
          "id","org_id","base_site_id","partner_pharmacy_id","status","available_services","contact_snapshot","effective_from","effective_to","approved_by_base","approved_by_partner","approved_at","created_by","updated_by","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'active',$5::jsonb,$6::jsonb,CURRENT_DATE,$7,$8,$9,NOW(),$8,$8,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "base_site_id" = EXCLUDED."base_site_id",
            "partner_pharmacy_id" = EXCLUDED."partner_pharmacy_id",
            "status" = 'active',
            "available_services" = EXCLUDED."available_services",
            "contact_snapshot" = EXCLUDED."contact_snapshot",
            "effective_from" = CURRENT_DATE,
            "effective_to" = EXCLUDED."effective_to",
            "approved_by_base" = EXCLUDED."approved_by_base",
            "approved_by_partner" = EXCLUDED."approved_by_partner",
            "approved_at" = NOW(),
            "updated_by" = EXCLUDED."updated_by",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.pharmacyPartnership,
        base.org_id,
        base.site_id,
        DEMO_IDS.partnerPharmacy,
        jsonb(['home_visit_support', 'temporary_visit']),
        jsonb({
          partner_pharmacy_name: 'UIデモ協力薬局',
          contact_name: '連携 担当',
          tel: '03-1111-2222',
        }),
        nextVisitDate,
        base.user_id,
        'UIデモ協力薬局 承認者',
      ],
    );

    await client.query(
      `
        INSERT INTO "PharmacyContract" (
          "id","org_id","partnership_id","status","effective_from","effective_to","closing_day","payment_due_rule","base_approved_by","base_approved_at","partner_approved_by","partner_approved_at","created_by","updated_by","created_at","updated_at"
        ) VALUES ($1,$2,$3,'active',CURRENT_DATE,NULL,31,$4::jsonb,$5,NOW(),$6,NOW(),$5,$5,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "partnership_id" = EXCLUDED."partnership_id",
            "status" = 'active',
            "effective_from" = CURRENT_DATE,
            "effective_to" = NULL,
            "closing_day" = EXCLUDED."closing_day",
            "payment_due_rule" = EXCLUDED."payment_due_rule",
            "base_approved_by" = EXCLUDED."base_approved_by",
            "base_approved_at" = NOW(),
            "partner_approved_by" = EXCLUDED."partner_approved_by",
            "partner_approved_at" = NOW(),
            "updated_by" = EXCLUDED."updated_by",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.pharmacyContract,
        base.org_id,
        DEMO_IDS.pharmacyPartnership,
        jsonb({ type: 'next_month_end', closing_day: 31 }),
        base.user_id,
        'UIデモ協力薬局 契約承認者',
      ],
    );

    await client.query(
      `
        INSERT INTO "PharmacyContractVersion" (
          "id","org_id","contract_id","version_no","status","effective_from","effective_to","terms_snapshot","approved_by_base","approved_by_partner","approved_at","created_by","created_at","updated_at"
        ) VALUES ($1,$2,$3,1,'active',CURRENT_DATE,NULL,$4::jsonb,$5,$6,NOW(),$5,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "contract_id" = EXCLUDED."contract_id",
            "version_no" = 1,
            "status" = 'active',
            "effective_from" = CURRENT_DATE,
            "effective_to" = NULL,
            "terms_snapshot" = EXCLUDED."terms_snapshot",
            "approved_by_base" = EXCLUDED."approved_by_base",
            "approved_by_partner" = EXCLUDED."approved_by_partner",
            "approved_at" = NOW(),
            "created_by" = EXCLUDED."created_by",
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.pharmacyContractVersion,
        base.org_id,
        DEMO_IDS.pharmacyContract,
        jsonb({
          scope: 'ui-demo-db-backed-cooperation',
          fee_rule: 'fixed_per_visit',
          invoice_snapshot_required: true,
        }),
        base.user_id,
        'UIデモ協力薬局 契約承認者',
      ],
    );

    await client.query(
      `
        INSERT INTO "PharmacyContractFeeRule" (
          "id","org_id","contract_version_id","billing_model","unit_price","addon_rules","expense_rules","tax_category","tax_rate_bp","rounding_rule","is_active","created_at","updated_at"
        ) VALUES ($1,$2,$3,'fixed_per_visit',8800,$4::jsonb,$5::jsonb,'taxable',1000,'round',true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "contract_version_id" = EXCLUDED."contract_version_id",
            "billing_model" = 'fixed_per_visit',
            "unit_price" = 8800,
            "addon_rules" = EXCLUDED."addon_rules",
            "expense_rules" = EXCLUDED."expense_rules",
            "tax_category" = 'taxable',
            "tax_rate_bp" = 1000,
            "rounding_rule" = 'round',
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.pharmacyContractFeeRule,
        base.org_id,
        DEMO_IDS.pharmacyContractVersion,
        jsonb([]),
        jsonb({ travel_fee: 0 }),
      ],
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
      ],
    );

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","pharmacist_id","assignment_mode","route_order","confirmed_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'regular','normal','ready',$5,$6,'primary',90,NOW(),NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "schedule_status" = 'ready',
            "scheduled_date" = EXCLUDED."scheduled_date",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "route_order" = EXCLUDED."route_order",
            "confirmed_at" = NOW(),
            "updated_at" = NOW()
      `,
      [
        DEMO_IDS.visitSchedule,
        base.org_id,
        DEMO_IDS.caseId,
        base.site_id,
        scheduleDate,
        base.user_id,
      ],
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
      ],
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
      partnershipId: DEMO_IDS.pharmacyPartnership,
      contractId: DEMO_IDS.pharmacyContract,
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

async function clearUiDemoPatientShareCases() {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    await client.query(
      `
        DELETE FROM "PharmacyInvoiceItem"
        WHERE "invoice_id" IN (
          SELECT "id"
          FROM "PharmacyInvoice"
          WHERE "contract_id" = $1
        )
      `,
      [DEMO_IDS.pharmacyContract],
    );

    await client.query(
      `
        DELETE FROM "PharmacyInvoice"
        WHERE "contract_id" = $1
      `,
      [DEMO_IDS.pharmacyContract],
    );

    await client.query(
      `
        DELETE FROM "PharmacyInvoiceItem"
        WHERE "visit_billing_candidate_id" IN (
          SELECT vbc."id"
          FROM "VisitBillingCandidate" vbc
          JOIN "PartnerVisitRecord" pvr
            ON pvr."id" = vbc."partner_visit_record_id"
           AND pvr."org_id" = vbc."org_id"
          JOIN "PatientShareCase" psc
            ON psc."id" = pvr."share_case_id"
           AND psc."org_id" = pvr."org_id"
          WHERE psc."base_patient_id" = $1
            AND psc."partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "VisitBillingCandidate"
        WHERE "partner_visit_record_id" IN (
          SELECT pvr."id"
          FROM "PartnerVisitRecord" pvr
          JOIN "PatientShareCase" psc
            ON psc."id" = pvr."share_case_id"
           AND psc."org_id" = pvr."org_id"
          WHERE psc."base_patient_id" = $1
            AND psc."partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "CareReport"
        WHERE "partner_visit_record_id" IN (
          SELECT pvr."id"
          FROM "PartnerVisitRecord" pvr
          JOIN "PatientShareCase" psc
            ON psc."id" = pvr."share_case_id"
           AND psc."org_id" = pvr."org_id"
          WHERE psc."base_patient_id" = $1
            AND psc."partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "ClaimCooperationNote"
        WHERE "partner_visit_record_id" IN (
          SELECT pvr."id"
          FROM "PartnerVisitRecord" pvr
          JOIN "PatientShareCase" psc
            ON psc."id" = pvr."share_case_id"
           AND psc."org_id" = pvr."org_id"
          WHERE psc."base_patient_id" = $1
            AND psc."partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "PartnerVisitRecord"
        WHERE "share_case_id" IN (
          SELECT "id"
          FROM "PatientShareCase"
          WHERE "base_patient_id" = $1
            AND "partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "PharmacyCooperationMessage"
        WHERE "thread_id" IN (
          SELECT thread."id"
          FROM "PharmacyCooperationMessageThread" thread
          JOIN "PatientShareCase" psc
            ON psc."id" = thread."share_case_id"
           AND psc."org_id" = thread."org_id"
          WHERE psc."base_patient_id" = $1
            AND psc."partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "PharmacyCooperationMessageThread"
        WHERE "share_case_id" IN (
          SELECT "id"
          FROM "PatientShareCase"
          WHERE "base_patient_id" = $1
            AND "partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "PharmacyVisitRequest"
        WHERE "share_case_id" IN (
          SELECT "id"
          FROM "PatientShareCase"
          WHERE "base_patient_id" = $1
            AND "partnership_id" = $2
        )
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    await client.query(
      `
        DELETE FROM "PatientShareCase"
        WHERE "base_patient_id" = $1
          AND "partnership_id" = $2
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );
  } finally {
    await client.end();
  }
}

async function readUiDemoPharmacyVisitRequest(shareCaseId: string) {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      share_case_id: string;
      status: string;
      urgency: string;
      visit_type: string | null;
      contract_id: string | null;
      contract_version_id: string | null;
      estimated_amount: number | null;
      has_contract_estimate_snapshot: boolean;
      accepted_by: string | null;
    }>(
      `
        SELECT
          "id",
          "share_case_id",
          "status"::text,
          "urgency",
          "visit_type"::text,
          "contract_id",
          "contract_version_id",
          "estimated_amount",
          ("estimated_snapshot" IS NOT NULL) AS has_contract_estimate_snapshot,
          "accepted_by"
        FROM "PharmacyVisitRequest"
        WHERE "share_case_id" = $1
        ORDER BY "created_at" DESC
        LIMIT 1
      `,
      [shareCaseId],
    );

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function readUiDemoPartnerVisitRecord(visitRequestId: string) {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      visit_request_id: string;
      share_case_id: string;
      status: string;
      source_visit_record_id: string | null;
      has_record_content: boolean;
      has_submitted_at: boolean;
      has_confirmed_at: boolean;
      confirmed_by: string | null;
      has_base_confirmation_snapshot: boolean;
      claim_note_count: number;
      report_count: number;
    }>(
      `
        SELECT
          pvr."id",
          pvr."visit_request_id",
          pvr."share_case_id",
          pvr."status"::text,
          pvr."source_visit_record_id",
          (pvr."record_content" IS NOT NULL) AS has_record_content,
          (pvr."submitted_at" IS NOT NULL) AS has_submitted_at,
          (pvr."confirmed_at" IS NOT NULL) AS has_confirmed_at,
          pvr."confirmed_by",
          (pvr."base_confirmation_snapshot" IS NOT NULL) AS has_base_confirmation_snapshot,
          (
            SELECT COUNT(*)::int
            FROM "ClaimCooperationNote" note
            WHERE note."partner_visit_record_id" = pvr."id"
              AND note."org_id" = pvr."org_id"
          ) AS claim_note_count,
          (
            SELECT COUNT(*)::int
            FROM "CareReport" report
            WHERE report."partner_visit_record_id" = pvr."id"
              AND report."org_id" = pvr."org_id"
          ) AS report_count
        FROM "PartnerVisitRecord" pvr
        WHERE pvr."visit_request_id" = $1
        ORDER BY pvr."created_at" DESC
        LIMIT 1
      `,
      [visitRequestId],
    );

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function readUiDemoVisitBillingCandidate(partnerVisitRecordId: string) {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      partner_visit_record_id: string;
      contract_version_id: string | null;
      billing_status: string;
      is_billable: boolean;
      amount: number | null;
      billing_model: string | null;
      tax_rate_bp: number | null;
    }>(
      `
        SELECT
          "id",
          "partner_visit_record_id",
          "contract_version_id",
          "billing_status"::text,
          "is_billable",
          NULLIF("amount_snapshot"->>'amount', '')::int AS amount,
          "amount_snapshot"->>'billing_model' AS billing_model,
          NULLIF("amount_snapshot"->>'tax_rate_bp', '')::int AS tax_rate_bp
        FROM "VisitBillingCandidate"
        WHERE "partner_visit_record_id" = $1
        ORDER BY "created_at" DESC
        LIMIT 1
      `,
      [partnerVisitRecordId],
    );

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function readUiDemoPharmacyInvoice(invoiceId: string) {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      status: string;
      subtotal: number;
      tax_amount: number;
      total: number;
      invoice_no: string | null;
      has_paid_at: boolean;
      item_count: number;
    }>(
      `
        SELECT
          invoice."id",
          invoice."status"::text,
          invoice."subtotal",
          invoice."tax_amount",
          invoice."total",
          invoice."invoice_no",
          (invoice."paid_at" IS NOT NULL) AS has_paid_at,
          (
            SELECT COUNT(*)::int
            FROM "PharmacyInvoiceItem" item
            WHERE item."invoice_id" = invoice."id"
              AND item."org_id" = invoice."org_id"
          ) AS item_count
        FROM "PharmacyInvoice" invoice
        WHERE invoice."id" = $1
        LIMIT 1
      `,
      [invoiceId],
    );

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function readUiDemoPatientShareCase() {
  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    const result = await client.query<{
      id: string;
      status: string;
      shared_management_plan_id: string | null;
      shared_management_plan_version: number | null;
      link_count: number;
      link_match_status: string | null;
      has_base_approval: boolean;
      has_partner_approval: boolean;
      has_activated_at: boolean;
      active_consent_count: number;
    }>(
      `
        SELECT
          psc."id",
          psc."status"::text,
          psc."shared_management_plan_id",
          psc."shared_management_plan_version",
          (
            SELECT COUNT(*)::int
            FROM "PatientLink" counted_pl
            WHERE counted_pl."share_case_id" = psc."id"
              AND counted_pl."org_id" = psc."org_id"
          ) AS link_count,
          pl."match_status"::text AS link_match_status,
          (pl."approved_by_base" IS NOT NULL) AS has_base_approval,
          (pl."approved_by_partner" IS NOT NULL) AS has_partner_approval,
          (psc."activated_at" IS NOT NULL) AS has_activated_at,
          (
            SELECT COUNT(*)::int
            FROM "PatientShareConsent" consent
            WHERE consent."share_case_id" = psc."id"
              AND consent."org_id" = psc."org_id"
              AND consent."revoked_at" IS NULL
          ) AS active_consent_count
        FROM "PatientShareCase" psc
        LEFT JOIN "PatientLink" pl
          ON pl."share_case_id" = psc."id"
         AND pl."org_id" = psc."org_id"
        WHERE psc."base_patient_id" = $1
          AND psc."partnership_id" = $2
        ORDER BY psc."created_at" DESC
        LIMIT 1
      `,
      [DEMO_IDS.patient, DEMO_IDS.pharmacyPartnership],
    );

    return result.rows[0] ?? null;
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

async function openPatientDetailRoute(page: Page, patientId: string) {
  await openStableRoute(page, `/patients/${patientId}`);

  const readyMarker = page.getByTestId('card-workspace');
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
  await expect(page.getByText('在宅薬局オペレーション').first()).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByLabel('パスワード')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログインする' })).toBeVisible();
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
      page.getByLabel('氏名・住所で検索').fill(demoContext.patientName),
    ]);

    const patientLink = page
      .locator(`main a[href="/patients/${demoContext.patientId}"]:visible`)
      .first();
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
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPatientDetailRoute(page, demoContext.patientId);
    await dismissSheetOverlayIfPresent(page);

    await expect(page.locator('main').getByText(demoContext.patientName).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('card-workspace')).toBeVisible();
    await expect(page.getByTestId('patient-profile-summary')).toBeVisible();
    await expect(page.getByTestId('patient-profile-summary')).toContainText(
      demoContext.conditionName,
    );
    await expect(page.getByTestId('safety-board')).toBeVisible();
    await expect(page.getByTestId('card-prescription-section')).toBeVisible();
    await writeScreenshot(page, 'patient-detail-data');
    expect(errors).toEqual([]);
  });

  const dynamicRoutes = [
    { name: 'patient-consent', route: () => `/patients/${demoContext.patientId}/consent` },
    { name: 'patient-medications', route: () => `/patients/${demoContext.patientId}/medications` },
    {
      name: 'patient-prescriptions',
      route: () => `/patients/${demoContext.patientId}/prescriptions`,
    },
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
    await expect(page.locator('main').getByText(demoContext.selfReportSubject).first()).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await writeScreenshot(page, 'patient-share-data');
    expect(errors).toEqual([]);
  });

  test('patient card drives a DB-backed share, visit, report, and billing flow', async ({
    context,
  }) => {
    await clearUiDemoPatientShareCases();

    const { page, errors } = await createInstrumentedPage(context);
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPatientDetailRoute(page, demoContext.patientId);
    await dismissSheetOverlayIfPresent(page);

    const panel = page.getByTestId('patient-share-case-create-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByLabel('共有ケース作成の連携先')).toBeEnabled({ timeout: 60_000 });
    await panel.getByLabel('共有ケース作成の連携先').selectOption(demoContext.partnershipId);

    const managementPlanSelect = panel.getByLabel('共有ケース作成の管理計画版');
    await expect(managementPlanSelect).toBeEnabled({ timeout: 60_000 });
    await managementPlanSelect.selectOption(demoContext.managementPlanId);
    await expect(managementPlanSelect).toHaveValue(demoContext.managementPlanId);

    const createResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/patient-share-cases' && response.request().method() === 'POST';
    });
    await panel.getByRole('button', { name: '共有ケースを作成' }).click();
    await expect((await createResponse).status()).toBe(201);

    const shareCase = await readUiDemoPatientShareCase();
    expect(shareCase).toMatchObject({
      status: 'consent_pending',
      shared_management_plan_id: demoContext.managementPlanId,
      shared_management_plan_version: 1,
      link_count: 1,
    });
    expect(shareCase?.id).toEqual(expect.any(String));

    const consentResponse = await page.request.post(
      `/api/patient-share-cases/${shareCase!.id}/consents`,
      {
        data: {
          consent_date: dateKeyFromOffset(-1),
          consent_person: 'UI検証 家族',
          consent_method: 'paper_scan',
          consent_record_id: DEMO_IDS.consent,
          scope: {
            medication_profile: true,
            care_reports: true,
            pdf_output: true,
          },
          valid_until: dateKeyFromOffset(30),
        },
      },
    );
    expect(consentResponse.status()).toBe(201);

    const baseApproveResponse = await page.request.patch(
      `/api/patient-share-cases/${shareCase!.id}/patient-link`,
      {
        data: {
          decision: 'base_approve',
        },
      },
    );
    expect(baseApproveResponse.status()).toBe(200);

    const partnerAcceptResponse = await page.request.patch(
      `/api/patient-share-cases/${shareCase!.id}/patient-link`,
      {
        data: {
          decision: 'accept',
          partner_patient_id: 'ui_demo_partner_patient_1',
          partner_patient_snapshot: {
            name: demoContext.patientName,
            name_kana: demoContext.patientKana,
            birth_date: '1948-04-12',
            address: demoContext.address,
          },
        },
      },
    );
    expect(partnerAcceptResponse.status()).toBe(200);

    const activationResponse = await page.request.post(
      `/api/patient-share-cases/${shareCase!.id}/activate`,
    );
    expect(activationResponse.status()).toBe(200);

    const activatedShareCase = await readUiDemoPatientShareCase();
    expect(activatedShareCase).toMatchObject({
      id: shareCase!.id,
      status: 'active',
      link_count: 1,
      link_match_status: 'accepted',
      has_base_approval: true,
      has_partner_approval: true,
      has_activated_at: true,
      active_consent_count: 1,
    });

    const visitDate = dateKeyFromOffset(1);
    const visitRequestResponse = await page.request.post('/api/pharmacy-visit-requests', {
      data: {
        share_case_id: shareCase!.id,
        urgency: 'normal',
        desired_start_at: `${visitDate}T10:30:00.000Z`,
        desired_end_at: `${visitDate}T11:30:00.000Z`,
        visit_type: 'regular',
        request_reason: 'DB-backed訪問依頼の確認',
        physician_instruction: '血圧と副作用を確認',
        carry_items: ['分包済み一包', '残薬バッグ'],
        patient_home_notes: '家族同席予定',
      },
    });
    expect(visitRequestResponse.status()).toBe(201);

    const visitRequest = await readUiDemoPharmacyVisitRequest(shareCase!.id);
    expect(visitRequest).toMatchObject({
      share_case_id: shareCase!.id,
      status: 'requested',
      urgency: 'normal',
      visit_type: 'regular',
      contract_id: demoContext.contractId,
      contract_version_id: DEMO_IDS.pharmacyContractVersion,
      estimated_amount: 8800,
      has_contract_estimate_snapshot: true,
    });
    expect(visitRequest?.id).toEqual(expect.any(String));

    const visitAcceptResponse = await page.request.post(
      `/api/pharmacy-visit-requests/${visitRequest!.id}/decision`,
      {
        data: {
          decision: 'accept',
          pharmacist_id: demoContext.userId,
        },
      },
    );
    expect(visitAcceptResponse.status()).toBe(200);

    const acceptedVisitRequest = await readUiDemoPharmacyVisitRequest(shareCase!.id);
    expect(acceptedVisitRequest).toMatchObject({
      id: visitRequest!.id,
      status: 'accepted',
      accepted_by: demoContext.userId,
    });

    const partnerRecordResponse = await page.request.post('/api/partner-visit-records', {
      data: {
        visit_request_id: visitRequest!.id,
        pharmacist_id: demoContext.userId,
        pharmacist_name: 'UI検証 協力薬剤師',
        visit_at: `${visitDate}T10:45:00.000Z`,
        source_visit_record_id: demoContext.visitRecordId,
        record_content: {
          medication_adherence: 'DB-backed確認済み',
          remaining_medications: '残薬なし',
          suspected_adverse_effects: '疑いなし',
          storage_status: '良好',
          proposals: '継続確認',
        },
      },
    });
    expect(partnerRecordResponse.status()).toBe(201);
    const partnerRecord = (await partnerRecordResponse.json()) as {
      id: string;
      status: string;
      source_visit_record_id: string | null;
      has_record_content: boolean;
    };
    expect(partnerRecord).toMatchObject({
      status: 'draft',
      source_visit_record_id: demoContext.visitRecordId,
      has_record_content: true,
    });

    let storedPartnerRecord = await readUiDemoPartnerVisitRecord(visitRequest!.id);
    expect(storedPartnerRecord).toMatchObject({
      id: partnerRecord.id,
      visit_request_id: visitRequest!.id,
      share_case_id: shareCase!.id,
      status: 'draft',
      source_visit_record_id: demoContext.visitRecordId,
      has_record_content: true,
      has_submitted_at: false,
      has_confirmed_at: false,
      claim_note_count: 0,
      report_count: 0,
    });

    const submitRecordResponse = await page.request.post(
      `/api/partner-visit-records/${partnerRecord.id}/submit`,
    );
    expect(submitRecordResponse.status()).toBe(200);
    const submittedRecord = (await submitRecordResponse.json()) as {
      partner_visit_record: {
        id: string;
        status: string;
        has_record_content: boolean;
      };
      notify_base_pharmacy: boolean;
    };
    expect(submittedRecord.partner_visit_record).toMatchObject({
      id: partnerRecord.id,
      status: 'submitted',
      has_record_content: true,
    });
    expect(submittedRecord.notify_base_pharmacy).toBe(true);

    const reviewRecordResponse = await page.request.post(
      `/api/partner-visit-records/${partnerRecord.id}/review`,
      {
        data: {
          decision: 'confirm',
          doctor_report_required: true,
        },
      },
    );
    expect(reviewRecordResponse.status()).toBe(200);
    const reviewedRecord = (await reviewRecordResponse.json()) as {
      id: string;
      status: string;
      confirmed_by: string | null;
      has_base_confirmation_snapshot: boolean;
      claim_note: { id: string } | null;
    };
    expect(reviewedRecord).toMatchObject({
      id: partnerRecord.id,
      status: 'confirmed',
      confirmed_by: demoContext.userId,
      has_base_confirmation_snapshot: true,
    });
    expect(reviewedRecord.claim_note?.id).toEqual(expect.any(String));

    storedPartnerRecord = await readUiDemoPartnerVisitRecord(visitRequest!.id);
    expect(storedPartnerRecord).toMatchObject({
      id: partnerRecord.id,
      status: 'confirmed',
      has_submitted_at: true,
      has_confirmed_at: true,
      confirmed_by: demoContext.userId,
      has_base_confirmation_snapshot: true,
      claim_note_count: 1,
      report_count: 0,
    });

    const reportDraftResponse = await page.request.post(
      `/api/partner-visit-records/${partnerRecord.id}/physician-report-draft`,
    );
    expect(reportDraftResponse.status()).toBe(201);
    const reportDraft = (await reportDraftResponse.json()) as {
      reused_existing_draft: boolean;
      report: {
        id: string;
        partner_visit_record_id: string | null;
        report_type: string;
        status: string;
      };
    };
    expect(reportDraft).toMatchObject({
      reused_existing_draft: false,
      report: {
        partner_visit_record_id: partnerRecord.id,
        report_type: 'physician_report',
        status: 'draft',
      },
    });

    storedPartnerRecord = await readUiDemoPartnerVisitRecord(visitRequest!.id);
    expect(storedPartnerRecord).toMatchObject({
      id: partnerRecord.id,
      status: 'confirmed',
      report_count: 1,
    });

    const billingMonth = billingMonthFromDateKey(visitDate);
    const billingCandidateResponse = await page.request.post('/api/visit-billing-candidates', {
      data: {
        billing_month: billingMonth,
        share_case_id: shareCase!.id,
      },
    });
    expect(billingCandidateResponse.status()).toBe(200);
    const billingCandidateBatch = (await billingCandidateResponse.json()) as {
      billing_month: string;
      scanned_confirmed_records: number;
      generated_candidates: number;
      billable_count: number;
      excluded_count: number;
    };
    expect(billingCandidateBatch).toMatchObject({
      billing_month: billingMonth,
      scanned_confirmed_records: 1,
      generated_candidates: 1,
      billable_count: 1,
      excluded_count: 0,
    });

    const billingCandidate = await readUiDemoVisitBillingCandidate(partnerRecord.id);
    expect(billingCandidate).toMatchObject({
      partner_visit_record_id: partnerRecord.id,
      contract_version_id: DEMO_IDS.pharmacyContractVersion,
      billing_status: 'candidate',
      is_billable: true,
      amount: 8800,
      billing_model: 'fixed_per_visit',
      tax_rate_bp: 1000,
    });

    const invoiceDraftResponse = await page.request.post('/api/pharmacy-invoices', {
      data: {
        billing_month: billingMonth,
        contract_id: demoContext.contractId,
        document_kind: 'invoice',
      },
    });
    expect(invoiceDraftResponse.status()).toBe(201);
    const invoiceDraft = (await invoiceDraftResponse.json()) as {
      id: string;
      document_kind: string;
      status: string;
      subtotal: number;
      tax_amount: number;
      total: number;
      item_count: number;
      has_snapshot: boolean;
    };
    expect(invoiceDraft).toMatchObject({
      document_kind: 'invoice',
      status: 'draft',
      subtotal: 8800,
      tax_amount: 880,
      total: 9680,
      item_count: 1,
      has_snapshot: true,
    });

    const issueInvoiceResponse = await page.request.patch(
      `/api/pharmacy-invoices/${invoiceDraft.id}`,
      {
        data: {
          action: 'issue',
          occurred_at: visitDate,
        },
      },
    );
    expect(issueInvoiceResponse.status()).toBe(200);
    const issuedInvoice = (await issueInvoiceResponse.json()) as {
      id: string;
      status: string;
      invoice_no: string | null;
      item_count: number;
    };
    expect(issuedInvoice).toMatchObject({
      id: invoiceDraft.id,
      status: 'issued',
      item_count: 1,
    });
    expect(issuedInvoice.invoice_no).toEqual(expect.any(String));

    const paidDate = dateKeyFromOffset(2);
    const paymentResponse = await page.request.patch(`/api/pharmacy-invoices/${invoiceDraft.id}`, {
      data: {
        action: 'record_payment',
        occurred_at: paidDate,
      },
    });
    expect(paymentResponse.status()).toBe(200);
    const paidInvoice = (await paymentResponse.json()) as {
      id: string;
      status: string;
      paid_at: string | null;
    };
    expect(paidInvoice).toMatchObject({
      id: invoiceDraft.id,
      status: 'paid',
    });
    expect(paidInvoice.paid_at).toEqual(expect.any(String));

    const invoicePdfResponse = await page.request.get(
      `/api/pharmacy-invoices/${invoiceDraft.id}/pdf?purpose=db-backed-e2e-proof`,
    );
    expect(invoicePdfResponse.status()).toBe(200);
    expect(invoicePdfResponse.headers()['content-type']).toContain('application/pdf');

    const storedInvoice = await readUiDemoPharmacyInvoice(invoiceDraft.id);
    expect(storedInvoice).toMatchObject({
      id: invoiceDraft.id,
      status: 'paid',
      subtotal: 8800,
      tax_amount: 880,
      total: 9680,
      has_paid_at: true,
      item_count: 1,
    });
    expect(storedInvoice?.invoice_no).toEqual(expect.any(String));

    await openStableRoute(page, '/workflow/pharmacy-cooperation');
    const shareCasesTable = page.getByRole('table', { name: '患者共有ケース一覧' });
    const activatedShareCaseRow = shareCasesTable.getByRole('row').filter({
      hasText: shareCase!.id,
    });
    await expect(activatedShareCaseRow.getByText('共有中')).toBeVisible({ timeout: 60_000 });
    const visitRequestsTable = page.getByRole('table', { name: '協力薬局訪問依頼一覧' });
    await expect(
      visitRequestsTable.getByRole('row').filter({ hasText: visitRequest!.id }),
    ).toBeVisible({ timeout: 60_000 });
    const partnerRecordsTable = page.getByRole('table', { name: '協力訪問記録一覧' });
    await expect(
      partnerRecordsTable.getByRole('row').filter({ hasText: partnerRecord.id }),
    ).toBeVisible({ timeout: 60_000 });

    await writeScreenshot(page, 'patient-share-visit-billing-db-backed');
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

    const reportLink = page
      .locator(`main a[href="/reports/${demoContext.reportId}"]:visible`)
      .first();
    await expect(reportLink).toBeVisible({ timeout: 60_000 });
    await expect(reportLink).toHaveAttribute('href', /\/reports\/[^/]+$/);
    await expect(page.getByRole('button', { name: '詳細を開く' }).first()).toBeVisible();

    const patientLink = page
      .locator(`main a[href="/patients/${demoContext.patientId}"]:visible`)
      .first();
    await expect(patientLink).toBeVisible();
    await expect(patientLink).toHaveAttribute('href', `/patients/${demoContext.patientId}`);

    await writeScreenshot(page, 'reports-list-navigation');
    expect(errors).toEqual([]);
  });
});
