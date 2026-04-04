import { Prisma } from '@prisma/client';

export type PrescriptionIntakeClassification = {
  prescription_category: string | null;
  emergency_category: string | null;
};

type PrescriptionIntakeReader = {
  prescriptionIntake: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy: Array<{ created_at: 'desc' }>;
      select: {
        prescription_category: true;
        emergency_category: true;
      };
    }) => Promise<PrescriptionIntakeClassification | null>;
  };
};

export async function findLatestPrescriptionIntakeClassification(
  db: PrescriptionIntakeReader,
  args:
    | { orgId: string; caseId: string; cycleId?: never }
    | { orgId: string; cycleId: string; caseId?: never }
): Promise<PrescriptionIntakeClassification | null> {
  try {
    return await db.prescriptionIntake.findFirst({
      where: {
        org_id: args.orgId,
        ...(args.caseId ? { cycle: { case_id: args.caseId } } : {}),
        ...(args.cycleId ? { cycle_id: args.cycleId } : {}),
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        prescription_category: true,
        emergency_category: true,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2022'
    ) {
      return null;
    }
    throw error;
  }
}
