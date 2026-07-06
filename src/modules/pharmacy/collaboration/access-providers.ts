import type { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import type { CollaborationAccessProvider } from '@/core/collaboration/registry';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';

type PharmacyCollaborationAccessDb = {
  dispenseTask: {
    findFirst(args: {
      where: Prisma.DispenseTaskWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  medicationCycle: {
    findFirst(args: {
      where: Prisma.MedicationCycleWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  setPlan: {
    findFirst(args: {
      where: Prisma.SetPlanWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

export type PharmacyCollaborationEntityType = 'dispense_task' | 'medication_cycle' | 'set_plan';
export type PharmacyCollaborationAccessProvider = CollaborationAccessProvider<
  AuthContext,
  PharmacyCollaborationAccessDb,
  PharmacyCollaborationEntityType
>;

const dispenseTaskCollaborationAccessProvider: PharmacyCollaborationAccessProvider = {
  entityType: 'dispense_task',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    const cycleAssignmentWhere = orgScoped ? null : buildMedicationCycleAssignmentWhere(ctx);
    const where: Prisma.DispenseTaskWhereInput = {
      id: entityId,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    };
    const task = await db.dispenseTask.findFirst({
      where,
      select: { id: true },
    });
    return Boolean(task);
  },
};

const medicationCycleCollaborationAccessProvider: PharmacyCollaborationAccessProvider = {
  entityType: 'medication_cycle',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    const cycleAssignmentWhere = orgScoped ? null : buildMedicationCycleAssignmentWhere(ctx);
    const cycle = await db.medicationCycle.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(cycleAssignmentWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(cycle);
  },
};

const setPlanCollaborationAccessProvider: PharmacyCollaborationAccessProvider = {
  entityType: 'set_plan',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    const planAssignmentWhere = orgScoped ? null : buildSetPlanAssignmentWhere(ctx);
    const plan = await db.setPlan.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(planAssignmentWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(plan);
  },
};

export function createPharmacyCollaborationAccessProviders() {
  return [
    dispenseTaskCollaborationAccessProvider,
    medicationCycleCollaborationAccessProvider,
    setPlanCollaborationAccessProvider,
  ] as const;
}
