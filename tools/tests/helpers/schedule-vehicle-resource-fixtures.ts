import { Client } from 'pg';

const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');

export const SCHEDULE_VEHICLE_FIXTURE_IDS = {
  baseVehicle: 'cmnhseedveh001amq9ph-os',
  acceptanceVehicle: 'e2e_vehicle_acceptance_large',
  capacityVehicle: 'e2e_vehicle_capacity_one',
  otherSite: 'e2e_vehicle_other_site',
  otherSiteVehicle: 'e2e_vehicle_other_site_car',
  existingSchedule: 'e2e_vehicle_existing_schedule',
  sharedCapacityUser: 'e2e_shared_vehicle_pharmacist',
  sharedCapacityMembership: 'e2e_shared_vehicle_membership',
  sharedCapacityShift: 'e2e_shared_vehicle_shift',
  sharedCapacitySchedule: 'e2e_shared_vehicle_schedule',
  sharedCapacityVehicle: 'e2e_shared_vehicle_capacity_one',
  consent: 'e2e_vehicle_visit_consent',
  managementPlan: 'e2e_vehicle_management_plan',
  substitutePatient: 'e2e_substitute_patient',
  substituteResidence: 'e2e_substitute_residence',
  substituteCase: 'e2e_substitute_case',
  substituteBackupUser: 'e2e_substitute_backup_user',
  substituteBackupMembership: 'e2e_substitute_backup_membership',
  substituteConsent: 'e2e_substitute_visit_consent',
  substituteManagementPlan: 'e2e_substitute_management_plan',
  substituteShift: 'e2e_substitute_backup_shift',
  baseCycle: 'e2e_vehicle_medication_cycle',
  baseIntake: 'e2e_vehicle_prescription_intake',
  baseLine: 'e2e_vehicle_prescription_line',
  substituteCycle: 'e2e_substitute_medication_cycle',
  substituteIntake: 'e2e_substitute_prescription_intake',
  substituteLine: 'e2e_substitute_prescription_line',
  caseId: 'cmnhseedcase001amq9ph-os',
  patientId: 'cmnhseedpt001amq9ph-os',
  userId: 'cmnb3swgz0008wgq9gfpgjq6r',
  siteId: 'cmnhseedsite000amq9ph-os',
  acceptanceDate: '2026-07-14',
  rejectionDate: '2026-07-07',
  sharedCapacityDate: '2026-07-28',
  substituteDate: '2026-07-21',
} as const;

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Schedule vehicle fixtures require PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(DB_CONNECTION_STRING);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!allowedHosts.has(url.hostname) || databaseName !== 'ph_os_e2e') {
    throw new Error('Schedule vehicle fixtures can only run against local ph_os_e2e');
  }
}

async function upsertSchedulableMedicationCycle(
  client: Client,
  fixture: {
    cycleId: string;
    intakeId: string;
    lineId: string;
    caseId: string;
    patientId: string;
    externalPrescriptionId: string;
    rxNumber: string;
    drugName: string;
  },
) {
  await client.query(
    `
      INSERT INTO "MedicationCycle" (
        "id","org_id","case_id","patient_id","overall_status","exception_status","version","created_at","updated_at"
      ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,'set_audited',NULL,991,NOW(),NOW())
      ON CONFLICT ("id") DO UPDATE
      SET "case_id" = EXCLUDED."case_id",
          "patient_id" = EXCLUDED."patient_id",
          "overall_status" = 'set_audited',
          "exception_status" = NULL,
          "version" = EXCLUDED."version",
          "updated_at" = NOW()
    `,
    [fixture.cycleId, fixture.caseId, fixture.patientId],
  );

  await client.query(
    `
      INSERT INTO "PrescriptionIntake" (
        "id","org_id","cycle_id","source_type","external_prescription_id","rx_number","prescribed_date","prescriber_name","prescriber_institution","prescription_category","created_at","updated_at"
      ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'paper',$3,$4,'2026-07-01','E2E 医師','E2E 在宅クリニック','regular',NOW(),NOW())
      ON CONFLICT ("id") DO UPDATE
      SET "cycle_id" = EXCLUDED."cycle_id",
          "source_type" = 'paper',
          "external_prescription_id" = EXCLUDED."external_prescription_id",
          "rx_number" = EXCLUDED."rx_number",
          "prescribed_date" = EXCLUDED."prescribed_date",
          "prescriber_name" = EXCLUDED."prescriber_name",
          "prescriber_institution" = EXCLUDED."prescriber_institution",
          "prescription_category" = 'regular',
          "updated_at" = NOW()
    `,
    [fixture.intakeId, fixture.cycleId, fixture.externalPrescriptionId, fixture.rxNumber],
  );

  await client.query(
    `
      INSERT INTO "PrescriptionLine" (
        "id","org_id","intake_id","line_number","drug_name","drug_code","dose","frequency","days","quantity","unit","start_date","end_date","created_at","updated_at"
      ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,1,$3,NULL,'1錠','1日1回 朝食後',62,62,'錠','2026-07-01','2026-08-31',NOW(),NOW())
      ON CONFLICT ("id") DO UPDATE
      SET "intake_id" = EXCLUDED."intake_id",
          "line_number" = 1,
          "drug_name" = EXCLUDED."drug_name",
          "drug_code" = NULL,
          "dose" = '1錠',
          "frequency" = '1日1回 朝食後',
          "days" = 62,
          "quantity" = 62,
          "unit" = '錠',
          "start_date" = EXCLUDED."start_date",
          "end_date" = EXCLUDED."end_date",
          "updated_at" = NOW()
    `,
    [fixture.lineId, fixture.intakeId, fixture.drugName],
  );
}

export async function ensureScheduleVehicleResourceFixtures() {
  assertSafeE2eDatabase();

  const client = new Client({ connectionString: DB_CONNECTION_STRING });
  await client.connect();

  try {
    await client.query(
      `
        DELETE FROM "VisitSchedule"
        WHERE "org_id" = 'cmnhseedorg0000amq9ph-os'
          AND "cycle_id" IN ($1,$2)
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.baseCycle, SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCycle],
    );

    await client.query(
      `
        INSERT INTO "ConsentRecord" (
          "id","org_id","patient_id","case_id","consent_type","method","obtained_date","expiry_date","revoked_date","is_active","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,'visit_medication_management','paper_scan','2026-01-01','2026-12-31',NULL,true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "consent_type" = EXCLUDED."consent_type",
            "method" = EXCLUDED."method",
            "obtained_date" = EXCLUDED."obtained_date",
            "expiry_date" = EXCLUDED."expiry_date",
            "revoked_date" = NULL,
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.consent,
        SCHEDULE_VEHICLE_FIXTURE_IDS.patientId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.caseId,
      ],
    );

    await client.query(
      `
        INSERT INTO "ManagementPlan" (
          "id","org_id","case_id","status","version","title","summary","content","created_by","approved_by","approved_at","effective_from","next_review_date","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'approved',991,'E2E車両制約用計画書','E2E vehicle constraint management plan','{"sections":[]}'::jsonb,$3,$3,'2026-01-01','2026-01-01','2026-12-31',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "case_id" = EXCLUDED."case_id",
            "status" = 'approved',
            "version" = EXCLUDED."version",
            "title" = EXCLUDED."title",
            "summary" = EXCLUDED."summary",
            "content" = EXCLUDED."content",
            "created_by" = EXCLUDED."created_by",
            "approved_by" = EXCLUDED."approved_by",
            "approved_at" = EXCLUDED."approved_at",
            "effective_from" = EXCLUDED."effective_from",
            "next_review_date" = EXCLUDED."next_review_date",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.managementPlan,
        SCHEDULE_VEHICLE_FIXTURE_IDS.caseId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.userId,
      ],
    );

    await upsertSchedulableMedicationCycle(client, {
      cycleId: SCHEDULE_VEHICLE_FIXTURE_IDS.baseCycle,
      intakeId: SCHEDULE_VEHICLE_FIXTURE_IDS.baseIntake,
      lineId: SCHEDULE_VEHICLE_FIXTURE_IDS.baseLine,
      caseId: SCHEDULE_VEHICLE_FIXTURE_IDS.caseId,
      patientId: SCHEDULE_VEHICLE_FIXTURE_IDS.patientId,
      externalPrescriptionId: 'e2e-vehicle-external-prescription-1',
      rxNumber: 'E2E-VEHICLE-RX-001',
      drugName: 'E2E車両制約薬',
    });

    await client.query(
      `
        INSERT INTO "PharmacySite" (
          "id","org_id","name","address","lat","lng","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os','E2E 車両別拠点','東京都品川区E2E2-2-2',35.62,139.73,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "name" = EXCLUDED."name",
            "address" = EXCLUDED."address",
            "lat" = EXCLUDED."lat",
            "lng" = EXCLUDED."lng",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.otherSite],
    );

    for (const date of [
      SCHEDULE_VEHICLE_FIXTURE_IDS.rejectionDate,
      SCHEDULE_VEHICLE_FIXTURE_IDS.acceptanceDate,
    ]) {
      await client.query(
        `
          INSERT INTO "PharmacistShift" (
            "id","org_id","site_id","user_id","date","available","available_from","available_to","note","created_at","updated_at"
          ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,$4,true,'09:00','18:00','E2E vehicle constraint fixture',NOW(),NOW())
          ON CONFLICT ("user_id","date") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "site_id" = EXCLUDED."site_id",
              "available" = true,
              "available_from" = EXCLUDED."available_from",
              "available_to" = EXCLUDED."available_to",
              "note" = EXCLUDED."note",
              "updated_at" = NOW()
        `,
        [
          `shift_${date.replaceAll('-', '_')}_vehicle_fixture`,
          SCHEDULE_VEHICLE_FIXTURE_IDS.siteId,
          SCHEDULE_VEHICLE_FIXTURE_IDS.userId,
          date,
        ],
      );
    }

    await client.query(
      `
        INSERT INTO "VisitVehicleResource" (
          "id","org_id","site_id","label","vehicle_code","travel_mode","max_stops","max_route_duration_minutes","available","notes","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'E2E上限1台','E2E-CAP-001','DRIVE',1,120,true,'E2E capacity constraint fixture',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "site_id" = EXCLUDED."site_id",
            "label" = EXCLUDED."label",
            "vehicle_code" = EXCLUDED."vehicle_code",
            "travel_mode" = EXCLUDED."travel_mode",
            "max_stops" = EXCLUDED."max_stops",
            "max_route_duration_minutes" = EXCLUDED."max_route_duration_minutes",
            "available" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.capacityVehicle, SCHEDULE_VEHICLE_FIXTURE_IDS.siteId],
    );

    await client.query(
      `
        INSERT INTO "VisitVehicleResource" (
          "id","org_id","site_id","label","vehicle_code","travel_mode","max_stops","max_route_duration_minutes","available","notes","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'E2E共有上限1台','E2E-SHARED-CAP-001','DRIVE',1,120,true,'E2E shared vehicle capacity fixture',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "site_id" = EXCLUDED."site_id",
            "label" = EXCLUDED."label",
            "vehicle_code" = EXCLUDED."vehicle_code",
            "travel_mode" = EXCLUDED."travel_mode",
            "max_stops" = EXCLUDED."max_stops",
            "max_route_duration_minutes" = EXCLUDED."max_route_duration_minutes",
            "available" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityVehicle, SCHEDULE_VEHICLE_FIXTURE_IDS.siteId],
    );

    await client.query(
      `
        INSERT INTO "VisitVehicleResource" (
          "id","org_id","site_id","label","vehicle_code","travel_mode","max_stops","max_route_duration_minutes","available","notes","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'E2E受理確認車両','E2E-OK-050','DRIVE',50,360,true,'E2E acceptance constraint fixture',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "site_id" = EXCLUDED."site_id",
            "label" = EXCLUDED."label",
            "vehicle_code" = EXCLUDED."vehicle_code",
            "travel_mode" = EXCLUDED."travel_mode",
            "max_stops" = EXCLUDED."max_stops",
            "max_route_duration_minutes" = EXCLUDED."max_route_duration_minutes",
            "available" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.acceptanceVehicle, SCHEDULE_VEHICLE_FIXTURE_IDS.siteId],
    );

    await client.query(
      `
        INSERT INTO "VisitVehicleResource" (
          "id","org_id","site_id","label","vehicle_code","travel_mode","max_stops","max_route_duration_minutes","available","notes","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'E2E別拠点車両','E2E-SITE-002','DRIVE',6,180,true,'E2E site mismatch fixture',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "site_id" = EXCLUDED."site_id",
            "label" = EXCLUDED."label",
            "vehicle_code" = EXCLUDED."vehicle_code",
            "travel_mode" = EXCLUDED."travel_mode",
            "max_stops" = EXCLUDED."max_stops",
            "max_route_duration_minutes" = EXCLUDED."max_route_duration_minutes",
            "available" = true,
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.otherSiteVehicle, SCHEDULE_VEHICLE_FIXTURE_IDS.otherSite],
    );

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","time_window_start","time_window_end","pharmacist_id","assignment_mode","route_order","vehicle_resource_id","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,'regular','normal','planned',$4,'09:00','10:00',$5,'primary',1,$6,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "schedule_status" = 'planned',
            "scheduled_date" = EXCLUDED."scheduled_date",
            "time_window_start" = EXCLUDED."time_window_start",
            "time_window_end" = EXCLUDED."time_window_end",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "assignment_mode" = EXCLUDED."assignment_mode",
            "route_order" = EXCLUDED."route_order",
            "vehicle_resource_id" = EXCLUDED."vehicle_resource_id",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.existingSchedule,
        SCHEDULE_VEHICLE_FIXTURE_IDS.caseId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.siteId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.rejectionDate,
        SCHEDULE_VEHICLE_FIXTURE_IDS.userId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.capacityVehicle,
      ],
    );

    await client.query(
      `
        INSERT INTO "User" (
          "id","org_id","cognito_sub","email","name","name_kana","default_site_id","max_daily_visits","max_weekly_visits","max_travel_minutes","visit_specialties","can_accept_emergency","is_active","account_status","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os','e2e-shared-vehicle-cognito','e2e-shared-vehicle@ph-os.example.com','E2E共有車両薬剤師','イーツーイーキョウユウ','cmnhseedsite000amq9ph-os',8,40,180,'[]'::jsonb,true,true,'active',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "default_site_id" = EXCLUDED."default_site_id",
            "max_daily_visits" = EXCLUDED."max_daily_visits",
            "max_weekly_visits" = EXCLUDED."max_weekly_visits",
            "max_travel_minutes" = EXCLUDED."max_travel_minutes",
            "visit_specialties" = EXCLUDED."visit_specialties",
            "can_accept_emergency" = true,
            "is_active" = true,
            "account_status" = 'active',
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityUser],
    );

    await client.query(
      `
        INSERT INTO "Membership" (
          "id","org_id","user_id","site_id","role","can_dispense","can_audit_dispense","can_set","can_audit_set","is_active","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'cmnhseedsite000amq9ph-os','pharmacist',true,false,true,false,true,NOW(),NOW())
        ON CONFLICT ("user_id","org_id","site_id") DO UPDATE
        SET "role" = 'pharmacist',
            "can_dispense" = true,
            "can_set" = true,
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityMembership,
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityUser,
      ],
    );

    for (const [shiftId, userId] of [
      [SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityShift, SCHEDULE_VEHICLE_FIXTURE_IDS.userId],
      [
        `${SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityShift}_other`,
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityUser,
      ],
    ] as const) {
      await client.query(
        `
          INSERT INTO "PharmacistShift" (
            "id","org_id","site_id","user_id","date","available","available_from","available_to","note","created_at","updated_at"
          ) VALUES ($1,'cmnhseedorg0000amq9ph-os','cmnhseedsite000amq9ph-os',$2,$3,true,'09:00','18:00','E2E shared vehicle capacity shift',NOW(),NOW())
          ON CONFLICT ("user_id","date") DO UPDATE
          SET "site_id" = 'cmnhseedsite000amq9ph-os',
              "available" = true,
              "available_from" = EXCLUDED."available_from",
              "available_to" = EXCLUDED."available_to",
              "note" = EXCLUDED."note",
              "updated_at" = NOW()
        `,
        [shiftId, userId, SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityDate],
      );
    }

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","time_window_start","time_window_end","pharmacist_id","assignment_mode","route_order","vehicle_resource_id","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,'regular','normal','planned',$4,'09:00','10:00',$5,'fallback',1,$6,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "schedule_status" = 'planned',
            "scheduled_date" = EXCLUDED."scheduled_date",
            "time_window_start" = EXCLUDED."time_window_start",
            "time_window_end" = EXCLUDED."time_window_end",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "assignment_mode" = EXCLUDED."assignment_mode",
            "route_order" = EXCLUDED."route_order",
            "vehicle_resource_id" = EXCLUDED."vehicle_resource_id",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacitySchedule,
        SCHEDULE_VEHICLE_FIXTURE_IDS.caseId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.siteId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityDate,
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityUser,
        SCHEDULE_VEHICLE_FIXTURE_IDS.sharedCapacityVehicle,
      ],
    );

    await client.query(
      `
        INSERT INTO "User" (
          "id","org_id","cognito_sub","email","name","name_kana","default_site_id","max_daily_visits","max_weekly_visits","max_travel_minutes","visit_specialties","can_accept_emergency","is_active","account_status","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os','e2e-substitute-backup-cognito','e2e-substitute-backup@ph-os.example.com','E2E代理薬剤師','イーツーイーダイリ','cmnhseedsite000amq9ph-os',8,40,180,'[]'::jsonb,true,true,'active',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "default_site_id" = EXCLUDED."default_site_id",
            "max_daily_visits" = EXCLUDED."max_daily_visits",
            "max_weekly_visits" = EXCLUDED."max_weekly_visits",
            "max_travel_minutes" = EXCLUDED."max_travel_minutes",
            "visit_specialties" = EXCLUDED."visit_specialties",
            "can_accept_emergency" = true,
            "is_active" = true,
            "account_status" = 'active',
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.substituteBackupUser],
    );

    await client.query(
      `
        INSERT INTO "Membership" (
          "id","org_id","user_id","site_id","role","can_dispense","can_audit_dispense","can_set","can_audit_set","is_active","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'cmnhseedsite000amq9ph-os','pharmacist',true,false,true,false,true,NOW(),NOW())
        ON CONFLICT ("user_id","org_id","site_id") DO UPDATE
        SET "role" = 'pharmacist',
            "can_dispense" = true,
            "can_set" = true,
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteBackupMembership,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteBackupUser,
      ],
    );

    await client.query(
      `
        INSERT INTO "Patient" (
          "id","org_id","name","name_kana","birth_date","gender","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os','代理E2E 患者','ダイリイーツーイー カンジャ','1948-01-01','other',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "name" = EXCLUDED."name",
            "name_kana" = EXCLUDED."name_kana",
            "updated_at" = NOW()
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.substitutePatient],
    );

    await client.query(
      `
        INSERT INTO "Residence" (
          "id","org_id","patient_id","address","lat","lng","is_primary","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'東京都港区代理E2E1-1-1',35.642,139.738,true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "patient_id" = EXCLUDED."patient_id",
            "address" = EXCLUDED."address",
            "lat" = EXCLUDED."lat",
            "lng" = EXCLUDED."lng",
            "is_primary" = true,
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteResidence,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substitutePatient,
      ],
    );

    await client.query(
      `
        INSERT INTO "CareCase" (
          "id","org_id","patient_id","status","referral_date","start_date","primary_pharmacist_id","backup_pharmacist_id","required_visit_support","notes","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'active','2026-01-01','2026-01-01',$3,$4,'{}'::jsonb,'E2E substitute pharmacist case',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "patient_id" = EXCLUDED."patient_id",
            "status" = 'active',
            "primary_pharmacist_id" = EXCLUDED."primary_pharmacist_id",
            "backup_pharmacist_id" = EXCLUDED."backup_pharmacist_id",
            "required_visit_support" = EXCLUDED."required_visit_support",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCase,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substitutePatient,
        SCHEDULE_VEHICLE_FIXTURE_IDS.userId,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteBackupUser,
      ],
    );

    await client.query(
      `
        INSERT INTO "ConsentRecord" (
          "id","org_id","patient_id","case_id","consent_type","method","obtained_date","expiry_date","revoked_date","is_active","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,$3,'visit_medication_management','paper_scan','2026-01-01','2026-12-31',NULL,true,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "patient_id" = EXCLUDED."patient_id",
            "case_id" = EXCLUDED."case_id",
            "expiry_date" = EXCLUDED."expiry_date",
            "revoked_date" = NULL,
            "is_active" = true,
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteConsent,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substitutePatient,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCase,
      ],
    );

    await client.query(
      `
        INSERT INTO "ManagementPlan" (
          "id","org_id","case_id","status","version","title","summary","content","created_by","approved_by","approved_at","effective_from","next_review_date","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os',$2,'approved',992,'E2E代理薬剤師計画書','E2E substitute pharmacist management plan','{"sections":[]}'::jsonb,$3,$3,'2026-01-01','2026-01-01','2026-12-31',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "case_id" = EXCLUDED."case_id",
            "status" = 'approved',
            "version" = EXCLUDED."version",
            "title" = EXCLUDED."title",
            "summary" = EXCLUDED."summary",
            "content" = EXCLUDED."content",
            "created_by" = EXCLUDED."created_by",
            "approved_by" = EXCLUDED."approved_by",
            "approved_at" = EXCLUDED."approved_at",
            "effective_from" = EXCLUDED."effective_from",
            "next_review_date" = EXCLUDED."next_review_date",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteManagementPlan,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCase,
        SCHEDULE_VEHICLE_FIXTURE_IDS.userId,
      ],
    );

    await upsertSchedulableMedicationCycle(client, {
      cycleId: SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCycle,
      intakeId: SCHEDULE_VEHICLE_FIXTURE_IDS.substituteIntake,
      lineId: SCHEDULE_VEHICLE_FIXTURE_IDS.substituteLine,
      caseId: SCHEDULE_VEHICLE_FIXTURE_IDS.substituteCase,
      patientId: SCHEDULE_VEHICLE_FIXTURE_IDS.substitutePatient,
      externalPrescriptionId: 'e2e-substitute-external-prescription-1',
      rxNumber: 'E2E-SUBSTITUTE-RX-001',
      drugName: 'E2E代理薬剤師制約薬',
    });

    await client.query(
      `
        DELETE FROM "PharmacistShift"
        WHERE "org_id" = 'cmnhseedorg0000amq9ph-os'
          AND "user_id" = $1
          AND "date" = $2
      `,
      [SCHEDULE_VEHICLE_FIXTURE_IDS.userId, SCHEDULE_VEHICLE_FIXTURE_IDS.substituteDate],
    );

    await client.query(
      `
        INSERT INTO "PharmacistShift" (
          "id","org_id","site_id","user_id","date","available","available_from","available_to","note","created_at","updated_at"
        ) VALUES ($1,'cmnhseedorg0000amq9ph-os','cmnhseedsite000amq9ph-os',$2,$3,true,'09:00','18:00','E2E substitute backup shift',NOW(),NOW())
        ON CONFLICT ("user_id","date") DO UPDATE
        SET "site_id" = 'cmnhseedsite000amq9ph-os',
            "available" = true,
            "available_from" = EXCLUDED."available_from",
            "available_to" = EXCLUDED."available_to",
            "note" = EXCLUDED."note",
            "updated_at" = NOW()
      `,
      [
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteShift,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteBackupUser,
        SCHEDULE_VEHICLE_FIXTURE_IDS.substituteDate,
      ],
    );
  } finally {
    await client.end();
  }

  return SCHEDULE_VEHICLE_FIXTURE_IDS;
}
