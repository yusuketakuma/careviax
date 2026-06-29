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
  buildQrDraftAssignmentWhere,
  canAccessPrescriptionPatient,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';
import {
  PACKAGING_INSTRUCTION_TAG_OPTIONS,
  PACKAGING_METHOD_OPTIONS,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/dispensing/packaging';

const requiredTrimmedStringSchema = z.string().trim().min(1);
const PACKAGING_METHOD_VALUES = PACKAGING_METHOD_OPTIONS.map((option) => option.value) as [
  PackagingMethodValue,
  ...PackagingMethodValue[],
];
const PACKAGING_TAG_VALUES = PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => option.value) as [
  PackagingInstructionTagValue,
  ...PackagingInstructionTagValue[],
];

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
  z
    .string()
    .trim()
    .pipe(z.enum(['internal', 'external', 'injection', 'other']))
    .optional(),
);
const dispensingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .trim()
    .pipe(z.enum(['standard', 'unit_dose', 'crushed', 'other']))
    .optional(),
);
const packagingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().pipe(z.enum(PACKAGING_METHOD_VALUES)).optional(),
);
const packagingInstructionTagSchema = z.enum(PACKAGING_TAG_VALUES);

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

function readDraftLineAt(parsedData: Record<string, unknown> | null, index: number) {
  const lines = Array.isArray(parsedData?.lines) ? parsedData.lines : [];
  return readJsonObject(lines[index]);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function readPositiveNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
}

const ROUTE_VALUES = ['internal', 'external', 'injection', 'other'] as const;
const DISPENSING_METHOD_VALUES = ['standard', 'unit_dose', 'crushed', 'other'] as const;
const DRUG_CODE_RESOLUTION_STATUS_VALUES = ['resolved', 'review_required', 'unresolved'] as const;

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

function readDraftLines(parsedData: Record<string, unknown> | null | undefined) {
  if (!Array.isArray(parsedData?.lines)) return [];
  return parsedData.lines.flatMap((line) => {
    const object = readJsonObject(line);
    return object ? [object] : [];
  });
}

function normalizeLineComparableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeLineComparableValue(item))
      .sort()
      .join(',');
  }
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

function findQrDraftLineMismatches(
  input: z.infer<typeof confirmQrDraftSchema>,
  parsedData: Record<string, unknown> | null | undefined,
) {
  const draftLines = readDraftLines(parsedData);
  const mismatches: string[] = [];

  if (draftLines.length !== input.lines.length) {
    mismatches.push('line_count');
  }

  input.lines.forEach((line, index) => {
    const draftLine = draftLines[index];
    if (!draftLine) return;

    const comparisons = [
      {
        key: 'drug_code',
        requestValue: line.drug_code,
        draftValue: readString(draftLine.drugCode),
      },
      {
        key: 'drug_name',
        requestValue: line.drug_name,
        draftValue: readString(draftLine.drugName),
      },
      {
        key: 'dosage_form',
        requestValue: line.dosage_form,
        draftValue: readString(draftLine.dosageForm),
      },
      { key: 'dose', requestValue: line.dose, draftValue: readString(draftLine.dose) },
      {
        key: 'frequency',
        requestValue: line.frequency,
        draftValue: readString(draftLine.frequency),
      },
      { key: 'days', requestValue: line.days, draftValue: draftLine.days },
      { key: 'quantity', requestValue: line.quantity, draftValue: draftLine.quantity },
      { key: 'unit', requestValue: line.unit, draftValue: readString(draftLine.unit) },
      {
        key: 'is_generic',
        requestValue: line.is_generic,
        draftValue: readBoolean(draftLine.isGeneric),
      },
      {
        key: 'packaging_method',
        requestValue: line.packaging_method,
        draftValue: readEnumValue(draftLine.packagingMethod, PACKAGING_METHOD_VALUES),
      },
      {
        key: 'packaging_instructions',
        requestValue: line.packaging_instructions,
        draftValue: readString(draftLine.packagingInstructions),
      },
      {
        key: 'packaging_instruction_tags',
        requestValue: line.packaging_instruction_tags,
        draftValue: readEnumArray(draftLine.packagingInstructionTags, PACKAGING_TAG_VALUES),
      },
      {
        key: 'route',
        requestValue: line.route,
        draftValue: readEnumValue(draftLine.route, ROUTE_VALUES),
      },
      {
        key: 'dispensing_method',
        requestValue: line.dispensing_method,
        draftValue: readEnumValue(draftLine.dispensingMethod, DISPENSING_METHOD_VALUES),
      },
      {
        key: 'start_date',
        requestValue: line.start_date,
        draftValue: readString(draftLine.startDate),
      },
      { key: 'end_date', requestValue: line.end_date, draftValue: readString(draftLine.endDate) },
      { key: 'notes', requestValue: line.notes, draftValue: readString(draftLine.notes) },
    ];

    for (const comparison of comparisons) {
      if (comparison.requestValue === undefined) continue;
      const requestValue = normalizeLineComparableValue(comparison.requestValue);
      const draftValue = normalizeLineComparableValue(comparison.draftValue);
      if (requestValue !== draftValue) {
        mismatches.push(`line_${index + 1}_${comparison.key}`);
      }
    }
  });

  return mismatches;
}

function collectDrugCodeResolutionReviewDetails(
  parsedData: Record<string, unknown> | null | undefined,
  input: z.infer<typeof confirmQrDraftSchema>,
) {
  const draftLines = readDraftLines(parsedData);
  const details: Record<string, string[]> = {};

  draftLines.forEach((draftLine, index) => {
    const status = readEnumValue(
      draftLine.drugCodeResolutionStatus,
      DRUG_CODE_RESOLUTION_STATUS_VALUES,
    );
    const drugCode = readString(draftLine.drugCode);
    if (status === 'resolved' && drugCode) return;
    if (status === 'review_required' && input.lines[index]?.drug_master_id) return;

    details[`line_${index + 1}_drug_code`] = ['薬剤コードを医薬品マスターコードで確認してください'];
  });

  return Object.keys(details).length > 0 ? details : null;
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
          prescription_expiry_date:
            typeof parsedData?.prescriptionExpirationDate === 'string'
              ? parsedData.prescriptionExpirationDate
              : undefined,
          prescriber_name,
          prescriber_institution_id,
          prescriber_institution,
          lines: lines.map((line, index) => ({
            ...(() => {
              const draftLine = readDraftLineAt(parsedData, index);
              return {
                line_number: index + 1,
                drug_name: line.drug_name,
                drug_master_id: line.drug_master_id,
                drug_code: line.drug_code ?? readString(draftLine?.drugCode),
                source_drug_code:
                  readString(draftLine?.sourceDrugCode) ??
                  line.drug_code ??
                  readString(draftLine?.drugCode),
                source_drug_code_type: readString(draftLine?.sourceDrugCodeType),
                dosage_form: line.dosage_form ?? readString(draftLine?.dosageForm),
                dose: line.dose,
                frequency: line.frequency,
                days: line.days,
                quantity: line.quantity ?? readPositiveNumber(draftLine?.quantity),
                unit: line.unit ?? readString(draftLine?.unit),
                is_generic:
                  line.is_generic ??
                  (typeof draftLine?.isGeneric === 'boolean' ? draftLine.isGeneric : undefined),
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
            })(),
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
