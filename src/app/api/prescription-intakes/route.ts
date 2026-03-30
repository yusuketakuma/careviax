import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { addDays, format, subDays } from 'date-fns';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from './shared';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';

function validateSplitDispense(
  input: {
    split_dispense_total?: number;
    split_dispense_current?: number;
    split_next_dispense_date?: string;
  }
) {
  const { split_dispense_total, split_dispense_current, split_next_dispense_date } = input;
  const hasAnySplitField =
    split_dispense_total != null ||
    split_dispense_current != null ||
    split_next_dispense_date != null;

  if (!hasAnySplitField) return null;
  if (split_dispense_total == null || split_dispense_current == null) {
    return { error: 'missing_split_dispense_fields' as const };
  }
  if (split_dispense_current > split_dispense_total) {
    return {
      error: 'invalid_split_dispense_progress' as const,
      splitDispenseTotal: split_dispense_total,
      splitDispenseCurrent: split_dispense_current,
    };
  }
  if (split_dispense_current < split_dispense_total && !split_next_dispense_date) {
    return { error: 'missing_split_next_dispense_date' as const };
  }
  return null;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const status = searchParams.get('status') ?? undefined;
  const sourceType = searchParams.get('source_type') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(sourceType ? { source_type: sourceType as never } : {}),
    ...(status
      ? {
          cycle: {
            overall_status: status as never,
          },
        }
      : {}),
  };

  const intakes = await prisma.prescriptionIntake.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      cycle_id: true,
      source_type: true,
      prescribed_date: true,
      prescriber_name: true,
      prescriber_institution_id: true,
      prescriber_institution: true,
      prescription_expiry_date: true,
      refill_remaining_count: true,
      refill_next_dispense_date: true,
      created_at: true,
      cycle: {
        select: {
          overall_status: true,
          patient_id: true,
        },
      },
    },
  });

  const hasMore = intakes.length > limit;
  const data = hasMore ? intakes.slice(0, limit) : intakes;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '処方受付の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createPrescriptionIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    cycle_id,
    source_type,
    prescribed_date,
    refill_remaining_count,
    refill_next_dispense_date,
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
    lines,
    prescriber_institution_id,
    ...rest
  } = parsed.data;

  const prescribedDateObj = new Date(prescribed_date);

  // 有効期限チェック（発行日+4日）
  const expiryDate = addDays(prescribedDateObj, 4);
  const now = new Date();
  if (expiryDate < now) {
    return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
  }

  const splitValidation = validateSplitDispense({
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
  });
  if (splitValidation) {
    if (splitValidation.error === 'missing_split_dispense_fields') {
      return validationError('分割調剤は分割回数と今回回数を両方入力してください');
    }
    if (splitValidation.error === 'invalid_split_dispense_progress') {
      return validationError('今回回数は分割回数以下である必要があります', {
        split_dispense_total: splitValidation.splitDispenseTotal,
        split_dispense_current: splitValidation.splitDispenseCurrent,
      });
    }
    if (splitValidation.error === 'missing_split_next_dispense_date') {
      return validationError('分割調剤の途中回は次回調剤予定日が必須です');
    }
  }

  let result;
  try {
    result = await withOrgContext(req.orgId, async (tx) => {
      // Verify cycle belongs to this org
      const cycle = await tx.medicationCycle.findFirst({
      where: { id: cycle_id, org_id: req.orgId },
      select: {
        id: true,
        patient_id: true,
        case_: {
          select: {
            primary_pharmacist_id: true,
          },
        },
        prescription_intakes: {
          orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
          take: 1,
          select: {
            id: true,
            source_type: true,
            prescribed_date: true,
            refill_remaining_count: true,
            refill_next_dispense_date: true,
            lines: {
              select: {
                days: true,
              },
            },
          },
        },
        dispense_tasks: {
          orderBy: [{ updated_at: 'desc' }],
          take: 5,
          select: {
            results: {
              orderBy: [{ dispensed_at: 'desc' }],
              take: 1,
              select: {
                dispensed_at: true,
              },
            },
          },
        },
      },
    });
    if (!cycle) return null;

    if (source_type === 'refill') {
      if (refill_remaining_count == null || refill_remaining_count <= 0) {
        return {
          error: 'invalid_refill_remaining_count' as const,
        };
      }
      if (!refill_next_dispense_date) {
        return {
          error: 'missing_refill_next_dispense_date' as const,
        };
      }

      const previousIntake = cycle.prescription_intakes[0] ?? null;
      const previousDispensedAt =
        cycle.dispense_tasks
          .flatMap((task) => task.results)
          .sort((left, right) => right.dispensed_at.getTime() - left.dispensed_at.getTime())[0]
          ?.dispensed_at ?? null;
      const baselineDays = Math.max(
        ...(previousIntake?.lines.map((line) => line.days) ?? []),
        0
      );
      const baselineDate = previousDispensedAt ?? previousIntake?.prescribed_date ?? null;

      if (baselineDate && baselineDays > 0) {
        const targetDate = addDays(baselineDate, baselineDays);
        const windowStart = subDays(targetDate, 7);
        const windowEnd = addDays(targetDate, 7);
        const requestedDate = new Date(refill_next_dispense_date);

        if (requestedDate < windowStart || requestedDate > windowEnd) {
          return {
            error: 'refill_window_out_of_range' as const,
            windowStart,
            windowEnd,
            targetDate,
          };
        }
      }
    }

    const duplicateCandidates = collectDuplicatePrescriptionLines(lines);
    if (duplicateCandidates.length > 0) {
      return {
        error: 'duplicate_prescription_lines' as const,
        duplicates: duplicateCandidates,
      };
    }

    const structuringBlockedLines = collectStructuringBlockedLines(lines);
    if (structuringBlockedLines.length > 0) {
      const existingException = await tx.workflowException.findFirst({
        where: {
          org_id: req.orgId,
          cycle_id,
          exception_type: 'prescription_structuring_block',
          status: 'open',
        },
        select: { id: true },
      });

      if (!existingException) {
        await tx.workflowException.create({
          data: {
            org_id: req.orgId,
            cycle_id,
            exception_type: 'prescription_structuring_block',
            description: `未構造化または不明な処方明細があります: ${structuringBlockedLines.map((line) => `${line.line_number}行目 ${line.drug_name}`).join(' / ')}`,
            severity: 'warning',
            status: 'open',
          },
        });
      }

      return {
        error: 'structuring_blocked_lines' as const,
        blockedLines: structuringBlockedLines.map((line) => ({
          line_number: line.line_number,
          drug_name: line.drug_name,
        })),
      };
    }

    // Create PrescriptionIntake
    const resolvedInstitution = await resolvePrescriberInstitutionFields(tx, req.orgId, {
      prescriber_institution_id,
      prescriber_institution: rest.prescriber_institution,
    });

    const intake = await tx.prescriptionIntake.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        source_type,
        prescribed_date: prescribedDateObj,
        prescription_expiry_date: expiryDate,
        ...(source_type === 'refill' && refill_remaining_count !== undefined
          ? { refill_remaining_count }
          : {}),
        ...(source_type === 'refill' && refill_next_dispense_date
          ? { refill_next_dispense_date: new Date(refill_next_dispense_date) }
          : {}),
        ...(split_dispense_total != null ? { split_dispense_total } : {}),
        ...(split_dispense_current != null ? { split_dispense_current } : {}),
        ...(split_next_dispense_date
          ? { split_next_dispense_date: new Date(split_next_dispense_date) }
          : {}),
        ...rest,
        prescriber_institution_id: resolvedInstitution.prescriber_institution_id,
        prescriber_institution: resolvedInstitution.prescriber_institution,
        lines: {
          create: lines.map((line) => ({
            org_id: req.orgId,
            ...line,
          })),
        },
      },
      include: { lines: true },
    });

    const unresolvedInquiryCount =
      typeof tx.inquiryRecord?.count === 'function'
        ? await tx.inquiryRecord.count({
            where: {
              org_id: req.orgId,
              cycle_id,
              resolved_at: null,
            },
          })
        : 0;
    const existingDispenseTask =
      typeof tx.dispenseTask?.findFirst === 'function'
        ? await tx.dispenseTask.findFirst({
            where: {
              org_id: req.orgId,
              cycle_id,
              status: {
                in: ['pending', 'in_progress'],
              },
            },
            select: { id: true },
          })
        : null;
    const shouldMoveToDispensing = unresolvedInquiryCount === 0;
    const shouldAutoCreateDispenseTask =
      shouldMoveToDispensing && !existingDispenseTask;

    if (
      shouldAutoCreateDispenseTask &&
      typeof tx.dispenseTask?.create === 'function'
    ) {
      await tx.dispenseTask.create({
        data: {
          org_id: req.orgId,
          cycle_id,
          assigned_to: cycle.case_?.primary_pharmacist_id ?? null,
          priority: 'normal',
          status: 'pending',
        },
      });
    }

    // Update MedicationCycle status to intake_received or dispensing
    await tx.medicationCycle.update({
      where: { id: cycle_id },
      data: {
        overall_status: shouldMoveToDispensing ? 'dispensing' : 'intake_received',
      },
    });

      return intake;
    });
  } catch (error) {
    if (error instanceof PrescriberInstitutionReferenceValidationError) {
      return validationError(error.message);
    }
    throw error;
  }

  if (!result) {
    return validationError('指定されたサイクルが見つかりません');
  }
  if ('error' in result) {
    if (result.error === 'duplicate_prescription_lines') {
      return validationError('重複候補の処方明細があるため受付できません', {
        duplicates: result.duplicates,
      });
    }
    if (result.error === 'structuring_blocked_lines') {
      return validationError('未構造化または不明な処方明細があるため受付を完了できません', {
        blocked_lines: result.blockedLines,
      });
    }
    if (result.error === 'invalid_refill_remaining_count') {
      return validationError('リフィル処方箋は残回数を1回以上設定してください');
    }
    if (result.error === 'missing_refill_next_dispense_date') {
      return validationError('リフィル処方箋は次回調剤予定日が必須です');
    }
    if (result.error === 'refill_window_out_of_range') {
      return validationError('リフィル処方箋の次回調剤予定日が調剤可能ウィンドウ外です', {
        target_date: format(result.targetDate, 'yyyy-MM-dd'),
        window_start: format(result.windowStart, 'yyyy-MM-dd'),
        window_end: format(result.windowEnd, 'yyyy-MM-dd'),
      });
    }
  }

  return success(result, 201);
}, {
  permission: 'canVisit',
  message: '処方受付の作成権限がありません',
});
