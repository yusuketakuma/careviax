import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject } from '@/lib/db/json';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  createPrescriptionIntakeInTx,
  PrescriptionIntakeTransactionRollback,
  runPrescriptionIntakePostCreateHooks,
} from '@/server/services/prescription-intake-service';
import { PrescriberInstitutionReferenceValidationError } from '@/lib/prescriptions/prescriber-institutions';
import {
  attachJahisPrescriptionInsuranceSidecarToIntake,
  attachJahisSupplementalRecordsToIntake,
  createMedicationIssueCandidatesFromPrescriptionInsurance,
  createMedicationIssueCandidatesFromJahisSupplementalRecords,
  readJahisPrescriptionInsurance,
  readJahisSupplementalRecords,
} from '@/server/services/jahis-supplemental-records';
import {
  assessQrPatientIdentity,
  type QrPatientIdentityMismatch,
  type QrPatientIdentityMissingField,
  readQrPatientIdentityFromDraftParsedData,
} from '@/lib/pharmacy/qr-patient-match';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { z } from 'zod';
import { validatePrescriptionDateWindow } from '@/lib/prescription/prescription-date-window';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  collectDispensingLineMetadataValidationDetails,
  validatePackagingInstructionConsistency,
} from '@/lib/validations/dispensing-line';
import {
  QR_DRAFT_DISPENSING_METHOD_VALUES,
  QR_DRAFT_PACKAGING_METHOD_VALUES,
  QR_DRAFT_PACKAGING_TAG_VALUES,
  QR_DRAFT_ROUTE_VALUES,
  collectDrugCodeResolutionReviewDetails,
  enrichQrDraftLineFromParsedData,
  findQrDraftLineMismatches,
  readQrDraftString,
} from '@/lib/prescription/qr-draft-line-readers';
import {
  buildQrDraftAssignmentWhere,
  canAccessPrescriptionPatient,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';

const requiredTrimmedStringSchema = z.string().trim().min(1);

const optionalTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().optional(),
);
const requiredDateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const optionalDateStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  requiredDateStringSchema.optional(),
);
const prescriptionRouteSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().pipe(z.enum(QR_DRAFT_ROUTE_VALUES)).optional(),
);
const dispensingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().pipe(z.enum(QR_DRAFT_DISPENSING_METHOD_VALUES)).optional(),
);
const packagingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().pipe(z.enum(QR_DRAFT_PACKAGING_METHOD_VALUES)).optional(),
);
const packagingInstructionTagSchema = z.enum(QR_DRAFT_PACKAGING_TAG_VALUES);

const confirmQrDraftLineSchema = z
  .object({
    drug_name: requiredTrimmedStringSchema,
    drug_master_id: optionalTrimmedStringSchema,
    drug_code: optionalTrimmedStringSchema,
    dosage_form: optionalTrimmedStringSchema,
    dose: requiredTrimmedStringSchema,
    frequency: requiredTrimmedStringSchema,
    days: z.number().int().min(1),
    quantity: z.number().finite().positive().optional(),
    unit: optionalTrimmedStringSchema,
    is_generic: z.boolean().optional(),
    packaging_method: packagingMethodSchema,
    packaging_instructions: optionalTrimmedStringSchema,
    packaging_instruction_tags: z.array(packagingInstructionTagSchema).optional(),
    route: prescriptionRouteSchema,
    dispensing_method: dispensingMethodSchema,
    start_date: optionalDateStringSchema,
    end_date: optionalDateStringSchema,
    notes: optionalTrimmedStringSchema,
  })
  .superRefine((line, ctx) => {
    if (line.start_date && line.end_date && line.start_date > line.end_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: '終了日は開始日以降にしてください',
      });
    }
    validatePackagingInstructionConsistency(line, ctx);
  });

const confirmQrDraftSchema = z.object({
  patient_id: requiredTrimmedStringSchema,
  case_id: requiredTrimmedStringSchema,
  lines: z.array(confirmQrDraftLineSchema).min(1),
  prescribed_date: requiredDateStringSchema,
  prescriber_name: optionalTrimmedStringSchema,
  prescriber_institution_id: optionalTrimmedStringSchema,
  prescriber_institution: optionalTrimmedStringSchema,
});

type IntakeInTxResult = Awaited<ReturnType<typeof createPrescriptionIntakeInTx>>;
type IntakeInTxSuccessResult = Extract<IntakeInTxResult, { kind: 'intake' }>;
type IntakeInTxErrorResult = Extract<IntakeInTxResult, { kind: 'error' }>;
type PostCreateHookLine = Parameters<
  typeof runPrescriptionIntakePostCreateHooks
>[0]['lines'][number];
type QrDraftConfirmResult =
  | { kind: 'not_found' }
  | { kind: 'already_processed' }
  | { kind: 'patient_mismatch' }
  | { kind: 'patient_identity_mismatch'; mismatches: QrPatientIdentityMismatch[] }
  | { kind: 'patient_identity_unverifiable'; missing: QrPatientIdentityMissingField[] }
  | { kind: 'line_mismatch'; mismatches: string[] }
  | { kind: 'line_validation_error'; details: Record<string, string[]> }
  | { kind: 'claim_conflict' }
  | {
      kind: 'confirmed';
      draft: { scanned_by: string | null };
      intake: IntakeInTxSuccessResult['intake'];
      cycle: IntakeInTxSuccessResult['cycle'];
      hookLines: PostCreateHookLine[];
    };

class QrDraftConfirmRollback extends Error {
  constructor(readonly result: IntakeInTxErrorResult) {
    super('QR draft confirmation rolled back');
  }
}

function createIntakeErrorResponse(result: IntakeInTxErrorResult) {
  if (result.error === 'cycle_not_found') {
    return validationError('指定されたサイクルが見つかりません');
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
  if (result.error === 'invalid_drug_master_id') {
    return validationError('存在するYJコード付き医薬品マスターを選択してください', {
      drug_master_id: ['存在するYJコード付き医薬品マスターを選択してください'],
    });
  }
  if (result.error === 'invalid_refill_remaining_count') {
    return validationError('リフィル処方箋は残回数を1回以上設定してください');
  }
  if (result.error === 'missing_refill_next_dispense_date') {
    return validationError('リフィル処方箋は次回調剤予定日が必須です');
  }
  if (result.error === 'refill_window_out_of_range') {
    return validationError('リフィル処方箋の次回調剤予定日が調剤可能ウィンドウ外です');
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
    return conflict('他のユーザーによって更新されています。再読み込みしてください');
  }
  return validationError('処方受付の作成に失敗しました');
}

function validateConfirmPrescriptionDate(prescribedDate: string) {
  return validatePrescriptionDateWindow(prescribedDate);
}

function buildConfirmedParsedData(confirmedIntakeId: string) {
  return {
    confirmed: true,
    confirmed_at: new Date().toISOString(),
    confirmed_intake_id: confirmedIntakeId,
  };
}

export const POST = withAuthContext(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('QRスキャン下書きIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = confirmQrDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      patient_id,
      case_id,
      lines,
      prescribed_date,
      prescriber_name,
      prescriber_institution_id,
      prescriber_institution,
    } = parsed.data;

    const dateWindow = validateConfirmPrescriptionDate(prescribed_date);
    if (!dateWindow.ok && dateWindow.reason === 'expiry_exceeded') {
      return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
    }
    if (!dateWindow.ok && dateWindow.reason === 'future_prescribed_date') {
      return validationError('未来日の処方箋は登録できません');
    }

    if (!(await canAccessPrescriptionPatient(prisma, ctx.orgId, ctx, patient_id))) {
      return validationError('この患者のQRスキャン下書きを確定する権限がありません');
    }

    const targetPatient = await prisma.patient.findFirst({
      where: { id: patient_id, org_id: ctx.orgId },
      select: { id: true, name: true, name_kana: true, birth_date: true, gender: true },
    });
    if (!targetPatient) {
      return validationError('指定された患者が見つかりません', {
        patient_id: ['指定された患者が見つかりません'],
      });
    }

    const assignedPatientIds = await getAssignedPatientIds(prisma, ctx.orgId, ctx);
    const assignmentWhere = buildQrDraftAssignmentWhere(ctx, assignedPatientIds ?? []);

    let result: QrDraftConfirmResult;
    try {
      result = await withOrgContext(ctx.orgId, async (tx) => {
        const draft = await tx.qrScanDraft.findFirst({
          where: {
            id,
            org_id: ctx.orgId,
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            status: true,
            org_id: true,
            patient_id: true,
            scanned_by: true,
            qr_payload_hash: true,
            parsed_data: true,
          },
        });

        if (!draft) {
          return { kind: 'not_found' as const };
        }

        if (draft.status !== 'pending') {
          return { kind: 'already_processed' as const };
        }

        if (draft.patient_id && draft.patient_id !== patient_id) {
          return { kind: 'patient_mismatch' as const };
        }

        const parsedData = readJsonObject(draft.parsed_data);
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

        const lineMismatches = findQrDraftLineMismatches(parsed.data, parsedData);
        if (lineMismatches.length > 0) {
          return { kind: 'line_mismatch' as const, mismatches: lineMismatches };
        }

        const drugCodeResolutionDetails = collectDrugCodeResolutionReviewDetails(
          parsedData,
          parsed.data,
        );
        if (drugCodeResolutionDetails) {
          return {
            kind: 'line_validation_error' as const,
            details: drugCodeResolutionDetails,
          };
        }

        const intakeInput = {
          case_id,
          patient_id,
          source_type: 'qr_scan' as const,
          prescribed_date,
          prescription_expiry_date: readQrDraftString(parsedData?.prescriptionExpirationDate),
          prescriber_name,
          prescriber_institution_id,
          prescriber_institution,
          lines: lines.map((line, index) => ({
            line_number: index + 1,
            ...enrichQrDraftLineFromParsedData(line, parsedData, index),
          })),
        };
        const lineValidationDetails = collectDispensingLineMetadataValidationDetails(
          intakeInput.lines,
        );
        if (lineValidationDetails) {
          return { kind: 'line_validation_error' as const, details: lineValidationDetails };
        }

        const claimResult = await tx.qrScanDraft.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
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
          ctx.orgId,
          ctx.userId,
          {
            skipStructuringCheck: true,
            accessContext: { userId: ctx.userId, role: ctx.role },
          },
        );

        if (intakeResult.kind === 'error') {
          throw new QrDraftConfirmRollback(intakeResult);
        }

        const supplementalRecords = readJahisSupplementalRecords(parsedData?.supplementalRecords);
        const prescriptionInsurance = readJahisPrescriptionInsurance(
          parsedData?.prescriptionInsurance,
        );

        await attachJahisSupplementalRecordsToIntake(tx, {
          orgId: ctx.orgId,
          patientId: patient_id,
          qrDraftId: id,
          prescriptionIntakeId: intakeResult.intake.id,
          fallbackRecords: supplementalRecords,
        });

        await attachJahisPrescriptionInsuranceSidecarToIntake(tx, {
          orgId: ctx.orgId,
          patientId: patient_id,
          qrDraftId: id,
          prescriptionIntakeId: intakeResult.intake.id,
          prescriptionInsurance,
        });

        await createMedicationIssueCandidatesFromPrescriptionInsurance(tx, {
          orgId: ctx.orgId,
          patientId: patient_id,
          caseId: case_id,
          prescriptionIntakeId: intakeResult.intake.id,
          identifiedBy: ctx.userId,
          prescriptionInsurance,
        });

        await createMedicationIssueCandidatesFromJahisSupplementalRecords(tx, {
          orgId: ctx.orgId,
          patientId: patient_id,
          caseId: case_id,
          prescriptionIntakeId: intakeResult.intake.id,
          identifiedBy: ctx.userId,
          records: supplementalRecords,
        });

        await tx.qrScanDraft.update({
          where: { id },
          data: {
            patient_id,
            status: 'confirmed',
            confirmed_intake_id: intakeResult.intake.id,
            raw_qr_texts: [],
            qr_payload_hash: null,
            parsed_data: buildConfirmedParsedData(intakeResult.intake.id),
            parse_errors: Prisma.JsonNull,
            auto_completed: Prisma.JsonNull,
            expected_qr_count: null,
          },
        });

        return {
          kind: 'confirmed' as const,
          draft,
          intake: intakeResult.intake,
          cycle: intakeResult.cycle,
          hookLines: intakeResult.intake.lines,
        };
      });
    } catch (error) {
      if (error instanceof QrDraftConfirmRollback) {
        return createIntakeErrorResponse(error.result);
      }
      if (error instanceof PrescriptionIntakeTransactionRollback) {
        return createIntakeErrorResponse(error.result);
      }
      if (error instanceof PrescriberInstitutionReferenceValidationError) {
        return validationError(error.message);
      }
      throw error;
    }

    if (result.kind === 'not_found') {
      return notFound('QRスキャン下書きが見つかりません');
    }

    if (result.kind === 'already_processed') {
      return validationError('このQRスキャン下書きはすでに処理済みです');
    }

    if (result.kind === 'patient_mismatch') {
      return validationError('QRスキャン下書きに紐付く患者と確定先患者が一致しません', {
        patient_id: ['QRスキャン下書きに紐付く患者と確定先患者が一致しません'],
      });
    }

    if (result.kind === 'patient_identity_mismatch') {
      return validationError('QRコードの患者情報が選択患者と一致しません', {
        patient_id: ['QRコードの患者情報が選択患者と一致しません'],
        mismatches: result.mismatches,
      });
    }

    if (result.kind === 'patient_identity_unverifiable') {
      return validationError('QRコードの患者情報を確認できません', {
        patient_id: ['QRコードの患者名と生年月日を確認できません'],
        missing_identity: result.missing,
      });
    }

    if (result.kind === 'line_mismatch') {
      return validationError('QR下書きの処方明細と送信された処方明細が一致しません', {
        qr_draft_id: ['QR下書きの処方明細を再読み込みして確認してください'],
        mismatches: result.mismatches,
      });
    }

    if (result.kind === 'line_validation_error') {
      return validationError('入力値が不正です', result.details);
    }

    if (result.kind === 'claim_conflict') {
      return conflict('このQRスキャン下書きはすでに処理済みです');
    }

    const { medicationChanges, profileSyncResult } = await runPrescriptionIntakePostCreateHooks({
      cycleId: result.cycle.id,
      intakeId: result.intake.id,
      patientId: result.cycle.patient_id,
      orgId: ctx.orgId,
      userId: ctx.userId,
      lines: result.hookLines,
      prescriberName: prescriber_name ?? null,
      sourceType: 'qr_scan',
    });

    try {
      await notifyWebhookEventForOrg(ctx.orgId, 'prescription.created', {
        intakeId: result.intake.id,
        cycleId: result.cycle.id,
        patientId: result.cycle.patient_id,
        sourceType: 'qr_scan',
        lineCount: result.intake.lines.length,
      });
    } catch {
      // Webhook delivery is best-effort and must not fail a committed intake.
    }

    // Cross-user confirmation audit log (best-effort)
    if (result.draft.scanned_by && result.draft.scanned_by !== ctx.userId) {
      try {
        await withOrgContext(ctx.orgId, async (tx) => {
          return tx.cycleTransitionLog.create({
            data: {
              org_id: ctx.orgId,
              cycle_id: result.cycle.id,
              from_status: 'qr_cross_user_confirm',
              to_status: 'qr_cross_user_confirm',
              actor_id: ctx.userId,
              note: `QR下書き確定: スキャン者=${result.draft.scanned_by}, 確定者=${ctx.userId}`,
            },
          });
        });
      } catch {
        // Audit log is best-effort
      }
    }

    // Broadcast realtime event (best-effort)
    await broadcastOrgRealtimeEvent({
      orgId: ctx.orgId,
      type: 'qr_draft_confirmed',
    });

    return success(
      {
        intake: result.intake,
        cycle: result.cycle,
        medicationChanges,
        profileSyncResult,
      },
      201,
    );
  },
  {
    permission: 'canVisit',
    message: '処方受付の作成権限がありません',
  },
);
