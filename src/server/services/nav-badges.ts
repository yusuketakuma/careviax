import { hasPermission } from '@/lib/auth/permissions';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';

export type NavBadgePayload = {
  audit?: number;
  handoff?: number;
};

type HandoffBadgeItemSummary = {
  created_by: string;
  read_by?: string[] | null;
  lifecycle_status?: string | null;
  consult_status?: string | null;
};

function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function isCurrentHandoffItem(item: {
  lifecycle_status?: string | null;
  consult_status?: string | null;
}): boolean {
  return item.lifecycle_status != null || item.consult_status != null;
}

export function countMyHandoffBadgeItems(
  items: HandoffBadgeItemSummary[],
  viewerUserId: string,
): number {
  return items
    .filter(isCurrentHandoffItem)
    .filter(
      (item) => item.created_by === viewerUserId || !(item.read_by ?? []).includes(viewerUserId),
    ).length;
}

export async function countDispenseAuditBadge(ctx: AuthContext): Promise<number | undefined> {
  if (!hasPermission(ctx.role, 'canAuditDispense')) return undefined;

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  return prisma.dispenseTask.count({
    where: {
      org_id: ctx.orgId,
      status: 'completed',
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
      audits: {
        none: {
          result: { notIn: ['hold'] },
        },
      },
    },
  });
}

export async function countHandoffBadge(ctx: AuthContext): Promise<number | undefined> {
  if (!hasPermission(ctx.role, 'canDispense')) return undefined;

  const shiftDate = toDateOnly(todayDateKey());
  return withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.handoffItem.count({
        where: {
          board: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
          },
          OR: [{ lifecycle_status: { not: null } }, { consult_status: { not: null } }],
          AND: [
            {
              OR: [{ created_by: ctx.userId }, { NOT: { read_by: { has: ctx.userId } } }],
            },
          ],
        },
      }),
    { maxWaitMs: 10_000, timeoutMs: 20_000 },
  );
}

export async function buildNavBadgePayload(ctx: AuthContext): Promise<NavBadgePayload> {
  const [audit, handoff] = await Promise.all([
    countDispenseAuditBadge(ctx),
    countHandoffBadge(ctx),
  ]);

  return {
    ...(typeof audit === 'number' ? { audit } : {}),
    ...(typeof handoff === 'number' ? { handoff } : {}),
  };
}
