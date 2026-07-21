import type { Prisma } from '@prisma/client';

import {
  buildPatientOperationalInsuranceRelation,
  buildPatientOperationalLabRelation,
} from '@/lib/db/patient-operational-summary-select';

const proposalSelect = {
  id: true,
  display_id: true,
  case_id: true,
  visit_type: true,
  proposal_status: true,
  patient_contact_status: true,
  proposed_date: true,
  time_window_start: true,
  time_window_end: true,
  proposed_pharmacist_id: true,
} as const satisfies Prisma.VisitScheduleProposalSelect;

type DayBoardProposalLoaderDb = Pick<
  Prisma.TransactionClient,
  'careCase' | 'patient' | 'visitScheduleProposal'
>;

export async function loadDayBoardProposals(
  db: DayBoardProposalLoaderDb,
  args: {
    orgId: string;
    where: Prisma.VisitScheduleProposalWhereInput;
    limit: number;
  },
) {
  const proposalRows = await db.visitScheduleProposal.findMany({
    where: args.where,
    orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }, { id: 'asc' }],
    take: args.limit,
    select: proposalSelect,
  });
  if (proposalRows.length === 0) return [];

  const caseIds = Array.from(new Set(proposalRows.map((proposal) => proposal.case_id)));
  const careCases = await db.careCase.findMany({
    where: { org_id: args.orgId, id: { in: caseIds } },
    select: { id: true, display_id: true, patient_id: true },
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

  const careCaseById = new Map(careCases.map((careCase) => [careCase.id, careCase]));
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const insuranceByPatientId = new Map(
    patientInsuranceRows.map((patient) => [patient.id, patient.insurances]),
  );
  const labsByPatientId = new Map(
    patientLabRows.map((patient) => [patient.id, patient.lab_observations]),
  );

  return proposalRows.map((proposal) => {
    const careCase = careCaseById.get(proposal.case_id);
    const patient = careCase ? patientById.get(careCase.patient_id) : undefined;
    if (!careCase || !patient) {
      throw new Error('Day-board proposal relation integrity check failed');
    }
    return {
      ...proposal,
      case_: {
        display_id: careCase.display_id,
        patient: {
          ...patient,
          insurances: insuranceByPatientId.get(patient.id) ?? [],
          lab_observations: labsByPatientId.get(patient.id) ?? [],
        },
      },
    };
  });
}
