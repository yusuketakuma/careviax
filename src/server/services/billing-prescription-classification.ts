import { Prisma } from '@prisma/client';

export type BillingPrescriptionIntakeClassification = {
  prescription_category: string | null;
  emergency_category: string | null;
};

type BillingPrescriptionIntakeReader = {
  prescriptionIntake: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy: Array<{ created_at: 'desc' }>;
      select: {
        prescription_category: true;
        emergency_category: true;
      };
    }) => Promise<BillingPrescriptionIntakeClassification | null>;
  };
};

type BillingPrescriptionIntakeBatchReader = {
  prescriptionIntake: {
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy: Array<{ created_at: 'desc' }>;
      select: {
        prescription_category: true;
        emergency_category: true;
        cycle: {
          select: {
            case_id: true;
          };
        };
      };
    }) => Promise<
      Array<
        BillingPrescriptionIntakeClassification & {
          cycle: { case_id: string } | null;
        }
      >
    >;
  };
};

export async function findLatestBillingPrescriptionClassification(
  db: BillingPrescriptionIntakeReader,
  args:
    | { orgId: string; caseId: string; cycleId?: never }
    | { orgId: string; cycleId: string; caseId?: never },
): Promise<BillingPrescriptionIntakeClassification | null> {
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
      return null;
    }
    throw error;
  }
}

export async function findLatestBillingPrescriptionClassificationsByCaseIds(
  db: BillingPrescriptionIntakeBatchReader,
  args: { orgId: string; caseIds: string[] },
): Promise<Map<string, BillingPrescriptionIntakeClassification | null>> {
  const caseIds = [...new Set(args.caseIds.filter(Boolean))];
  const latestByCaseId = new Map<string, BillingPrescriptionIntakeClassification | null>(
    caseIds.map((caseId) => [caseId, null]),
  );
  if (caseIds.length === 0) return latestByCaseId;

  try {
    const rows = await db.prescriptionIntake.findMany({
      where: {
        org_id: args.orgId,
        cycle: {
          case_id: { in: caseIds },
        },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        prescription_category: true,
        emergency_category: true,
        cycle: {
          select: {
            case_id: true,
          },
        },
      },
    });

    for (const row of rows) {
      const caseId = row.cycle?.case_id;
      if (!caseId || latestByCaseId.get(caseId) !== null) continue;
      latestByCaseId.set(caseId, {
        prescription_category: row.prescription_category,
        emergency_category: row.emergency_category,
      });
    }

    return latestByCaseId;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
      return latestByCaseId;
    }
    throw error;
  }
}
