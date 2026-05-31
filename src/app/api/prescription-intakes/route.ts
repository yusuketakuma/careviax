import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import {
  MEDICATION_CYCLE_STATUSES,
  PRESCRIPTION_SOURCE_TYPES,
} from '@/lib/prescription/intake-filters';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { format } from 'date-fns';
import { z } from 'zod';
import { createPrescriptionIntake } from '@/server/services/prescription-intake-service';
import {
  buildPrescriptionIntakeAssignmentWhere,
  canAccessPrescriptionPatient,
} from '@/server/services/prescription-access';
import {
  attachJahisSupplementalRecordsToIntake,
  readJahisSupplementalRecords,
} from '@/server/services/jahis-supplemental-records';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';

const prescriptionSourceTypeSchema = z.enum(PRESCRIPTION_SOURCE_TYPES);
const medicationCycleStatusSchema = z.enum(MEDICATION_CYCLE_STATUSES);

function validateSplitDispense(input: {
  split_dispense_total?: number;
  split_dispense_current?: number;
  split_next_dispense_date?: string;
}) {
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

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const statusParam = searchParams.get('status') ?? undefined;
    const sourceTypeParam = searchParams.get('source_type') ?? undefined;
    const status = statusParam ? medicationCycleStatusSchema.safeParse(statusParam) : null;
    const sourceType = sourceTypeParam
      ? prescriptionSourceTypeSchema.safeParse(sourceTypeParam)
      : null;
    if (status && !status.success) {
      return validationError('処方受付ステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }
    if (sourceType && !sourceType.success) {
      return validationError('処方受付ソース種別が不正です', {
        source_type: ['対応していないソース種別です'],
      });
    }
    const includeTotal = searchParams.get('include_total') === '1';
    const assignmentWhere = buildPrescriptionIntakeAssignmentWhere(req);

    const where = {
      org_id: req.orgId,
      ...(sourceType ? { source_type: sourceType.data } : {}),
      ...(status
        ? {
            cycle: {
              overall_status: status.data,
            },
          }
        : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const [intakes, totalCount] = await Promise.all([
      prisma.prescriptionIntake.findMany({
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
      }),
      includeTotal ? prisma.prescriptionIntake.count({ where }) : Promise.resolve(undefined),
    ]);

    const hasMore = intakes.length > limit;
    const data = hasMore ? intakes.slice(0, limit) : intakes;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({
      data,
      hasMore,
      nextCursor,
      ...(includeTotal ? { totalCount } : {}),
    });
  },
  {
    permission: 'canVisit',
    message: '処方受付の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
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
      qr_draft_id,
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
    if (patient_id && !(await canAccessPrescriptionPatient(prisma, req.orgId, req, patient_id))) {
      return validationError('この患者の処方受付を作成する権限がありません');
    }

    const qrDraft = qr_draft_id
      ? await withOrgContext(req.orgId, async (tx) =>
          tx.qrScanDraft.findFirst({
            where: { id: qr_draft_id, org_id: req.orgId },
            select: {
              id: true,
              status: true,
              patient_id: true,
              parsed_data: true,
            },
          }),
        )
      : null;

    if (qr_draft_id && !qrDraft) {
      return validationError('QRスキャン下書きが見つかりません', {
        qr_draft_id: ['QRスキャン下書きが見つかりません'],
      });
    }

    if (qrDraft && qrDraft.status !== 'pending') {
      return validationError('このQRスキャン下書きはすでに処理済みです', {
        qr_draft_id: ['このQRスキャン下書きはすでに処理済みです'],
      });
    }

    if (qrDraft?.patient_id && patient_id && qrDraft.patient_id !== patient_id) {
      return validationError('QRスキャン下書きに紐付く患者と登録先患者が一致しません', {
        patient_id: ['QRスキャン下書きに紐付く患者と登録先患者が一致しません'],
      });
    }

    const result = await createPrescriptionIntake(parsed.data, req.orgId, req.userId, {
      skipStructuringCheck: source_type === 'qr_scan',
      accessContext: { userId: req.userId, role: req.role },
    });

    if (!result.ok) {
      if (result.error === 'cycle_not_found') {
        return validationError(
          cycle_id
            ? '指定されたサイクルが見つかりません'
            : '指定された患者またはケースが見つかりません',
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

    if (qrDraft && patient_id) {
      const parsedData = readJsonObject(qrDraft.parsed_data);
      const supplementalRecords = readJahisSupplementalRecords(parsedData?.supplementalRecords);

      await withOrgContext(req.orgId, async (tx) => {
        await attachJahisSupplementalRecordsToIntake(tx, {
          orgId: req.orgId,
          patientId: patient_id,
          qrDraftId: qrDraft.id,
          prescriptionIntakeId: result.intake.id,
          fallbackRecords: supplementalRecords,
        });

        return tx.qrScanDraft.update({
          where: { id: qrDraft.id },
          data: {
            patient_id,
            status: 'confirmed',
            confirmed_intake_id: result.intake.id,
          },
        });
      });

      await broadcastOrgRealtimeEvent({
        orgId: req.orgId,
        type: 'qr_draft_confirmed',
      });
    }

    return success(result.intake, 201);
  },
  {
    permission: 'canVisit',
    message: '処方受付の作成権限がありません',
  },
);
