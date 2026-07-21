import type { Prisma } from '@prisma/client';

import {
  buildPatientOperationalInsuranceRelation,
  buildPatientOperationalLabRelation,
} from '@/lib/db/patient-operational-summary-select';

const scheduleSelect = {
  id: true,
  display_id: true,
  case_id: true,
  cycle_id: true,
  pharmacist_id: true,
  visit_type: true,
  schedule_status: true,
  scheduled_date: true,
  carry_items_status: true,
  priority: true,
  site_id: true,
  route_order: true,
  vehicle_resource_id: true,
  time_window_start: true,
  time_window_end: true,
  confirmed_at: true,
  facility_batch_id: true,
} as const satisfies Prisma.VisitScheduleSelect;

type ScheduleRow = Prisma.VisitScheduleGetPayload<{ select: typeof scheduleSelect }>;

type DayBoardScheduleLoaderDb = Pick<
  Prisma.TransactionClient,
  | 'careCase'
  | 'careTeamLink'
  | 'contactParty'
  | 'facilityVisitBatch'
  | 'medicationCycle'
  | 'patient'
  | 'residence'
  | 'visitPreparation'
  | 'visitRecord'
  | 'visitSchedule'
  | 'visitVehicleResource'
>;

async function loadSchedulePages(
  db: DayBoardScheduleLoaderDb,
  args: {
    orgId: string;
    dayStart: Date;
    dayEnd: Date;
    pageSize: number;
    maxPages: number;
  },
) {
  const rows: ScheduleRow[] = [];
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < args.maxPages; pageNumber += 1) {
    const page = await db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        scheduled_date: { gte: args.dayStart, lt: args.dayEnd },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }, { id: 'asc' }],
      take: args.pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: scheduleSelect,
    });
    rows.push(...page);
    if (page.length < args.pageSize) return rows;

    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error('Day-board schedule cursor pagination did not advance');
    }
    cursor = nextCursor;
  }

  throw new Error('Day-board schedule bounded scan limit exceeded');
}

export async function loadDayBoardSchedules(
  db: DayBoardScheduleLoaderDb,
  args: {
    orgId: string;
    dayStart: Date;
    dayEnd: Date;
    pageSize: number;
    maxPages: number;
  },
) {
  const scheduleRows = await loadSchedulePages(db, args);
  if (scheduleRows.length === 0) return [];

  const scheduleIds = scheduleRows.map((row) => row.id);
  const cycleIds = Array.from(
    new Set(scheduleRows.flatMap((row) => (row.cycle_id ? [row.cycle_id] : []))),
  );
  const facilityBatchIds = Array.from(
    new Set(scheduleRows.flatMap((row) => (row.facility_batch_id ? [row.facility_batch_id] : []))),
  );
  const caseIds = Array.from(new Set(scheduleRows.map((row) => row.case_id)));
  const vehicleIds = Array.from(
    new Set(
      scheduleRows.flatMap((row) => (row.vehicle_resource_id ? [row.vehicle_resource_id] : [])),
    ),
  );

  const cycles =
    cycleIds.length === 0
      ? []
      : await db.medicationCycle.findMany({
          where: { org_id: args.orgId, id: { in: cycleIds } },
          select: { id: true, overall_status: true },
        });
  const preparations = await db.visitPreparation.findMany({
    where: { org_id: args.orgId, schedule_id: { in: scheduleIds } },
    select: {
      schedule_id: true,
      org_id: true,
      prepared_at: true,
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
    },
  });
  const facilityBatches =
    facilityBatchIds.length === 0
      ? []
      : await db.facilityVisitBatch.findMany({
          where: { org_id: args.orgId, id: { in: facilityBatchIds } },
          select: { id: true, facility_id: true },
        });
  const visitRecords = await db.visitRecord.findMany({
    where: { org_id: args.orgId, schedule_id: { in: scheduleIds } },
    select: { id: true, schedule_id: true },
  });
  const careCases = await db.careCase.findMany({
    where: { org_id: args.orgId, id: { in: caseIds } },
    select: { id: true, display_id: true, patient_id: true },
  });
  const careTeamLinks = await db.careTeamLink.findMany({
    where: { org_id: args.orgId, case_id: { in: caseIds } },
    select: { case_id: true, role: true },
  });
  const patientIds = Array.from(new Set(careCases.map((careCase) => careCase.patient_id)));
  const patients = await db.patient.findMany({
    where: { org_id: args.orgId, id: { in: patientIds } },
    select: {
      id: true,
      display_id: true,
      name: true,
      archived_at: true,
      allergy_info: true,
    },
  });
  const patientInsuranceRows = await db.patient.findMany({
    where: { org_id: args.orgId, id: { in: patientIds } },
    select: {
      id: true,
      insurances: buildPatientOperationalInsuranceRelation(args.orgId),
    },
  });
  const patientLabRows = await db.patient.findMany({
    where: { org_id: args.orgId, id: { in: patientIds } },
    select: {
      id: true,
      lab_observations: buildPatientOperationalLabRelation(args.orgId),
    },
  });
  const contacts = await db.contactParty.findMany({
    where: {
      org_id: args.orgId,
      patient_id: { in: patientIds },
      is_emergency_contact: true,
    },
    select: { id: true, patient_id: true },
  });
  const patientResidenceRows = await db.patient.findMany({
    where: { org_id: args.orgId, id: { in: patientIds } },
    select: {
      id: true,
      residences: {
        where: { org_id: args.orgId, is_primary: true },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { address: true, lat: true, lng: true },
      },
    },
  });
  const vehicles =
    vehicleIds.length === 0
      ? []
      : await db.visitVehicleResource.findMany({
          where: { org_id: args.orgId, id: { in: vehicleIds } },
          select: { id: true, label: true, travel_mode: true },
        });

  const cycleById = new Map(cycles.map((row) => [row.id, row]));
  const preparationByScheduleId = new Map(preparations.map((row) => [row.schedule_id, row]));
  const facilityBatchById = new Map(facilityBatches.map((row) => [row.id, row]));
  const visitRecordByScheduleId = new Map(visitRecords.map((row) => [row.schedule_id, row]));
  const careCaseById = new Map(careCases.map((row) => [row.id, row]));
  const patientById = new Map(patients.map((row) => [row.id, row]));
  const insuranceByPatientId = new Map(patientInsuranceRows.map((row) => [row.id, row.insurances]));
  const labsByPatientId = new Map(patientLabRows.map((row) => [row.id, row.lab_observations]));
  const residencesByPatientId = new Map(
    patientResidenceRows.map((row) => [row.id, row.residences]),
  );
  const vehicleById = new Map(vehicles.map((row) => [row.id, row]));
  const contactsByPatientId = new Map<string, Array<{ id: string }>>();
  for (const contact of contacts) {
    const patientContacts = contactsByPatientId.get(contact.patient_id) ?? [];
    patientContacts.push({ id: contact.id });
    contactsByPatientId.set(contact.patient_id, patientContacts);
  }
  const careTeamLinksByCaseId = new Map<string, Array<{ role: string }>>();
  for (const link of careTeamLinks) {
    const caseLinks = careTeamLinksByCaseId.get(link.case_id) ?? [];
    caseLinks.push({ role: link.role });
    careTeamLinksByCaseId.set(link.case_id, caseLinks);
  }

  return scheduleRows.map((schedule) => {
    const careCase = careCaseById.get(schedule.case_id);
    const patient = careCase ? patientById.get(careCase.patient_id) : undefined;
    if (!careCase || !patient) {
      throw new Error('Day-board schedule relation integrity check failed');
    }

    return {
      ...schedule,
      cycle: schedule.cycle_id ? (cycleById.get(schedule.cycle_id) ?? null) : null,
      preparation: preparationByScheduleId.get(schedule.id) ?? null,
      facility_batch: schedule.facility_batch_id
        ? (facilityBatchById.get(schedule.facility_batch_id) ?? null)
        : null,
      visit_record: visitRecordByScheduleId.get(schedule.id) ?? null,
      vehicle_resource: schedule.vehicle_resource_id
        ? (vehicleById.get(schedule.vehicle_resource_id) ?? null)
        : null,
      case_: {
        display_id: careCase.display_id,
        care_team_links: careTeamLinksByCaseId.get(careCase.id) ?? [],
        patient: {
          ...patient,
          insurances: insuranceByPatientId.get(patient.id) ?? [],
          lab_observations: labsByPatientId.get(patient.id) ?? [],
          contacts: contactsByPatientId.get(patient.id) ?? [],
          residences: residencesByPatientId.get(patient.id) ?? [],
        },
      },
    };
  });
}
