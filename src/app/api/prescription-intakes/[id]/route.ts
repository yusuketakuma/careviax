import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方受付の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const intake = await prisma.prescriptionIntake.findFirst({
    where: { id, org_id: ctx.orgId },
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
        },
      },
    },
  });

  if (!intake) return notFound('処方箋が見つかりません');

  return success(intake);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方受付の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePrescriptionIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.prescriptionIntake.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('処方箋が見つかりません');

  const {
    refill_next_dispense_date,
    original_collected_at,
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
    prescriber_institution_id,
    ...rest
  } = parsed.data;

  const effectiveSplitTotal = split_dispense_total ?? existing.split_dispense_total ?? undefined;
  const effectiveSplitCurrent = split_dispense_current ?? existing.split_dispense_current ?? undefined;
  const effectiveSplitNextDate =
    split_next_dispense_date ??
    existing.split_next_dispense_date?.toISOString().slice(0, 10) ??
    undefined;
  const hasAnySplitField =
    effectiveSplitTotal != null ||
    effectiveSplitCurrent != null ||
    effectiveSplitNextDate != null;

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
        ...(resolvedInstitution
          ? {
              prescriber_institution_id: resolvedInstitution.prescriber_institution_id,
              prescriber_institution: resolvedInstitution.prescriber_institution,
            }
          : {}),
        ...(refill_next_dispense_date
          ? { refill_next_dispense_date: new Date(refill_next_dispense_date) }
          : {}),
        ...(split_dispense_total != null ? { split_dispense_total } : {}),
        ...(split_dispense_current != null ? { split_dispense_current } : {}),
        ...(split_next_dispense_date
          ? { split_next_dispense_date: new Date(split_next_dispense_date) }
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
