import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { format } from 'date-fns';
import { createPrescriptionIntake } from '@/server/services/prescription-intake-service';

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
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
          case_: {
            select: {
              patient: {
                select: { id: true, name: true, name_kana: true },
              },
            },
          },
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
    case_id,
    patient_id,
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
    source_type,
  } = parsed.data;

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

  if (!cycle_id) {
    const refResult = await validateOrgReferences(req.orgId, {
      case_id,
      patient_id,
    });
    if (!refResult.ok) return refResult.response;
  }

  const result = await createPrescriptionIntake(
    parsed.data,
    req.orgId,
    req.userId,
    {
      skipStructuringCheck: source_type === 'qr_scan',
    }
  );

  if (!result.ok) {
    if (result.error === 'cycle_not_found') {
      return validationError(
        cycle_id
          ? '指定されたサイクルが見つかりません'
          : '指定された患者またはケースが見つかりません'
      );
    }
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
    if (result.error === 'expiry_exceeded') {
      return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
    }
    if (result.error === 'prescriber_institution_not_found') {
      return validationError(result.message);
    }
    if (result.error === 'invalid_transition') {
      return validationError('サイクルの状態遷移が無効です');
    }
    if (result.error === 'version_conflict') {
      return validationError('他のユーザーによって更新されています。再読み込みしてください');
    }
  }

  return success(result.intake, 201);
}, {
  permission: 'canVisit',
  message: '処方受付の作成権限がありません',
});
