import { Client } from 'pg';

const DB_CONNECTION_STRING = (
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public'
).replace(/\?.*$/, '');

export const GROUPED_VISIT_IDS = {
  facility: 'e2e_grouped_facility',
  facilityUnit: 'e2e_grouped_facility_unit',
  facilityBatch: 'e2e_grouped_facility_batch',
  facilityPatients: ['e2e_grouped_facility_patient_1', 'e2e_grouped_facility_patient_2'],
  facilityCases: ['e2e_grouped_facility_case_1', 'e2e_grouped_facility_case_2'],
  facilityResidences: ['e2e_grouped_facility_residence_1', 'e2e_grouped_facility_residence_2'],
  facilitySchedules: ['e2e_grouped_facility_schedule_1', 'e2e_grouped_facility_schedule_2'],
  confirmedActionSchedule: 'e2e_confirmed_action_schedule',
  homePatients: ['e2e_grouped_home_patient_1', 'e2e_grouped_home_patient_2'],
  homeCases: ['e2e_grouped_home_case_1', 'e2e_grouped_home_case_2'],
  homeResidences: ['e2e_grouped_home_residence_1', 'e2e_grouped_home_residence_2'],
  homeSchedules: ['e2e_grouped_home_schedule_1', 'e2e_grouped_home_schedule_2'],
} as const;

function assertSafeE2eDatabase() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error('Grouped visit fixtures require PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1');
  }

  const url = new URL(DB_CONNECTION_STRING);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!allowedHosts.has(url.hostname) || databaseName !== 'ph_os_e2e') {
    throw new Error('Grouped visit fixtures can only run against local ph_os_e2e');
  }
}

export async function ensureGroupedVisitFixtures() {
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
    if (!base) throw new Error('Grouped visit fixture requires the local auth user');

    const siteId =
      base.site_id ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM "PharmacySite" WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [base.org_id],
        )
      ).rows[0]?.id;
    if (!siteId) throw new Error('Grouped visit fixture requires a pharmacy site');

    await client.query(
      `
        INSERT INTO "Facility" (
          "id","org_id","name","facility_type","address","notes","created_at","updated_at"
        ) VALUES ($1,$2,'青空ホームE2E','group_home','東京都港区施設1-1-1','受付で入館証を受け取り、2Fスタッフへ声かけ',NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "name" = EXCLUDED."name",
            "facility_type" = EXCLUDED."facility_type",
            "address" = EXCLUDED."address",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [GROUPED_VISIT_IDS.facility, base.org_id],
    );
    await client.query(
      `
        INSERT INTO "FacilityUnit" (
          "id","org_id","facility_id","name","floor","unit_type","display_order","created_at","updated_at"
        ) VALUES ($1,$2,$3,'2F東ユニット','2F','unit',1,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "facility_id" = EXCLUDED."facility_id",
            "name" = EXCLUDED."name",
            "floor" = EXCLUDED."floor",
            "unit_type" = EXCLUDED."unit_type",
            "display_order" = EXCLUDED."display_order",
            "updated_at" = NOW()
      `,
      [GROUPED_VISIT_IDS.facilityUnit, base.org_id, GROUPED_VISIT_IDS.facility],
    );

    const facilityPatientRows = [
      [GROUPED_VISIT_IDS.facilityPatients[0], '施設E2E 太郎', 'シセツイーツーイー タロウ'],
      [GROUPED_VISIT_IDS.facilityPatients[1], '施設E2E 花子', 'シセツイーツーイー ハナコ'],
    ];
    const homePatientRows = [
      [GROUPED_VISIT_IDS.homePatients[0], '山田E2E 太郎', 'ヤマダイーツーイー タロウ'],
      [GROUPED_VISIT_IDS.homePatients[1], '山田E2E 花子', 'ヤマダイーツーイー ハナコ'],
    ];

    for (const [patientId, name, kana] of [...facilityPatientRows, ...homePatientRows]) {
      await client.query(
        `
          INSERT INTO "Patient" (
            "id","org_id","name","name_kana","birth_date","gender","created_at","updated_at"
          ) VALUES ($1,$2,$3,$4,'1945-01-01','other',NOW(),NOW())
          ON CONFLICT ("id") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "name" = EXCLUDED."name",
              "name_kana" = EXCLUDED."name_kana",
              "updated_at" = NOW()
        `,
        [patientId, base.org_id, name, kana],
      );
    }

    const allCases = [
      ...GROUPED_VISIT_IDS.facilityCases.map((caseId, index) => [
        caseId,
        GROUPED_VISIT_IDS.facilityPatients[index],
      ]),
      ...GROUPED_VISIT_IDS.homeCases.map((caseId, index) => [
        caseId,
        GROUPED_VISIT_IDS.homePatients[index],
      ]),
    ];
    for (const [caseId, patientId] of allCases) {
      await client.query(
        `
          INSERT INTO "CareCase" (
            "id","org_id","patient_id","status","referral_date","start_date","primary_pharmacist_id","required_visit_support","notes","created_at","updated_at"
          ) VALUES ($1,$2,$3,'active',CURRENT_DATE,CURRENT_DATE,$4,'{}'::jsonb,'E2E grouped visit case',NOW(),NOW())
          ON CONFLICT ("id") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "patient_id" = EXCLUDED."patient_id",
              "status" = 'active',
              "primary_pharmacist_id" = EXCLUDED."primary_pharmacist_id",
              "required_visit_support" = EXCLUDED."required_visit_support",
              "notes" = EXCLUDED."notes",
              "updated_at" = NOW()
        `,
        [caseId, base.org_id, patientId, base.user_id],
      );
    }

    for (const [index, residenceId] of GROUPED_VISIT_IDS.facilityResidences.entries()) {
      await client.query(
        `
          INSERT INTO "Residence" (
            "id","org_id","patient_id","address","building_id","facility_id","facility_unit_id","unit_name","is_primary","created_at","updated_at"
          ) VALUES ($1,$2,$3,'東京都港区施設1-1-1','青空ホームE2E',$4,$5,$6,true,NOW(),NOW())
          ON CONFLICT ("id") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "patient_id" = EXCLUDED."patient_id",
              "address" = EXCLUDED."address",
              "building_id" = EXCLUDED."building_id",
              "facility_id" = EXCLUDED."facility_id",
              "facility_unit_id" = EXCLUDED."facility_unit_id",
              "unit_name" = EXCLUDED."unit_name",
              "is_primary" = true,
              "updated_at" = NOW()
        `,
        [
          residenceId,
          base.org_id,
          GROUPED_VISIT_IDS.facilityPatients[index],
          GROUPED_VISIT_IDS.facility,
          GROUPED_VISIT_IDS.facilityUnit,
          `${201 + index}号室`,
        ],
      );
    }

    for (const [index, residenceId] of GROUPED_VISIT_IDS.homeResidences.entries()) {
      await client.query(
        `
          INSERT INTO "Residence" (
            "id","org_id","patient_id","address","building_id","unit_name","is_primary","created_at","updated_at"
          ) VALUES ($1,$2,$3,'東京都港区個人宅E2E1-1-1','山田宅E2E',NULL,true,NOW(),NOW())
          ON CONFLICT ("id") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "patient_id" = EXCLUDED."patient_id",
              "address" = EXCLUDED."address",
              "building_id" = EXCLUDED."building_id",
              "unit_name" = NULL,
              "is_primary" = true,
              "updated_at" = NOW()
        `,
        [residenceId, base.org_id, GROUPED_VISIT_IDS.homePatients[index]],
      );
    }

    await client.query(
      `
        INSERT INTO "FacilityVisitBatch" (
          "id","org_id","facility_id","facility_unit_id","scheduled_date","pharmacist_id","patient_ids","notes","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'2026-04-25',$5,$6::jsonb,$7,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "facility_id" = EXCLUDED."facility_id",
            "facility_unit_id" = EXCLUDED."facility_unit_id",
            "scheduled_date" = EXCLUDED."scheduled_date",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "patient_ids" = EXCLUDED."patient_ids",
            "notes" = EXCLUDED."notes",
            "updated_at" = NOW()
      `,
      [
        GROUPED_VISIT_IDS.facilityBatch,
        base.org_id,
        GROUPED_VISIT_IDS.facility,
        GROUPED_VISIT_IDS.facilityUnit,
        base.user_id,
        JSON.stringify(GROUPED_VISIT_IDS.facilityPatients),
        '受付で入館証を受け取り、2Fスタッフへ声かけ',
      ],
    );

    const schedules = [
      ...GROUPED_VISIT_IDS.facilitySchedules.map((scheduleId, index) => ({
        scheduleId,
        caseId: GROUPED_VISIT_IDS.facilityCases[index],
        batchId: GROUPED_VISIT_IDS.facilityBatch,
        unitId: GROUPED_VISIT_IDS.facilityUnit,
        routeOrder: index + 1,
      })),
      ...GROUPED_VISIT_IDS.homeSchedules.map((scheduleId, index) => ({
        scheduleId,
        caseId: GROUPED_VISIT_IDS.homeCases[index],
        batchId: null,
        unitId: null,
        routeOrder: index + 11,
      })),
    ];
    for (const item of schedules) {
      await client.query(
        `
          INSERT INTO "VisitSchedule" (
            "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","time_window_start","time_window_end","pharmacist_id","assignment_mode","route_order","facility_batch_id","facility_unit_id","medication_start_date","medication_end_date","confirmed_at","confirmed_by","carry_items_status","created_at","updated_at"
          ) VALUES ($1,$2,$3,$4,'regular','normal','ready','2026-04-25','09:00','10:00',$5,'primary',$6,$7,$8,'2026-04-25','2026-05-08','2026-04-24T01:00:00Z',$5,'ready',NOW(),NOW())
          ON CONFLICT ("id") DO UPDATE
          SET "org_id" = EXCLUDED."org_id",
              "case_id" = EXCLUDED."case_id",
              "site_id" = EXCLUDED."site_id",
              "schedule_status" = 'ready',
              "scheduled_date" = EXCLUDED."scheduled_date",
              "time_window_start" = EXCLUDED."time_window_start",
              "time_window_end" = EXCLUDED."time_window_end",
              "pharmacist_id" = EXCLUDED."pharmacist_id",
              "assignment_mode" = EXCLUDED."assignment_mode",
              "route_order" = EXCLUDED."route_order",
              "facility_batch_id" = EXCLUDED."facility_batch_id",
              "facility_unit_id" = EXCLUDED."facility_unit_id",
              "medication_start_date" = EXCLUDED."medication_start_date",
              "medication_end_date" = EXCLUDED."medication_end_date",
              "confirmed_at" = EXCLUDED."confirmed_at",
              "confirmed_by" = EXCLUDED."confirmed_by",
              "carry_items_status" = EXCLUDED."carry_items_status",
              "updated_at" = NOW()
        `,
        [
          item.scheduleId,
          base.org_id,
          item.caseId,
          siteId,
          base.user_id,
          item.routeOrder,
          item.batchId,
          item.unitId,
        ],
      );
      await client.query(
        `
          INSERT INTO "VisitPreparation" (
            "id","org_id","schedule_id","checklist","medication_changes_reviewed","carry_items_confirmed","previous_issues_reviewed","route_confirmed","offline_synced","prepared_by","prepared_at","created_at","updated_at"
          ) VALUES ($1,$2,$3,'{}'::jsonb,true,true,$4,true,true,$5,$6,NOW(),NOW())
          ON CONFLICT ("schedule_id") DO UPDATE
          SET "checklist" = EXCLUDED."checklist",
              "medication_changes_reviewed" = EXCLUDED."medication_changes_reviewed",
              "carry_items_confirmed" = EXCLUDED."carry_items_confirmed",
              "previous_issues_reviewed" = EXCLUDED."previous_issues_reviewed",
              "route_confirmed" = EXCLUDED."route_confirmed",
              "offline_synced" = EXCLUDED."offline_synced",
              "prepared_by" = EXCLUDED."prepared_by",
              "prepared_at" = EXCLUDED."prepared_at",
              "updated_at" = NOW()
        `,
        [
          `prep_${item.scheduleId}`,
          base.org_id,
          item.scheduleId,
          item.routeOrder === 1,
          base.user_id,
          item.routeOrder === 1 ? new Date('2026-04-24T10:00:00Z') : null,
        ],
      );
    }

    return GROUPED_VISIT_IDS;
  } finally {
    await client.end();
  }
}

type ConfirmedScheduleActionFixtureOptions = {
  carryItemsStatus?: 'ready' | 'partial' | 'blocked';
  carryItemsConfirmed?: boolean;
};

export async function ensureConfirmedScheduleActionFixture(
  scheduledDate: string,
  options: ConfirmedScheduleActionFixtureOptions = {},
) {
  await ensureGroupedVisitFixtures();
  const carryItemsStatus = options.carryItemsStatus ?? 'ready';
  const carryItemsConfirmed = options.carryItemsConfirmed ?? true;

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
    if (!base) throw new Error('Confirmed schedule action fixture requires the local auth user');

    const siteId =
      base.site_id ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM "PharmacySite" WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [base.org_id],
        )
      ).rows[0]?.id;
    if (!siteId) throw new Error('Confirmed schedule action fixture requires a pharmacy site');

    await client.query(
      `
        INSERT INTO "VisitSchedule" (
          "id","org_id","case_id","site_id","visit_type","priority","schedule_status","scheduled_date","time_window_start","time_window_end","pharmacist_id","assignment_mode","route_order","facility_batch_id","facility_unit_id","medication_start_date","medication_end_date","confirmed_at","confirmed_by","carry_items_status","created_at","updated_at"
        ) VALUES ($1,$2,$3,$4,'regular','normal','ready',$5,'09:00','10:00',$6,'primary',91,$7,$8,$5,$5,NOW(),$6,$9,NOW(),NOW())
        ON CONFLICT ("id") DO UPDATE
        SET "org_id" = EXCLUDED."org_id",
            "case_id" = EXCLUDED."case_id",
            "site_id" = EXCLUDED."site_id",
            "visit_type" = EXCLUDED."visit_type",
            "priority" = EXCLUDED."priority",
            "schedule_status" = 'ready',
            "scheduled_date" = EXCLUDED."scheduled_date",
            "time_window_start" = EXCLUDED."time_window_start",
            "time_window_end" = EXCLUDED."time_window_end",
            "pharmacist_id" = EXCLUDED."pharmacist_id",
            "assignment_mode" = EXCLUDED."assignment_mode",
            "route_order" = EXCLUDED."route_order",
            "facility_batch_id" = EXCLUDED."facility_batch_id",
            "facility_unit_id" = EXCLUDED."facility_unit_id",
            "medication_start_date" = EXCLUDED."medication_start_date",
            "medication_end_date" = EXCLUDED."medication_end_date",
            "confirmed_at" = EXCLUDED."confirmed_at",
            "confirmed_by" = EXCLUDED."confirmed_by",
            "carry_items_status" = EXCLUDED."carry_items_status",
            "updated_at" = NOW()
      `,
      [
        GROUPED_VISIT_IDS.confirmedActionSchedule,
        base.org_id,
        GROUPED_VISIT_IDS.facilityCases[0],
        siteId,
        scheduledDate,
        base.user_id,
        GROUPED_VISIT_IDS.facilityBatch,
        GROUPED_VISIT_IDS.facilityUnit,
        carryItemsStatus,
      ],
    );
    await client.query(
      `
        INSERT INTO "VisitPreparation" (
          "id","org_id","schedule_id","checklist","medication_changes_reviewed","carry_items_confirmed","previous_issues_reviewed","route_confirmed","offline_synced","prepared_by","prepared_at","created_at","updated_at"
        ) VALUES ($1,$2,$3,'{}'::jsonb,true,$5,true,true,true,$4,NOW(),NOW(),NOW())
        ON CONFLICT ("schedule_id") DO UPDATE
        SET "checklist" = EXCLUDED."checklist",
            "medication_changes_reviewed" = true,
            "carry_items_confirmed" = EXCLUDED."carry_items_confirmed",
            "previous_issues_reviewed" = true,
            "route_confirmed" = true,
            "offline_synced" = true,
            "prepared_by" = EXCLUDED."prepared_by",
            "prepared_at" = EXCLUDED."prepared_at",
            "updated_at" = NOW()
      `,
      [
        `prep_${GROUPED_VISIT_IDS.confirmedActionSchedule}`,
        base.org_id,
        GROUPED_VISIT_IDS.confirmedActionSchedule,
        base.user_id,
        carryItemsConfirmed,
      ],
    );

    return {
      scheduleId: GROUPED_VISIT_IDS.confirmedActionSchedule,
      scheduledDate,
    };
  } finally {
    await client.end();
  }
}
