import type { Prisma } from '@prisma/client';
import type { MedicationDiffLine } from '@/lib/prescription/medication-diff';

type PrescriptionIntakeReader = {
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findFirst'>;
};

export type PrescriptionIntakeDiffLine = MedicationDiffLine & {
  id: string;
  drug_master_id: string | null;
  drug_code: string | null;
  days: number | null;
  start_date: Date | null;
  end_date: Date | null;
};

export type PrescriptionIntakeForDiff = {
  id: string;
  prescribed_date: Date;
  created_at: Date;
  lines: PrescriptionIntakeDiffLine[];
};

const PRESCRIPTION_INTAKE_DIFF_LINE_SELECT = {
  id: true,
  drug_name: true,
  drug_master_id: true,
  drug_code: true,
  dose: true,
  frequency: true,
  days: true,
  start_date: true,
  end_date: true,
} satisfies Prisma.PrescriptionLineSelect;

export async function findPreviousPrescriptionIntakeForMedicationDiff(
  db: PrescriptionIntakeReader,
  args: {
    orgId: string;
    patientId: string;
    caseId: string;
    currentIntakeId: string;
    currentPrescribedDate: Date;
    currentCreatedAt: Date;
  },
): Promise<PrescriptionIntakeForDiff | null> {
  const previous = await db.prescriptionIntake.findFirst({
    where: {
      org_id: args.orgId,
      id: { not: args.currentIntakeId },
      cycle: {
        patient_id: args.patientId,
        case_id: args.caseId,
      },
      OR: [
        { prescribed_date: { lt: args.currentPrescribedDate } },
        {
          prescribed_date: args.currentPrescribedDate,
          created_at: { lt: args.currentCreatedAt },
        },
      ],
    },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      prescribed_date: true,
      created_at: true,
      lines: {
        orderBy: { line_number: 'asc' },
        select: PRESCRIPTION_INTAKE_DIFF_LINE_SELECT,
      },
    },
  });
  return previous as PrescriptionIntakeForDiff | null;
}

export async function findCurrentAndPreviousPrescriptionIntakesForMedicationDiff(
  db: PrescriptionIntakeReader,
  args: {
    orgId: string;
    patientId: string;
    currentIntakeId: string;
  },
): Promise<{
  current: (PrescriptionIntakeForDiff & { cycle: { case_id: string } }) | null;
  previous: PrescriptionIntakeForDiff | null;
}> {
  const current = (await db.prescriptionIntake.findFirst({
    where: {
      id: args.currentIntakeId,
      org_id: args.orgId,
      cycle: {
        patient_id: args.patientId,
      },
    },
    select: {
      id: true,
      prescribed_date: true,
      created_at: true,
      cycle: {
        select: {
          case_id: true,
        },
      },
      lines: {
        orderBy: { line_number: 'asc' },
        select: PRESCRIPTION_INTAKE_DIFF_LINE_SELECT,
      },
    },
  })) as (PrescriptionIntakeForDiff & { cycle: { case_id: string } }) | null;

  if (!current) return { current: null, previous: null };

  const previous = await findPreviousPrescriptionIntakeForMedicationDiff(db, {
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: current.cycle.case_id,
    currentIntakeId: current.id,
    currentPrescribedDate: current.prescribed_date,
    currentCreatedAt: current.created_at,
  });

  return { current, previous };
}
