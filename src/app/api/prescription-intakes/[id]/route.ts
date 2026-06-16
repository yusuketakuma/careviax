import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { updatePrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { formatDateKey } from '@/lib/date-key';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
} from '@/server/services/operational-tasks';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';
import { buildPrescriptionIntakeAssignmentWhere } from '@/server/services/prescription-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方受付の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('処方受付IDが不正です');

  const assignmentWhere = buildPrescriptionIntakeAssignmentWhere(ctx);

  const intake = await prisma.prescriptionIntake.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    include: {
      lines: {
        orderBy: { line_number: 'asc' },
      },
      prescriber_institution_ref: {
        select: {
          id: true,
          name: true,
          institution_code: true,
          phone: true,
          fax: true,
        },
      },
      jahis_supplemental_records: {
        orderBy: [{ line_number: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          record_type: true,
          record_label: true,
          line_number: true,
          summary: true,
          payload: true,
          raw_line: true,
        },
      },
      cycle: {
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_id: true,
          case_: {
            select: {
              patient: {
                select: { id: true, name: true, name_kana: true, birth_date: true, gender: true },
              },
            },
          },
          inquiries: {
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              reason: true,
              inquiry_to_physician: true,
              inquiry_content: true,
              result: true,
              proposal_origin: true,
              residual_adjustment: true,
              change_detail: true,
              inquired_at: true,
              resolved_at: true,
            },
          },
        },
      },
    },
  });

  if (!intake) return notFound('処方箋が見つかりません');

  return success(intake);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方受付の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('処方受付IDが不正です');

  const assignmentWhere = buildPrescriptionIntakeAssignmentWhere(ctx);

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePrescriptionIntakeSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.prescriptionIntake.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    include: {
      cycle: {
        select: {
          patient_id: true,
          case_id: true,
        },
      },
    },
  });
  if (!existing) return notFound('処方箋が見つかりません');

  const {
    refill_next_dispense_date,
    original_collected_at,
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
    prescriber_institution_id,
    original_management,
    ...rest
  } = parsed.data;

  const effectiveSplitTotal = split_dispense_total ?? existing.split_dispense_total ?? undefined;
  const effectiveSplitCurrent =
    split_dispense_current ?? existing.split_dispense_current ?? undefined;
  const effectiveSplitNextDate =
    split_next_dispense_date !== undefined
      ? (split_next_dispense_date ?? undefined)
      : existing.split_next_dispense_date
        ? formatDateKey(existing.split_next_dispense_date)
        : undefined;
  const effectivePrescriptionCategory =
    rest.prescription_category ?? existing.prescription_category ?? 'regular';
  const effectiveEmergencyCategory =
    rest.emergency_category !== undefined
      ? rest.emergency_category
      : (existing.emergency_category ?? undefined);
  const hasAnySplitField =
    effectiveSplitTotal != null || effectiveSplitCurrent != null || effectiveSplitNextDate != null;

  if (hasAnySplitField) {
    if (effectiveSplitTotal == null || effectiveSplitCurrent == null) {
      return validationError('分割調剤は分割回数と今回回数を両方入力してください');
    }
    if (effectiveSplitCurrent > effectiveSplitTotal) {
      return validationError('今回回数は分割回数以下である必要があります', {
        split_dispense_total: effectiveSplitTotal,
        split_dispense_current: effectiveSplitCurrent,
      });
    }
    if (effectiveSplitCurrent < effectiveSplitTotal && !effectiveSplitNextDate) {
      return validationError('分割調剤の途中回は次回調剤予定日が必須です');
    }
  }

  if (effectivePrescriptionCategory === 'emergency' && !effectiveEmergencyCategory) {
    return validationError('緊急処方の場合は緊急区分の選択が必須です', {
      emergency_category: ['緊急処方の場合は緊急区分の選択が必須です'],
    });
  }

  let intake;
  try {
    intake = await withOrgContext(ctx.orgId, async (tx) => {
      const resolvedInstitution =
        prescriber_institution_id !== undefined || rest.prescriber_institution !== undefined
          ? await resolvePrescriberInstitutionFields(tx, ctx.orgId, {
              prescriber_institution_id: prescriber_institution_id ?? null,
              prescriber_institution: rest.prescriber_institution,
            })
          : null;

      const updated = await tx.prescriptionIntake.update({
        where: { id },
        data: {
          ...rest,
          ...(effectivePrescriptionCategory === 'regular' ? { emergency_category: null } : {}),
          ...(resolvedInstitution
            ? {
                prescriber_institution_id: resolvedInstitution.prescriber_institution_id,
                prescriber_institution: resolvedInstitution.prescriber_institution,
              }
            : {}),
          ...(refill_next_dispense_date !== undefined
            ? {
                refill_next_dispense_date: refill_next_dispense_date
                  ? new Date(refill_next_dispense_date)
                  : null,
              }
            : {}),
          ...(split_dispense_total != null ? { split_dispense_total } : {}),
          ...(split_dispense_current != null ? { split_dispense_current } : {}),
          ...(split_next_dispense_date !== undefined
            ? {
                split_next_dispense_date: split_next_dispense_date
                  ? new Date(split_next_dispense_date)
                  : null,
              }
            : {}),
          ...(original_collected_at
            ? {
                original_collected_at: new Date(original_collected_at),
                original_collected_by: ctx.userId,
              }
            : {}),
        },
        include: {
          lines: { orderBy: { line_number: 'asc' } },
        },
      });

      if (original_collected_at && updated.source_type === 'fax') {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          taskType: 'fax_original_followup',
          relatedEntityType: 'prescription_intake',
          relatedEntityId: id,
          status: 'completed',
        });
      }

      if (original_management) {
        const originalManagementMetadata = {
          ...original_management,
          patient_id: existing.cycle.patient_id,
          case_id: existing.cycle.case_id,
          updated_by: ctx.userId,
          updated_at: new Date().toISOString(),
        };

        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'prescription_original_management',
          title: '処方せん原本管理を記録',
          description:
            original_management.reconciliation_result === 'discrepancy'
              ? 'FAX・原本の差異内容、電子処方せん取得、調剤結果登録、保管場所を確認してください。'
              : '処方せん原本照合、電子処方せん取得、調剤結果登録、保管場所を記録しました。',
          priority: original_management.reconciliation_result === 'discrepancy' ? 'high' : 'normal',
          status: 'completed',
          dedupeKey: `prescription_original_management:${id}`,
          relatedEntityType: 'prescription_intake',
          relatedEntityId: id,
          metadata: originalManagementMetadata,
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'prescription_original_management_updated',
          targetType: 'prescription_intake',
          targetId: id,
          changes: originalManagementMetadata,
        });
      }

      return updated;
    });
  } catch (error) {
    if (error instanceof PrescriberInstitutionReferenceValidationError) {
      return validationError(error.message);
    }
    throw error;
  }

  return success(intake);
}
