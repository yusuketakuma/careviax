import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { formatNullableUtcDateKey } from '@/lib/date-key';
import { optionalUtcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { buildPrescriptionIntakeAssignmentWhere } from '@/server/services/prescription-access';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
} from '@/lib/pharmacy/drug-identity-resolution';
import { z } from 'zod';

const optionalDateColumnSchema = dateKeySchema('日付はYYYY-MM-DD形式です').nullable().optional();
const drugMasterIdSchema = z.string().trim().min(1, '医薬品マスターを選択してください');
const SERVER_DERIVED_DRUG_IDENTITY_FIELDS = [
  'drug_code',
  'source_drug_code',
  'source_drug_code_type',
  'drug_resolution_status',
] as const;
const PRESCRIPTION_CONTENT_UPDATE_FIELDS = [
  'start_date',
  'end_date',
  'days',
  'frequency',
  'dose',
  'quantity',
  'unit',
] as const;

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
    drug_master_id: drugMasterIdSchema.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'expected_updated_at'), {
    message: '更新する項目を指定してください',
  })
  .superRefine((value, ctx) => {
    if (value.drug_master_id === undefined) return;
    for (const field of PRESCRIPTION_CONTENT_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: '薬剤確定と処方内容編集は同時に行えません',
        });
      }
    }
  });

function toDateKey(value: Date | null) {
  return formatNullableUtcDateKey(value);
}

type PrescriptionLineDrugIdentityCodeField = 'source_drug_code' | 'drug_code';

function readPrescriptionLineDrugIdentityCodes(line: {
  source_drug_code: string | null;
  drug_code: string | null;
}) {
  const entries: Array<{ field: PrescriptionLineDrugIdentityCodeField; code: string }> = [];
  const seen = new Set<string>();
  for (const field of ['source_drug_code', 'drug_code'] as const) {
    const code = normalizeMedicationCode(line[field]);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    entries.push({ field, code });
  }
  return entries;
}

function collectServerDerivedDrugIdentityFieldErrors(payload: Record<string, unknown>) {
  const details: Record<string, string[]> = {};
  for (const field of SERVER_DERIVED_DRUG_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      details[field] = ['薬剤コードは医薬品マスターからサーバー側で確定します'];
    }
  }
  return Object.keys(details).length > 0 ? details : null;
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('処方明細IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');
    const serverDerivedFieldErrors = collectServerDerivedDrugIdentityFieldErrors(payload);
    if (serverDerivedFieldErrors) {
      return validationError('入力値が不正です', serverDerivedFieldErrors);
    }

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
          drug_name: true,
          drug_code: true,
          drug_master_id: true,
          source_drug_code: true,
          source_drug_code_type: true,
          drug_resolution_status: true,
          updated_at: true,
          intake: {
            select: {
              cycle_id: true,
              cycle: { select: { patient_id: true } },
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
        'start_date' in updates
          ? optionalUtcDateFromLocalKey(updates.start_date)
          : existing.start_date;
      const effectiveEndDate =
        'end_date' in updates ? optionalUtcDateFromLocalKey(updates.end_date) : existing.end_date;
      const effectiveStartKey = toDateKey(effectiveStartDate ?? null);
      const effectiveEndKey = toDateKey(effectiveEndDate ?? null);
      if (effectiveStartKey && effectiveEndKey && effectiveStartKey > effectiveEndKey) {
        return {
          error: 'invalid_date_range' as const,
          details: { end_date: ['終了日は開始日以降にしてください'] },
        };
      }

      const requestedDrugMasterId =
        'drug_master_id' in updates ? updates.drug_master_id : undefined;
      let resolvedDrugMaster: {
        id: string;
        yj_code: string;
        receipt_code: string | null;
        hot_code: string | null;
        drug_name: string;
      } | null = null;

      if (requestedDrugMasterId !== undefined) {
        if (existing.drug_master_id && existing.drug_master_id !== requestedDrugMasterId) {
          return {
            error: 'drug_master_already_resolved' as const,
            details: {
              drug_master_id: existing.drug_master_id,
              requested_drug_master_id: requestedDrugMasterId,
            },
          };
        }

        resolvedDrugMaster = await tx.drugMaster.findFirst({
          where: { id: requestedDrugMasterId },
          select: {
            id: true,
            yj_code: true,
            receipt_code: true,
            hot_code: true,
            drug_name: true,
          },
        });
        if (!resolvedDrugMaster) {
          return {
            error: 'drug_master_not_found' as const,
            details: {
              drug_master_id: ['存在する医薬品マスターを選択してください'],
            },
          };
        }
        const canonicalDrugCode = normalizeMedicationCode(resolvedDrugMaster.yj_code);
        if (!canonicalDrugCode) {
          return {
            error: 'drug_master_not_found' as const,
            details: {
              drug_master_id: ['YJコードが設定された医薬品マスターを選択してください'],
            },
          };
        }

        const identityCodes = readPrescriptionLineDrugIdentityCodes(existing);
        if (identityCodes.length > 0) {
          const codes = identityCodes.map((entry) => entry.code);
          const codeMasters = await tx.drugMaster.findMany({
            where: {
              OR: [
                { yj_code: { in: codes } },
                { receipt_code: { in: codes } },
                { hot_code: { in: codes } },
              ],
            },
            select: {
              id: true,
              yj_code: true,
              receipt_code: true,
              hot_code: true,
            },
          });
          const resolutions = buildDrugIdentityResolutionByCode(codeMasters);
          for (const entry of identityCodes) {
            const resolution = resolveMedicationCode(entry.code, resolutions);
            if (resolution.status === 'resolved' && resolution.drug.id !== resolvedDrugMaster.id) {
              return {
                error: 'drug_master_code_conflict' as const,
                details: {
                  field: entry.field,
                  drug_code: entry.code,
                  resolved_drug_master_id: resolution.drug.id,
                  requested_drug_master_id: resolvedDrugMaster.id,
                },
              };
            }
          }
        }
      }

      const data: {
        start_date?: Date | null;
        end_date?: Date | null;
        days?: number;
        frequency?: string;
        dose?: string;
        quantity?: number | null;
        unit?: string | null;
        drug_master_id?: string;
        drug_code?: string;
        drug_resolution_status?: 'resolved';
      } = {};

      if ('start_date' in updates)
        data.start_date = optionalUtcDateFromLocalKey(updates.start_date);
      if ('end_date' in updates) data.end_date = optionalUtcDateFromLocalKey(updates.end_date);
      if (updates.days !== undefined) data.days = updates.days;
      if (updates.frequency !== undefined) data.frequency = updates.frequency;
      if (updates.dose !== undefined) data.dose = updates.dose;
      if ('quantity' in updates) data.quantity = updates.quantity ?? null;
      if ('unit' in updates) data.unit = updates.unit ?? null;
      if (resolvedDrugMaster) {
        data.drug_master_id = resolvedDrugMaster.id;
        data.drug_code =
          normalizeMedicationCode(resolvedDrugMaster.yj_code) ?? resolvedDrugMaster.yj_code;
        data.drug_resolution_status = 'resolved';
      }

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
          drug_master_id: true,
          source_drug_code: true,
          source_drug_code_type: true,
          drug_resolution_status: true,
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
        patientId: existing.intake.cycle.patient_id,
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
            drug_code: existing.drug_code,
            drug_master_id: existing.drug_master_id,
            source_drug_code: existing.source_drug_code,
            source_drug_code_type: existing.source_drug_code_type,
            drug_resolution_status: existing.drug_resolution_status,
          },
          after: {
            start_date: toDateKey(updated.start_date),
            end_date: toDateKey(updated.end_date),
            days: updated.days,
            frequency: updated.frequency,
            dose: updated.dose,
            quantity: updated.quantity,
            unit: updated.unit,
            drug_code: updated.drug_code,
            drug_master_id: updated.drug_master_id,
            source_drug_code: updated.source_drug_code,
            source_drug_code_type: updated.source_drug_code_type,
            drug_resolution_status: updated.drug_resolution_status,
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
      if (result.error === 'drug_master_not_found') {
        return validationError('対象の医薬品マスターが見つかりません', result.details);
      }
      if (result.error === 'drug_master_already_resolved') {
        return conflict('処方明細はすでに別の医薬品マスターに紐づいています', result.details);
      }
      if (result.error === 'drug_master_code_conflict') {
        return conflict('処方明細の薬剤コードは別の医薬品マスターに解決されます', result.details);
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
