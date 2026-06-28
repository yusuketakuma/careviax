import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { formatNullableUtcDateKey } from '@/lib/date-key';
import { optionalUtcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  PACKAGING_INSTRUCTION_TAG_OPTIONS,
  PACKAGING_METHOD_OPTIONS,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/dispensing/packaging';

class PrescriptionLineBatchConflict extends Error {
  constructor(
    public readonly lineId: string,
    public readonly currentUpdatedAt: string | null,
  ) {
    super(`PrescriptionLine ${lineId} version conflict`);
    this.name = 'PrescriptionLineBatchConflict';
  }
}

class PrescriptionLineBatchValidationError extends Error {
  constructor(public readonly details: Record<string, string[]>) {
    super('PrescriptionLine batch validation failed');
    this.name = 'PrescriptionLineBatchValidationError';
  }
}

const optionalDateColumnSchema = dateKeySchema('日付はYYYY-MM-DD形式です').nullable().optional();
const optionalNullableTextSchema = z.string().trim().min(1).max(1000).nullable().optional();
const ROUTE_VALUES = ['internal', 'external', 'injection', 'other'] as const;
const DISPENSING_METHOD_VALUES = ['standard', 'unit_dose', 'crushed', 'other'] as const;
const PACKAGING_METHOD_VALUES = PACKAGING_METHOD_OPTIONS.map((option) => option.value) as [
  PackagingMethodValue,
  ...PackagingMethodValue[],
];
const PACKAGING_TAG_VALUES = PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => option.value) as [
  PackagingInstructionTagValue,
  ...PackagingInstructionTagValue[],
];

const lineUpdateItemSchema = z
  .object({
    line_id: z.string().trim().min(1, 'line_id は必須です'),
    expected_updated_at: z.string().datetime('版情報が不正です'),
    start_date: optionalDateColumnSchema,
    end_date: optionalDateColumnSchema,
    days: z.number().int().min(1, '投与日数は1以上の整数です').optional(),
    dosage_form: optionalNullableTextSchema,
    route: z.enum(ROUTE_VALUES).nullable().optional(),
    dispensing_method: z.enum(DISPENSING_METHOD_VALUES).nullable().optional(),
    packaging_method: z.enum(PACKAGING_METHOD_VALUES).nullable().optional(),
    packaging_instructions: optionalNullableTextSchema,
    packaging_instruction_tags: z.array(z.enum(PACKAGING_TAG_VALUES)).optional(),
  })
  .refine(
    (value) =>
      value.start_date !== undefined ||
      value.end_date !== undefined ||
      value.days !== undefined ||
      value.dosage_form !== undefined ||
      value.route !== undefined ||
      value.dispensing_method !== undefined ||
      value.packaging_method !== undefined ||
      value.packaging_instructions !== undefined ||
      value.packaging_instruction_tags !== undefined,
    { message: '更新する項目を指定してください' },
  )
  .refine(
    (value) =>
      value.packaging_instruction_tags === undefined ||
      new Set(value.packaging_instruction_tags).size === value.packaging_instruction_tags.length,
    {
      message: '包装タグが重複しています',
      path: ['packaging_instruction_tags'],
    },
  );

const patchSchema = z.object({
  client_action_id: z.string().trim().min(1).max(100).optional(),
  packaging_group_id: z.string().trim().min(1).nullable().optional(),
  lines: z.array(lineUpdateItemSchema).min(1, 'lines は1件以上必要です'),
});

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

function toDateKey(value: Date | null | undefined) {
  return formatNullableUtcDateKey(value ?? null);
}

function duplicateIds(ids: string[]) {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
}

export const PATCH = withAuthContext(async (req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense')) {
    return forbidden('処方明細の一括編集権限がありません');
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

  const duplicated = duplicateIds(parsed.data.lines.map((line) => line.line_id));
  if (duplicated.length > 0) {
    return validationError('同じ処方明細が重複しています', {
      line_id: ['同じ line_id を複数指定できません'],
    });
  }

  const cycleId = await resolveTaskCycleId(ctx, id);
  if (!cycleId) return notFound('タスクが見つかりません');

  const lineIds = parsed.data.lines.map((line) => line.line_id);
  const existingLines = await prisma.prescriptionLine.findMany({
    where: { id: { in: lineIds }, org_id: ctx.orgId, intake: { cycle_id: cycleId } },
    select: {
      id: true,
      intake_id: true,
      start_date: true,
      end_date: true,
      days: true,
      dosage_form: true,
      route: true,
      dispensing_method: true,
      packaging_method: true,
      packaging_instructions: true,
      packaging_instruction_tags: true,
      updated_at: true,
    },
  });
  const existingById = new Map(existingLines.map((line) => [line.id, line]));
  const missing = lineIds.filter((lineId) => !existingById.has(lineId));
  if (missing.length > 0) return notFound('対象の処方明細が見つかりません');

  let updated: Array<{
    id: string;
    start_date: string | null;
    end_date: string | null;
    days: number;
    dosage_form: string | null;
    route: string | null;
    dispensing_method: string | null;
    packaging_method: PackagingMethodValue | null;
    packaging_instructions: string | null;
    packaging_instruction_tags: PackagingInstructionTagValue[];
    updated_at: string;
  }>;

  try {
    updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const results: typeof updated = [];

        for (const line of parsed.data.lines) {
          const before = existingById.get(line.line_id);
          if (!before) {
            throw new Error(`PrescriptionLine ${line.line_id} disappeared mid-transaction`);
          }

          const expectedUpdatedAt = new Date(line.expected_updated_at);
          if (before.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
            throw new PrescriptionLineBatchConflict(line.line_id, before.updated_at.toISOString());
          }

          const effectiveStartDate =
            'start_date' in line ? optionalUtcDateFromLocalKey(line.start_date) : before.start_date;
          const effectiveEndDate =
            'end_date' in line ? optionalUtcDateFromLocalKey(line.end_date) : before.end_date;
          const effectiveStartKey = toDateKey(effectiveStartDate);
          const effectiveEndKey = toDateKey(effectiveEndDate);
          if (effectiveStartKey && effectiveEndKey && effectiveStartKey > effectiveEndKey) {
            throw new PrescriptionLineBatchValidationError({
              end_date: ['終了日は開始日以降にしてください'],
            });
          }

          const data: {
            start_date?: Date | null;
            end_date?: Date | null;
            days?: number;
            dosage_form?: string | null;
            route?: string | null;
            dispensing_method?: string | null;
            packaging_method?: PackagingMethodValue | null;
            packaging_instructions?: string | null;
            packaging_instruction_tags?: PackagingInstructionTagValue[];
          } = {};
          if ('start_date' in line) data.start_date = optionalUtcDateFromLocalKey(line.start_date);
          if ('end_date' in line) data.end_date = optionalUtcDateFromLocalKey(line.end_date);
          if (line.days !== undefined) data.days = line.days;
          if ('dosage_form' in line) data.dosage_form = line.dosage_form;
          if ('route' in line) data.route = line.route;
          if ('dispensing_method' in line) data.dispensing_method = line.dispensing_method;
          if ('packaging_method' in line) data.packaging_method = line.packaging_method;
          if ('packaging_instructions' in line)
            data.packaging_instructions = line.packaging_instructions;
          if (line.packaging_instruction_tags !== undefined)
            data.packaging_instruction_tags = line.packaging_instruction_tags;

          const claim = await tx.prescriptionLine.updateMany({
            where: {
              id: line.line_id,
              org_id: ctx.orgId,
              intake: { cycle_id: cycleId },
              updated_at: expectedUpdatedAt,
            },
            data,
          });
          if (claim.count !== 1) {
            const current = await tx.prescriptionLine.findFirst({
              where: { id: line.line_id, org_id: ctx.orgId, intake: { cycle_id: cycleId } },
              select: { updated_at: true },
            });
            throw new PrescriptionLineBatchConflict(
              line.line_id,
              current?.updated_at.toISOString() ?? null,
            );
          }

          const after = await tx.prescriptionLine.findFirst({
            where: { id: line.line_id, org_id: ctx.orgId, intake: { cycle_id: cycleId } },
            select: {
              id: true,
              start_date: true,
              end_date: true,
              days: true,
              dosage_form: true,
              route: true,
              dispensing_method: true,
              packaging_method: true,
              packaging_instructions: true,
              packaging_instruction_tags: true,
              updated_at: true,
            },
          });
          if (!after) {
            throw new PrescriptionLineBatchConflict(line.line_id, null);
          }

          await createAuditLogEntry(tx, ctx, {
            action: 'prescription_line.batch_update',
            targetType: 'PrescriptionLine',
            targetId: line.line_id,
            changes: {
              task_id: id,
              cycle_id: cycleId,
              intake_id: before.intake_id,
              client_action_id: parsed.data.client_action_id ?? null,
              packaging_group_id: parsed.data.packaging_group_id ?? null,
              before: {
                start_date: toDateKey(before.start_date),
                end_date: toDateKey(before.end_date),
                days: before.days,
                dosage_form: before.dosage_form,
                route: before.route,
                dispensing_method: before.dispensing_method,
                packaging_method: before.packaging_method,
                packaging_instructions: before.packaging_instructions,
                packaging_instruction_tags: before.packaging_instruction_tags,
                updated_at: before.updated_at.toISOString(),
              },
              after: {
                start_date: toDateKey(after.start_date),
                end_date: toDateKey(after.end_date),
                days: after.days,
                dosage_form: after.dosage_form,
                route: after.route,
                dispensing_method: after.dispensing_method,
                packaging_method: after.packaging_method,
                packaging_instructions: after.packaging_instructions,
                packaging_instruction_tags: after.packaging_instruction_tags,
                updated_at: after.updated_at.toISOString(),
              },
            },
          });

          results.push({
            id: after.id,
            start_date: toDateKey(after.start_date),
            end_date: toDateKey(after.end_date),
            days: after.days,
            dosage_form: after.dosage_form,
            route: after.route,
            dispensing_method: after.dispensing_method,
            packaging_method: after.packaging_method,
            packaging_instructions: after.packaging_instructions,
            packaging_instruction_tags: after.packaging_instruction_tags,
            updated_at: after.updated_at.toISOString(),
          });
        }

        return results;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (cause) {
    if (cause instanceof PrescriptionLineBatchValidationError) {
      return validationError('入力値が不正です', cause.details);
    }
    if (cause instanceof PrescriptionLineBatchConflict) {
      return conflict('処方明細が他のユーザーによって更新されています', {
        line_id: cause.lineId,
        current: cause.currentUpdatedAt ? { updated_at: cause.currentUpdatedAt } : null,
      });
    }
    throw cause;
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'dispense_tasks_update', task_id: id },
  });

  return success({ data: { updated } });
});
