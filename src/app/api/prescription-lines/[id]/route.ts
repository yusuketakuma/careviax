import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { formatNullableUtcDateKey } from '@/lib/date-key';
import { buildPrescriptionIntakeAssignmentWhere } from '@/server/services/prescription-access';
import { dateKeySchema } from '@/lib/validations/date-key';
import { z } from 'zod';

const optionalDateColumnSchema = dateKeySchema('日付はYYYY-MM-DD形式です').nullable().optional();

/**
 * 処方明細編集(調剤ワークベンチ §11)。
 * start_date/end_date は `@db.Date` 列のため日付文字列(YYYY-MM-DD)で受け取り Date に変換する。
 * すべて optional の部分更新。クライアントが指定したフィールドのみを更新し、
 * end_date の自動再計算は行わない(送られてきた値のみ反映する安全側)。
 */
const updatePrescriptionLineSchema = z
  .object({
    expected_updated_at: z.string().datetime('版情報が不正です'),
    start_date: optionalDateColumnSchema,
    end_date: optionalDateColumnSchema,
    days: z.number().int().min(1, '投与日数は1以上の整数です').optional(),
    frequency: z.string().min(1, '用法を入力してください').optional(),
    dose: z.string().min(1, '用量を入力してください').optional(),
    quantity: z.number().nonnegative('数量は0以上の数です').nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'expected_updated_at'), {
    message: '更新する項目を指定してください',
  });

function toDateColumnValue(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(value: Date | null) {
  return formatNullableUtcDateKey(value);
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('処方明細IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePrescriptionLineSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { expected_updated_at: expectedUpdatedAtRaw, ...updates } = parsed.data;
    const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
    const intakeAssignmentWhere = buildPrescriptionIntakeAssignmentWhere(ctx);

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.prescriptionLine.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(intakeAssignmentWhere ? { intake: intakeAssignmentWhere } : {}),
        },
        select: {
          id: true,
          intake_id: true,
          start_date: true,
          end_date: true,
          days: true,
          frequency: true,
          dose: true,
          quantity: true,
          unit: true,
          updated_at: true,
          intake: {
            select: {
              cycle_id: true,
            },
          },
        },
      });

      if (!existing) return null;

      if (existing.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
        return {
          error: 'stale' as const,
          current: {
            updated_at: existing.updated_at.toISOString(),
          },
        };
      }

      const effectiveStartDate =
        'start_date' in updates ? toDateColumnValue(updates.start_date) : existing.start_date;
      const effectiveEndDate =
        'end_date' in updates ? toDateColumnValue(updates.end_date) : existing.end_date;
      const effectiveStartKey = toDateKey(effectiveStartDate ?? null);
      const effectiveEndKey = toDateKey(effectiveEndDate ?? null);
      if (effectiveStartKey && effectiveEndKey && effectiveStartKey > effectiveEndKey) {
        return {
          error: 'invalid_date_range' as const,
          details: { end_date: ['終了日は開始日以降にしてください'] },
        };
      }

      const data: {
        start_date?: Date | null;
        end_date?: Date | null;
        days?: number;
        frequency?: string;
        dose?: string;
        quantity?: number | null;
        unit?: string | null;
      } = {};

      if ('start_date' in updates) data.start_date = toDateColumnValue(updates.start_date);
      if ('end_date' in updates) data.end_date = toDateColumnValue(updates.end_date);
      if (updates.days !== undefined) data.days = updates.days;
      if (updates.frequency !== undefined) data.frequency = updates.frequency;
      if (updates.dose !== undefined) data.dose = updates.dose;
      if ('quantity' in updates) data.quantity = updates.quantity ?? null;
      if ('unit' in updates) data.unit = updates.unit ?? null;

      const claim = await tx.prescriptionLine.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          updated_at: expectedUpdatedAt,
          ...(intakeAssignmentWhere ? { intake: intakeAssignmentWhere } : {}),
        },
        data,
      });

      if (claim.count !== 1) {
        const current = await tx.prescriptionLine.findFirst({
          where: {
            id,
            org_id: ctx.orgId,
            ...(intakeAssignmentWhere ? { intake: intakeAssignmentWhere } : {}),
          },
          select: { updated_at: true },
        });
        return {
          error: 'stale' as const,
          current: current ? { updated_at: current.updated_at.toISOString() } : null,
        };
      }

      const updated = await tx.prescriptionLine.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(intakeAssignmentWhere ? { intake: intakeAssignmentWhere } : {}),
        },
        select: {
          id: true,
          intake_id: true,
          line_number: true,
          drug_name: true,
          drug_code: true,
          dosage_form: true,
          dose: true,
          frequency: true,
          days: true,
          quantity: true,
          unit: true,
          start_date: true,
          end_date: true,
          packaging_group_id: true,
          updated_at: true,
        },
      });

      if (!updated) {
        return { error: 'stale' as const, current: null };
      }

      // 監査証跡(§12-5): 確定操作。サーバ信頼時刻(AuditLog.created_at @default(now()))・
      // 操作者(actor_id=inputUserId)・対象(PrescriptionLine)・before/after を append-only で記録。
      await createAuditLogEntry(tx, ctx, {
        action: 'prescription_line.update',
        targetType: 'PrescriptionLine',
        targetId: updated.id,
        changes: {
          cycle_id: existing.intake.cycle_id,
          intake_id: existing.intake_id,
          before: {
            start_date: toDateKey(existing.start_date),
            end_date: toDateKey(existing.end_date),
            days: existing.days,
            frequency: existing.frequency,
            dose: existing.dose,
            quantity: existing.quantity,
            unit: existing.unit,
          },
          after: {
            start_date: toDateKey(updated.start_date),
            end_date: toDateKey(updated.end_date),
            days: updated.days,
            frequency: updated.frequency,
            dose: updated.dose,
            quantity: updated.quantity,
            unit: updated.unit,
          },
        },
      });

      return updated;
    });

    if (!result) return notFound('処方明細が見つかりません');
    if ('error' in result) {
      if (result.error === 'invalid_date_range') {
        return validationError('入力値が不正です', result.details);
      }
      return conflict('処方明細が他のユーザーによって更新されています', result.current);
    }

    return success({ data: result });
  },
  {
    permission: 'canDispense',
    message: '処方明細の編集権限がありません',
  },
);
