import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError, conflict } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import {
  MEDICATION_CYCLE_STATUSES,
  PRESCRIPTION_SOURCE_TYPES,
} from '@/lib/prescription/intake-filters';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { format } from 'date-fns';
import { z } from 'zod';
import {
  createPrescriptionIntake,
  createPrescriptionIntakeInTx,
  PrescriptionIntakeTransactionRollback,
  runPrescriptionIntakePostCreateHooks,
} from '@/server/services/prescription-intake-service';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { PrescriberInstitutionReferenceValidationError } from '@/lib/prescriptions/prescriber-institutions';
import {
  buildQrDraftAssignmentWhere,
  buildPrescriptionIntakeAssignmentWhere,
  canAccessPrescriptionPatient,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import {
  attachJahisSupplementalRecordsToIntake,
  readJahisSupplementalRecords,
} from '@/server/services/jahis-supplemental-records';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import {
  assessQrPatientIdentity,
  readQrPatientIdentityFromDraftParsedData,
} from '@/lib/pharmacy/qr-patient-match';

const prescriptionSourceTypeSchema = z.enum(PRESCRIPTION_SOURCE_TYPES);
const medicationCycleStatusSchema = z.enum(MEDICATION_CYCLE_STATUSES);

type CreatePrescriptionIntakeInput = z.infer<typeof createPrescriptionIntakeSchema>;
type IntakeInTxResult = Awaited<ReturnType<typeof createPrescriptionIntakeInTx>>;
type IntakeInTxSuccessResult = Extract<IntakeInTxResult, { kind: 'intake' }>;
type IntakeInTxErrorResult = Extract<IntakeInTxResult, { kind: 'error' }>;

class PrescriptionIntakeRollback extends Error {
  constructor(readonly result: IntakeInTxErrorResult) {
    super('Prescription intake creation rolled back');
  }
}

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

const PACKAGING_METHOD_VALUES = [
  'none',
  'unit_dose',
  'morning_evening_unit_dose',
  'medication_box',
  'calendar_pack',
  'blister_pack',
  'crush_and_pack',
  'other',
] as const;
const PACKAGING_TAG_VALUES = [
  'cold_storage',
  'narcotic',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'unit_dose',
  'staple_required',
  'label_required',
] as const;
const ROUTE_VALUES = ['internal', 'external', 'injection', 'other'] as const;
const DISPENSING_METHOD_VALUES = ['standard', 'unit_dose', 'crushed', 'other'] as const;

function readDraftLineAt(parsedData: Record<string, unknown> | null | undefined, index: number) {
  const lines = Array.isArray(parsedData?.lines) ? parsedData.lines : [];
  const line = lines[index];
  return readJsonObject(line);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((item): string[] => {
    const text = readString(item);
    return text ? [text] : [];
  });
  return values.length > 0 ? values : undefined;
}

function readEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  const text = readString(value);
  return text && (allowed as readonly string[]).includes(text) ? (text as T[number]) : undefined;
}

function readEnumArray<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number][] | undefined {
  const values = readStringArray(value)?.filter((item): item is T[number] =>
    (allowed as readonly string[]).includes(item),
  );
  return values && values.length > 0 ? values : undefined;
}

function enrichQrIntakeInputFromDraft(
  input: CreatePrescriptionIntakeInput,
  parsedData: Record<string, unknown> | null | undefined,
): CreatePrescriptionIntakeInput {
  return {
    ...input,
    prescription_expiry_date:
      input.prescription_expiry_date ?? readString(parsedData?.prescriptionExpirationDate),
    lines: input.lines.map((line, index) => {
      const draftLine = readDraftLineAt(parsedData, index);
      return {
        ...line,
        drug_code: line.drug_code ?? readString(draftLine?.drugCode),
        dosage_form: line.dosage_form ?? readString(draftLine?.dosageForm),
        unit: line.unit ?? readString(draftLine?.unit),
        is_generic: line.is_generic || Boolean(draftLine?.isGeneric),
        packaging_method:
          line.packaging_method ??
          readEnumValue(draftLine?.packagingMethod, PACKAGING_METHOD_VALUES),
        packaging_instructions:
          line.packaging_instructions ?? readString(draftLine?.packagingInstructions),
        packaging_instruction_tags:
          line.packaging_instruction_tags ??
          readEnumArray(draftLine?.packagingInstructionTags, PACKAGING_TAG_VALUES),
        route: line.route ?? readEnumValue(draftLine?.route, ROUTE_VALUES),
        dispensing_method:
          line.dispensing_method ??
          readEnumValue(draftLine?.dispensingMethod, DISPENSING_METHOD_VALUES),
        start_date: line.start_date ?? readString(draftLine?.startDate),
        end_date: line.end_date ?? readString(draftLine?.endDate),
        notes: line.notes ?? readString(draftLine?.notes),
      };
    }),
  };
}

function createIntakeErrorResponse(result: IntakeInTxErrorResult, cycleId: string | undefined) {
  if (result.error === 'cycle_not_found') {
    return validationError(
      cycleId ? '指定されたサイクルが見つかりません' : '指定された患者またはケースが見つかりません',
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
  if (result.error === 'outpatient_injection_not_eligible') {
    return validationError('外来/在宅自己注射として調剤可否が未確認の注射剤があります', {
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
  if (result.error === 'future_prescribed_date') {
    return validationError('未来日の処方箋は登録できません');
  }
  if (result.error === 'invalid_transition') {
    return validationError('サイクルの状態遷移が無効です');
  }
  if (result.error === 'version_conflict') {
    return validationError('他のユーザーによって更新されています。再読み込みしてください');
  }
  return validationError('処方受付の作成に失敗しました');
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
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPrescriptionIntakeSchema.safeParse(payload);
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

    if (qr_draft_id && source_type !== 'qr_scan') {
      return validationError('QRスキャン下書きからの登録はQRスキャンの受付種別のみ指定できます', {
        source_type: ['QRスキャン下書きからの登録では qr_scan を指定してください'],
      });
    }

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

    if (qr_draft_id) {
      if (!patient_id || !case_id) {
        return validationError('QRスキャン下書きからの登録には患者IDとケースIDが必要です');
      }

      const targetPatient = await prisma.patient.findFirst({
        where: { id: patient_id, org_id: req.orgId },
        select: { id: true, name: true, name_kana: true, birth_date: true, gender: true },
      });
      if (!targetPatient) {
        return validationError('指定された患者が見つかりません', {
          patient_id: ['指定された患者が見つかりません'],
        });
      }

      const assignedPatientIds = await getAssignedPatientIds(prisma, req.orgId, req);
      const assignmentWhere = buildQrDraftAssignmentWhere(req, assignedPatientIds ?? []);
      let intakeInput = { ...parsed.data };
      delete intakeInput.qr_draft_id;

      let qrResult:
        | { kind: 'not_found' }
        | { kind: 'already_processed' }
        | { kind: 'patient_mismatch' }
        | { kind: 'patient_identity_mismatch'; mismatches: string[] }
        | { kind: 'patient_identity_unverifiable'; missing: string[] }
        | { kind: 'claim_conflict' }
        | {
            kind: 'created';
            intake: IntakeInTxSuccessResult['intake'];
            cycle: IntakeInTxSuccessResult['cycle'];
          };

      try {
        qrResult = await withOrgContext(req.orgId, async (tx) => {
          const qrDraft = await tx.qrScanDraft.findFirst({
            where: {
              id: qr_draft_id,
              org_id: req.orgId,
              ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
            },
            select: {
              id: true,
              status: true,
              patient_id: true,
              parsed_data: true,
            },
          });

          if (!qrDraft) {
            return { kind: 'not_found' as const };
          }

          if (qrDraft.status !== 'pending') {
            return { kind: 'already_processed' as const };
          }

          if (qrDraft.patient_id && qrDraft.patient_id !== patient_id) {
            return { kind: 'patient_mismatch' as const };
          }

          const parsedData = readJsonObject(qrDraft.parsed_data);
          intakeInput = enrichQrIntakeInputFromDraft(intakeInput, parsedData);
          const identityAssessment = assessQrPatientIdentity(
            readQrPatientIdentityFromDraftParsedData(parsedData),
            targetPatient,
          );
          if (identityAssessment.kind === 'unverifiable') {
            return {
              kind: 'patient_identity_unverifiable' as const,
              missing: identityAssessment.missing,
            };
          }
          if (identityAssessment.kind === 'mismatch') {
            return {
              kind: 'patient_identity_mismatch' as const,
              mismatches: identityAssessment.mismatches,
            };
          }

          const claimResult = await tx.qrScanDraft.updateMany({
            where: {
              id: qrDraft.id,
              org_id: req.orgId,
              status: 'pending',
              ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
            },
            data: {
              patient_id,
              status: 'confirmed',
            },
          });

          if (claimResult.count === 0) {
            return { kind: 'claim_conflict' as const };
          }

          const intakeResult = await createPrescriptionIntakeInTx(
            tx,
            intakeInput,
            req.orgId,
            req.userId,
            {
              skipStructuringCheck: source_type === 'qr_scan',
              accessContext: { userId: req.userId, role: req.role },
            },
          );

          if (intakeResult.kind === 'error') {
            throw new PrescriptionIntakeRollback(intakeResult);
          }

          const supplementalRecords = readJahisSupplementalRecords(parsedData?.supplementalRecords);
          await attachJahisSupplementalRecordsToIntake(tx, {
            orgId: req.orgId,
            patientId: patient_id,
            qrDraftId: qrDraft.id,
            prescriptionIntakeId: intakeResult.intake.id,
            fallbackRecords: supplementalRecords,
          });

          await tx.qrScanDraft.update({
            where: { id: qrDraft.id },
            data: {
              patient_id,
              status: 'confirmed',
              confirmed_intake_id: intakeResult.intake.id,
            },
          });

          return {
            kind: 'created' as const,
            intake: intakeResult.intake,
            cycle: intakeResult.cycle,
          };
        });
      } catch (error) {
        if (error instanceof PrescriptionIntakeRollback) {
          return createIntakeErrorResponse(error.result, cycle_id);
        }
        if (error instanceof PrescriptionIntakeTransactionRollback) {
          return createIntakeErrorResponse(error.result, cycle_id);
        }
        if (error instanceof PrescriberInstitutionReferenceValidationError) {
          return validationError(error.message);
        }
        throw error;
      }

      if (qrResult.kind === 'not_found') {
        return validationError('QRスキャン下書きが見つかりません', {
          qr_draft_id: ['QRスキャン下書きが見つかりません'],
        });
      }
      if (qrResult.kind === 'already_processed') {
        return validationError('このQRスキャン下書きはすでに処理済みです', {
          qr_draft_id: ['このQRスキャン下書きはすでに処理済みです'],
        });
      }
      if (qrResult.kind === 'patient_mismatch') {
        return validationError('QRスキャン下書きに紐付く患者と登録先患者が一致しません', {
          patient_id: ['QRスキャン下書きに紐付く患者と登録先患者が一致しません'],
        });
      }
      if (qrResult.kind === 'patient_identity_mismatch') {
        return validationError('QRコードの患者情報が選択患者と一致しません', {
          patient_id: ['QRコードの患者情報が選択患者と一致しません'],
          mismatches: qrResult.mismatches,
        });
      }
      if (qrResult.kind === 'patient_identity_unverifiable') {
        return validationError('QRコードの患者情報を確認できません', {
          patient_id: ['QRコードの患者名と生年月日を確認できません'],
          missing_identity: qrResult.missing,
        });
      }
      if (qrResult.kind === 'claim_conflict') {
        return conflict('このQRスキャン下書きはすでに処理済みです');
      }

      await runPrescriptionIntakePostCreateHooks({
        cycleId: qrResult.cycle.id,
        intakeId: qrResult.intake.id,
        patientId: qrResult.cycle.patient_id,
        orgId: req.orgId,
        lines: intakeInput.lines,
        prescriberName: intakeInput.prescriber_name ?? null,
        sourceType: source_type,
      });

      try {
        await notifyWebhookEventForOrg(req.orgId, 'prescription.created', {
          intakeId: qrResult.intake.id,
          cycleId: qrResult.cycle.id,
          patientId: qrResult.cycle.patient_id,
          sourceType: source_type,
          lineCount: qrResult.intake.lines.length,
        });
      } catch {
        // Webhook delivery is best-effort and must not fail a committed intake.
      }

      await broadcastOrgRealtimeEvent({
        orgId: req.orgId,
        type: 'qr_draft_confirmed',
      });

      return success(qrResult.intake, 201);
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
      if (result.error === 'outpatient_injection_not_eligible') {
        return validationError('外来/在宅自己注射として調剤可否が未確認の注射剤があります', {
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
      if (result.error === 'future_prescribed_date') {
        return validationError('未来日の処方箋は登録できません');
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
  },
  {
    permission: 'canVisit',
    message: '処方受付の作成権限がありません',
  },
);
