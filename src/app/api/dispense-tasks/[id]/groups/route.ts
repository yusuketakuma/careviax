import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

/** 一包化グループ更新の楽観ロック競合(version 不一致)。 */
class PackagingGroupConflict extends Error {
  constructor(public readonly groupId: string) {
    super(`PackagingGroup ${groupId} version conflict`);
    this.name = 'PackagingGroupConflict';
  }
}

/** 処方明細グループ割当の期待所属不一致。 */
class PackagingAssignmentConflict extends Error {
  constructor(
    public readonly lineId: string,
    public readonly expectedPackagingGroupId: string | null,
    public readonly currentPackagingGroupId: string | null,
  ) {
    super(`PrescriptionLine ${lineId} packaging group conflict`);
    this.name = 'PackagingAssignmentConflict';
  }
}

/**
 * 調剤ワークベンチ 一包化グループ(PackagingGroup) CRUD + 行割当 API。
 *
 * `[id]` は DispenseTask.id。タスクの cycle 配下で:
 * - POST: 新しい一包化グループを作成する(group_key / label / method / slot / sort_order)
 * - PATCH: グループ属性の一括更新(groups[]) または 処方明細のグループ割当(assignments[])
 *   assignments[] は stale D&D 防止のため expected_packaging_group_id を必須にする
 *
 * 権限は canDispense(薬剤師の調剤方法決定)。確定操作は監査ログ(createAuditLogEntry)に
 * 記録し、サーバ信頼時刻(AuditLog.created_at @default(now()))・操作者(ctx.userId)を残す。
 * 監査ログは append-only(物理削除 API は提供しない)。
 *
 * PrescriptionLine.packaging_group_id は loose String(FK なし)のため、割当時は
 * 対象 line が当該 cycle の intake 配下にあること、対象 group が当該 cycle に属することを
 * アプリ層で検証する(set-batches route の cycle 一致ガードを踏襲)。
 */

// ── 入口: DispenseTask アクセス検証(担当割当フィルタ込み)──

async function resolveTaskCycleId(
  ctx: { orgId: string; userId: string; role: Parameters<typeof hasPermission>[0] },
  taskId: string,
): Promise<string | null> {
  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
  const task = await prisma.dispenseTask.findFirst({
    where: {
      id: taskId,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: { cycle_id: true },
  });
  return task?.cycle_id ?? null;
}

// ── POST: グループ作成 ──

const packagingGroupCreateSelect = {
  id: true,
  cycle_id: true,
  group_key: true,
  label: true,
  method: true,
  slot: true,
  sort_order: true,
  version: true,
} as const;

type PackagingGroupCreateDto = Prisma.PackagingGroupGetPayload<{
  select: typeof packagingGroupCreateSelect;
}>;

type PackagingGroupReader = {
  packagingGroup: {
    findFirst: (args: {
      where: Prisma.PackagingGroupWhereInput;
      select: typeof packagingGroupCreateSelect;
    }) => Promise<PackagingGroupCreateDto | null>;
  };
};

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function findPackagingGroupByKey(
  client: PackagingGroupReader,
  args: { orgId: string; cycleId: string; groupKey: string },
) {
  return client.packagingGroup.findFirst({
    where: {
      org_id: args.orgId,
      cycle_id: args.cycleId,
      group_key: args.groupKey,
    },
    select: packagingGroupCreateSelect,
  });
}

function sameCreatePayload(
  existing: PackagingGroupCreateDto,
  input: z.infer<typeof createGroupSchema>,
) {
  return (
    existing.label === input.label &&
    existing.method === input.method &&
    (existing.slot ?? null) === (input.slot ?? null) &&
    existing.sort_order === (input.sort_order ?? 0)
  );
}

const createGroupSchema = z.object({
  group_key: z.string().trim().min(1, 'group_key は必須です'),
  label: z.string().trim().min(1, 'label は必須です'),
  method: z.string().trim().min(1, 'method は必須です'),
  slot: z.string().trim().min(1).optional(),
  sort_order: z.number().int().min(0).optional(),
});

export const POST = withAuthContext(async (req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense')) {
    return forbidden('一包化グループの作成権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');
  const parsed = createGroupSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const cycleId = await resolveTaskCycleId(ctx, id);
  if (!cycleId) return notFound('タスクが見つかりません');

  let result:
    | { kind: 'success'; group: PackagingGroupCreateDto; created: boolean }
    | { kind: 'conflict'; group: PackagingGroupCreateDto };
  try {
    result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await findPackagingGroupByKey(tx, {
        orgId: ctx.orgId,
        cycleId,
        groupKey: parsed.data.group_key,
      });
      if (existing) {
        return sameCreatePayload(existing, parsed.data)
          ? { kind: 'success' as const, group: existing, created: false }
          : { kind: 'conflict' as const, group: existing };
      }

      const created = await tx.packagingGroup.create({
        data: {
          org_id: ctx.orgId,
          cycle_id: cycleId,
          group_key: parsed.data.group_key,
          label: parsed.data.label,
          method: parsed.data.method,
          slot: parsed.data.slot ?? null,
          sort_order: parsed.data.sort_order ?? 0,
        },
        select: packagingGroupCreateSelect,
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'packaging_group.create',
        targetType: 'PackagingGroup',
        targetId: created.id,
        changes: {
          cycle_id: cycleId,
          group_key: created.group_key,
          label: created.label,
          method: created.method,
          slot: created.slot,
          sort_order: created.sort_order,
        },
      });

      return { kind: 'success' as const, group: created, created: true };
    });
  } catch (cause) {
    if (!isUniqueConstraintError(cause)) throw cause;

    const existing = await withOrgContext(ctx.orgId, (tx) =>
      findPackagingGroupByKey(tx, {
        orgId: ctx.orgId,
        cycleId,
        groupKey: parsed.data.group_key,
      }),
    );
    if (!existing) throw cause;
    result = sameCreatePayload(existing, parsed.data)
      ? { kind: 'success', group: existing, created: false }
      : { kind: 'conflict', group: existing };
  }

  if (result.kind === 'conflict') {
    return conflict('同じ group_key の一包化グループが別内容で既に存在します', {
      packaging_group_id: result.group.id,
      group_key: result.group.group_key,
    });
  }

  if (result.created) {
    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: {
        source: 'dispense_tasks_update',
        task_id: id,
        packaging_group_id: result.group.id,
      },
    });
  }

  return success(
    { data: { ...result.group, created: result.created } },
    result.created ? 201 : 200,
  );
});

// ── PATCH: グループ更新(groups[]) / 行割当(assignments[])──

const groupUpdateItemSchema = z
  .object({
    id: z.string().trim().min(1, 'id は必須です'),
    label: z.string().trim().min(1).optional(),
    method: z.string().trim().min(1).optional(),
    slot: z.string().trim().min(1).nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
    version: z.number().int().min(0, 'version は必須です'),
  })
  .refine(
    (item) =>
      item.label !== undefined ||
      item.method !== undefined ||
      item.slot !== undefined ||
      item.sort_order !== undefined,
    { message: '更新内容がありません' },
  );

const assignmentItemSchema = z.object({
  line_id: z.string().trim().min(1, 'line_id は必須です'),
  packaging_group_id: z.string().trim().min(1).nullable(),
  expected_packaging_group_id: z.string().trim().min(1).nullable(),
});

const patchSchema = z.union([
  z.object({ groups: z.array(groupUpdateItemSchema).min(1, 'groups は1件以上必要です') }),
  z.object({
    assignments: z.array(assignmentItemSchema).min(1, 'assignments は1件以上必要です'),
  }),
]);

type GroupUpdateItem = z.infer<typeof groupUpdateItemSchema>;
type AssignmentItem = z.infer<typeof assignmentItemSchema>;

export const PATCH = withAuthContext(async (req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense')) {
    return forbidden('一包化グループの更新権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const cycleId = await resolveTaskCycleId(ctx, id);
  if (!cycleId) return notFound('タスクが見つかりません');

  if ('groups' in parsed.data) {
    return updateGroups(ctx, id, cycleId, parsed.data.groups);
  }
  return assignLines(ctx, id, cycleId, parsed.data.assignments);
});

async function updateGroups(
  ctx: Parameters<typeof createAuditLogEntry>[1],
  taskId: string,
  cycleId: string,
  groups: GroupUpdateItem[],
) {
  // 当該 cycle 配下の対象グループのみを更新対象として読み込む。
  const groupIds = groups.map((group) => group.id);
  const existingGroups = await prisma.packagingGroup.findMany({
    where: { id: { in: groupIds }, org_id: ctx.orgId, cycle_id: cycleId },
    select: { id: true, label: true, method: true, slot: true, sort_order: true, version: true },
  });
  const existingById = new Map(existingGroups.map((group) => [group.id, group]));

  const missing = groupIds.filter((groupId) => !existingById.has(groupId));
  if (missing.length > 0) {
    return notFound('対象の一包化グループが見つかりません');
  }

  let updated: { id: string; version: number }[];
  try {
    updated = await withOrgContext(ctx.orgId, async (tx) => {
      const results: { id: string; version: number }[] = [];

      for (const group of groups) {
        const before = existingById.get(group.id);
        if (!before) {
          // 入口で missing を弾いているため通常到達しない(型ナローイング用)。
          throw new Error(`PackagingGroup ${group.id} disappeared mid-transaction`);
        }

        const data: {
          label?: string;
          method?: string;
          slot?: string | null;
          sort_order?: number;
          version: { increment: number };
        } = { version: { increment: 1 } };
        if (group.label !== undefined) data.label = group.label;
        if (group.method !== undefined) data.method = group.method;
        if (group.slot !== undefined) data.slot = group.slot;
        if (group.sort_order !== undefined) data.sort_order = group.sort_order;

        // 楽観ロック: version 指定時は version 一致を WHERE に含め、count===0 を競合とみなす。
        const result = await tx.packagingGroup.updateMany({
          where: {
            id: group.id,
            org_id: ctx.orgId,
            cycle_id: cycleId,
            ...(group.version !== undefined ? { version: group.version } : {}),
          },
          data,
        });
        if (result.count === 0) {
          throw new PackagingGroupConflict(group.id);
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'packaging_group.update',
          targetType: 'PackagingGroup',
          targetId: group.id,
          changes: {
            before: {
              label: before.label,
              method: before.method,
              slot: before.slot,
              sort_order: before.sort_order,
              version: before.version,
            },
            after: {
              label: data.label ?? before.label,
              method: data.method ?? before.method,
              slot: data.slot !== undefined ? data.slot : before.slot,
              sort_order: data.sort_order ?? before.sort_order,
              version: before.version + 1,
            },
          },
        });

        results.push({ id: group.id, version: before.version + 1 });
      }

      return results;
    });
  } catch (cause) {
    if (cause instanceof PackagingGroupConflict) {
      return conflict('一包化グループが他の操作で更新されています', {
        packaging_group_id: cause.groupId,
      });
    }
    throw cause;
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'dispense_tasks_update', task_id: taskId },
  });

  return success({ data: { updated } });
}

async function assignLines(
  ctx: Parameters<typeof createAuditLogEntry>[1],
  taskId: string,
  cycleId: string,
  assignments: AssignmentItem[],
) {
  // 対象 line が当該 cycle の intake 配下であることを検証(packaging_group_id は loose String)。
  const lineIds = assignments.map((assignment) => assignment.line_id);
  const lines = await prisma.prescriptionLine.findMany({
    where: { id: { in: lineIds }, org_id: ctx.orgId, intake: { cycle_id: cycleId } },
    select: { id: true, packaging_group_id: true },
  });
  const lineById = new Map(lines.map((line) => [line.id, line]));

  const missingLines = lineIds.filter((lineId) => !lineById.has(lineId));
  if (missingLines.length > 0) {
    return notFound('対象の処方明細が見つかりません');
  }

  // 割当先グループも当該 cycle に属することを検証(null 解除はスキップ)。
  const targetGroupIds = Array.from(
    new Set(
      assignments
        .map((assignment) => assignment.packaging_group_id)
        .filter((groupId): groupId is string => groupId != null),
    ),
  );
  if (targetGroupIds.length > 0) {
    const validGroups = await prisma.packagingGroup.findMany({
      where: { id: { in: targetGroupIds }, org_id: ctx.orgId, cycle_id: cycleId },
      select: { id: true },
    });
    const validGroupIds = new Set(validGroups.map((group) => group.id));
    const invalidGroups = targetGroupIds.filter((groupId) => !validGroupIds.has(groupId));
    if (invalidGroups.length > 0) {
      return notFound('割当先の一包化グループが見つかりません');
    }
  }

  let assigned: { line_id: string }[];
  try {
    assigned = await withOrgContext(ctx.orgId, async (tx) => {
      const results: { line_id: string }[] = [];

      for (const assignment of assignments) {
        const before = lineById.get(assignment.line_id);
        if (!before) {
          throw new Error(`PrescriptionLine ${assignment.line_id} disappeared mid-transaction`);
        }

        const result = await tx.prescriptionLine.updateMany({
          where: {
            id: assignment.line_id,
            org_id: ctx.orgId,
            intake: { cycle_id: cycleId },
            packaging_group_id: assignment.expected_packaging_group_id,
          },
          data: { packaging_group_id: assignment.packaging_group_id },
        });
        if (result.count === 0) {
          const current = await tx.prescriptionLine.findFirst({
            where: { id: assignment.line_id, org_id: ctx.orgId, intake: { cycle_id: cycleId } },
            select: { packaging_group_id: true },
          });
          throw new PackagingAssignmentConflict(
            assignment.line_id,
            assignment.expected_packaging_group_id,
            current?.packaging_group_id ?? null,
          );
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'packaging_group.assign',
          targetType: 'PrescriptionLine',
          targetId: assignment.line_id,
          changes: {
            before: { packaging_group_id: before.packaging_group_id },
            after: { packaging_group_id: assignment.packaging_group_id },
          },
        });

        results.push({ line_id: assignment.line_id });
      }

      return results;
    });
  } catch (cause) {
    if (cause instanceof PackagingAssignmentConflict) {
      return conflict('処方明細のグループ割当が他の操作で更新されています', {
        line_id: cause.lineId,
        expected_packaging_group_id: cause.expectedPackagingGroupId,
        current_packaging_group_id: cause.currentPackagingGroupId,
      });
    }
    throw cause;
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'dispense_tasks_update', task_id: taskId },
  });

  return success({ data: { assigned } });
}
