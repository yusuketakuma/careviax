type SetBatchHistorySnapshot = {
  batch_id: string | null;
  line_id: string;
  drug_name: string | null;
  slot: string;
  day_number: number;
  quantity: number;
  carry_type: string;
  packaging_method_snapshot: string | null;
  packaging_instructions_snapshot: string | null;
  packaging_instruction_tags_snapshot: string[];
};

type SetBatchHistoryTarget = {
  id?: string | null;
  line_id: string;
  slot: string;
  day_number: number;
  quantity: number;
  carry_type: string;
  packaging_method_snapshot?: string | null;
  packaging_instructions_snapshot?: string | null;
  packaging_instruction_tags_snapshot?: string[] | null;
  line?: {
    drug_name?: string | null;
  } | null;
};

export function buildSetBatchHistorySnapshot(
  target: SetBatchHistoryTarget
): SetBatchHistorySnapshot {
  return {
    batch_id: target.id ?? null,
    line_id: target.line_id,
    drug_name: target.line?.drug_name ?? null,
    slot: target.slot,
    day_number: target.day_number,
    quantity: target.quantity,
    carry_type: target.carry_type,
    packaging_method_snapshot: target.packaging_method_snapshot ?? null,
    packaging_instructions_snapshot: target.packaging_instructions_snapshot ?? null,
    packaging_instruction_tags_snapshot: target.packaging_instruction_tags_snapshot ?? [],
  };
}

export function collectChangedLineIds(args: {
  before: SetBatchHistorySnapshot[];
  after: SetBatchHistorySnapshot[];
}) {
  const beforeMap = new Map(
    args.before.map((snapshot) => [
      `${snapshot.line_id}:${snapshot.day_number}:${snapshot.slot}`,
      JSON.stringify(snapshot),
    ])
  );
  const afterMap = new Map(
    args.after.map((snapshot) => [
      `${snapshot.line_id}:${snapshot.day_number}:${snapshot.slot}`,
      JSON.stringify(snapshot),
    ])
  );
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const lineIds = new Set<string>();

  for (const key of keys) {
    if (beforeMap.get(key) !== afterMap.get(key)) {
      lineIds.add(key.split(':')[0] ?? key);
    }
  }

  return Array.from(lineIds);
}

export async function createSetBatchChangeLog(
  tx: {
    setBatchChangeLog: {
      create: (args: {
        data: Prisma.SetBatchChangeLogUncheckedCreateInput;
      }) => Promise<unknown>;
    };
  },
  args: {
    orgId: string;
    planId: string;
    batchId?: string | null;
    action: string;
    triggerSource?: string | null;
    reason?: string | null;
    lineIds?: string[];
    beforeSnapshot: Prisma.InputJsonValue;
    afterSnapshot?: Prisma.InputJsonValue;
    changedBy?: string | null;
  }
) {
  await tx.setBatchChangeLog.create({
    data: {
      org_id: args.orgId,
      plan_id: args.planId,
      ...(args.batchId !== undefined ? { batch_id: args.batchId } : {}),
      action: args.action,
      ...(args.triggerSource ? { trigger_source: args.triggerSource } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.lineIds ? { line_ids: args.lineIds } : {}),
      before_snapshot: args.beforeSnapshot,
      ...(args.afterSnapshot !== undefined ? { after_snapshot: args.afterSnapshot } : {}),
      ...(args.changedBy ? { changed_by: args.changedBy } : {}),
    },
  });
}
import type { Prisma } from '@prisma/client';
