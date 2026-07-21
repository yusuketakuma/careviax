import type { PrescriptionSourceType } from '@prisma/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import {
  buildMedicationCycleAssignmentWhere,
  type PrescriptionAccessContext,
} from '@/server/services/prescription-access';
import type { Tx } from './prescription-intake-contract';

export type LoadedCycleContext = {
  id: string;
  patient_id: string;
  case_id: string | null;
  overall_status: string;
  version: number;
  primary_pharmacist_id: string | null;
  prescription_intakes: Array<{
    id: string;
    source_type: PrescriptionSourceType;
    prescribed_date: Date;
    refill_remaining_count: number | null;
    refill_next_dispense_date: Date | null;
    lines: Array<{ days: number }>;
  }>;
  dispense_tasks: Array<{
    results: Array<{ dispensed_at: Date }>;
  }>;
};

export type LoadedCareCaseContext = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
};

export type PrescriptionIntakeTargetContext =
  | { kind: 'cycle'; cycle: LoadedCycleContext }
  | { kind: 'case'; careCase: LoadedCareCaseContext };

export async function createMedicationCycleContext(
  tx: Tx,
  args: { orgId: string; careCase: LoadedCareCaseContext },
): Promise<LoadedCycleContext> {
  const createdCycle = await tx.medicationCycle.create({
    data: {
      org_id: args.orgId,
      case_id: args.careCase.id,
      patient_id: args.careCase.patient_id,
      overall_status: 'intake_received',
      version: 1,
    },
  });

  return {
    id: createdCycle.id,
    patient_id: createdCycle.patient_id,
    case_id: createdCycle.case_id,
    overall_status: createdCycle.overall_status,
    version: createdCycle.version,
    primary_pharmacist_id: args.careCase.primary_pharmacist_id ?? null,
    prescription_intakes: [],
    dispense_tasks: [],
  };
}

export async function loadPrescriptionIntakeTargetContext(
  tx: Tx,
  args: {
    orgId: string;
    cycleId?: string;
    caseId?: string;
    patientId?: string;
    accessContext?: PrescriptionAccessContext;
  },
): Promise<PrescriptionIntakeTargetContext | null> {
  if (args.cycleId) {
    const assignmentWhere = args.accessContext
      ? buildMedicationCycleAssignmentWhere(args.accessContext)
      : null;
    return tx.medicationCycle
      .findFirst({
        where: {
          id: args.cycleId,
          org_id: args.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          overall_status: true,
          version: true,
          case_: {
            select: {
              primary_pharmacist_id: true,
            },
          },
          prescription_intakes: {
            orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
            take: 1,
            select: {
              id: true,
              source_type: true,
              prescribed_date: true,
              refill_remaining_count: true,
              refill_next_dispense_date: true,
              lines: {
                select: {
                  days: true,
                },
              },
            },
          },
          dispense_tasks: {
            orderBy: [{ updated_at: 'desc' }],
            take: 5,
            select: {
              results: {
                orderBy: [{ dispensed_at: 'desc' }],
                take: 1,
                select: {
                  dispensed_at: true,
                },
              },
            },
          },
        },
      })
      .then((cycle) =>
        cycle
          ? {
              ...cycle,
              primary_pharmacist_id: cycle.case_?.primary_pharmacist_id ?? null,
            }
          : null,
      )
      .then((cycle) => (cycle ? { kind: 'cycle' as const, cycle } : null));
  }

  if (!args.caseId || !args.patientId) {
    return null;
  }

  const caseAssignmentWhere = args.accessContext
    ? buildCareCaseAssignmentWhere(args.accessContext)
    : null;
  const careCase = await tx.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: {
      id: true,
      patient_id: true,
      primary_pharmacist_id: true,
    },
  });
  if (!careCase) return null;

  return {
    kind: 'case',
    careCase: {
      id: careCase.id,
      patient_id: careCase.patient_id,
      primary_pharmacist_id: careCase.primary_pharmacist_id ?? null,
    },
  };
}
