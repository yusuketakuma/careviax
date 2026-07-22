import { addDays, subDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';
import { extractPackagingInstructionTags, parsePackagingMethod } from '@/lib/dispensing/packaging';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from '@/lib/prescription/intake-validation';
import { InvalidTransitionError, VersionConflictError } from '@/lib/db/cycle-transition';
import { createDispenseDraft } from '@/server/services/dispense-draft-service';
import { enqueuePrescriptionCreatedWebhook } from '@/server/services/outbound-webhook-queue';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { validatePrescriptionDateWindow } from '@/lib/prescription/prescription-date-window';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

import {
  PrescriptionIntakeTransactionRollback,
  type CreateIntakeInput,
  type CreateIntakeLineInput,
  type CreateIntakeOptions,
  type CreateIntakeServiceResult,
  type TransactionResult,
  type Tx,
  type UpdatedCycle,
} from './prescription-intake-contract';
export {
  PrescriptionIntakeTransactionRollback,
  type CreateIntakeInput,
  type CreateIntakeLineInput,
  type CreateIntakeOptions,
  type CreateIntakeServiceResult,
} from './prescription-intake-contract';

import {
  createMedicationCycleContext,
  loadPrescriptionIntakeTargetContext,
  type LoadedCycleContext,
} from './prescription-intake-target';

async function createInquiryArtifactsTx(
  tx: Tx,
  args: {
    orgId: string;
    userId: string;
    cycle: UpdatedCycle;
    inquiry: NonNullable<CreateIntakeInput['inquiry']>;
  },
) {
  const inquiredAt = new Date();
  const dueDate = args.inquiry.request_due_date
    ? new Date(args.inquiry.request_due_date)
    : new Date(inquiredAt.getTime() + 24 * 60 * 60 * 1000);

  const inquiry = await tx.inquiryRecord.create({
    data: {
      org_id: args.orgId,
      cycle_id: args.cycle.id,
      reason: args.inquiry.reason,
      inquiry_to_physician: args.inquiry.inquiry_to_physician,
      inquiry_content: args.inquiry.inquiry_content,
      proposal_origin: args.inquiry.proposal_origin ?? 'post_inquiry',
      residual_adjustment: args.inquiry.residual_adjustment ?? false,
      inquired_at: inquiredAt,
    },
  });

  const communicationRequest = await tx.communicationRequest.create({
    data: {
      org_id: args.orgId,
      patient_id: args.cycle.patient_id,
      case_id: args.cycle.case_id,
      request_type: 'physician_inquiry',
      template_key: 'inquiry_physician',
      recipient_name: args.inquiry.inquiry_to_physician,
      recipient_role: 'physician',
      related_entity_type: 'inquiry_record',
      related_entity_id: inquiry.id,
      context_snapshot: toPrismaJsonInput({
        cycle_id: args.cycle.id,
        issue_id: null,
        line_id: null,
        reason: args.inquiry.reason,
      }),
      status: 'sent',
      subject: `疑義照会: ${args.inquiry.reason}`,
      content: args.inquiry.inquiry_content,
      requested_by: args.userId,
      due_date: dueDate,
    },
  });

  await tx.communicationEvent.create({
    data: {
      org_id: args.orgId,
      patient_id: args.cycle.patient_id,
      case_id: args.cycle.case_id,
      event_type: 'inquiry_created',
      channel: 'phone',
      direction: 'outbound',
      counterpart_name: args.inquiry.inquiry_to_physician,
      subject: `疑義照会: ${args.inquiry.reason}`,
      content: args.inquiry.inquiry_content,
      occurred_at: inquiredAt,
    },
  });

  await upsertOperationalTask(tx, {
    orgId: args.orgId,
    taskType: 'inquiry_workbench',
    title: '疑義照会の回答確認が必要です',
    description: `${args.inquiry.reason} / ${args.inquiry.inquiry_to_physician}`,
    priority: 'high',
    assignedTo: args.userId,
    dueDate,
    slaDueAt: dueDate,
    dedupeKey: `inquiry-workbench:${inquiry.id}`,
    relatedEntityType: 'inquiry_record',
    relatedEntityId: inquiry.id,
    metadata: {
      patient_id: args.cycle.patient_id,
      case_id: args.cycle.case_id,
      issue_id: null,
      communication_request_id: communicationRequest.id,
    },
  });
}

const INJECTABLE_TEXT_PATTERN =
  /注射|注入|点滴|皮下注|筋注|静注|注射液|注射用|注射剤|注ミリ|注キット|注ペン|注カートリッジ|シリンジ|アンプル|バイアル|ミリオペン|フレックスペン|ソロスター|カートリッジ|プレフィルド|自己注/u;

function isInjectablePrescriptionLine(line: CreateIntakeLineInput) {
  if (line.route === 'injection') return true;
  return [line.dosage_form, line.drug_name].some((value) =>
    value ? INJECTABLE_TEXT_PATTERN.test(value) : false,
  );
}

async function collectOutpatientInjectionBlockedLines(
  client: DrugMasterReader,
  lines: CreateIntakeLineInput[],
) {
  const injectableLines = lines.filter(isInjectablePrescriptionLine);
  if (injectableLines.length === 0) return [];

  const codes = Array.from(
    new Set(
      injectableLines
        .map((line) => normalizePrescriptionDrugCode(line.drug_code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const eligibleCodes = new Set<string>();

  if (codes.length > 0) {
    // 3 列 OR を各列単体の findMany に分割(index が効く)。yj_code は @unique のため
    // 行の dedupe キーに使える。直列 await(トランザクション接続を跨がない)。
    const mastersByYjCode = new Map<
      string,
      {
        yj_code: string;
        receipt_code: string | null;
        hot_code: string | null;
        outpatient_injection_eligible: boolean;
      }
    >();
    for (const where of buildDrugMasterCodeWheres(codes)) {
      const rows = await client.drugMaster.findMany({
        where,
        select: {
          yj_code: true,
          receipt_code: true,
          hot_code: true,
          outpatient_injection_eligible: true,
        },
      });
      for (const row of rows) {
        mastersByYjCode.set(row.yj_code, row);
      }
    }

    for (const master of mastersByYjCode.values()) {
      if (!master.outpatient_injection_eligible) continue;
      for (const code of [master.yj_code, master.receipt_code, master.hot_code]) {
        const normalizedCode = normalizePrescriptionDrugCode(code);
        if (normalizedCode && codes.includes(normalizedCode)) {
          eligibleCodes.add(normalizedCode);
        }
      }
    }
  }

  return injectableLines
    .map((line) => {
      const code = normalizePrescriptionDrugCode(line.drug_code);
      if (!code) {
        return {
          line_number: line.line_number,
          drug_name: line.drug_name,
          reason: '薬剤コード未設定の注射剤は外来/在宅自己注射対象か確認できません',
        };
      }
      if (!eligibleCodes.has(code)) {
        return {
          line_number: line.line_number,
          drug_name: line.drug_name,
          reason: '薬剤マスターで外来/在宅自己注射対象として確認されていません',
        };
      }
      return null;
    })
    .filter((line): line is { line_number: number; drug_name: string; reason: string } =>
      Boolean(line),
    );
}

import {
  PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS,
  PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS,
  buildDrugMasterCodeWheres,
  normalizePrescriptionDrugCode,
  resolveCreateIntakeLineDrugIdentities,
  type DrugMasterReader,
  type PreparedIntakeReads,
} from './prescription-intake-drug-identity';
export {
  PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS,
  PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS,
} from './prescription-intake-drug-identity';

async function createStructuringBlockExceptionIfNeeded(
  tx: Tx,
  args: {
    orgId: string;
    cycle: Pick<LoadedCycleContext, 'id' | 'patient_id'>;
    blockedLines: Array<{ line_number: number; drug_name: string }>;
  },
) {
  const existingException = await tx.workflowException.findFirst({
    where: {
      org_id: args.orgId,
      cycle_id: args.cycle.id,
      exception_type: 'prescription_structuring_block',
      status: 'open' satisfies ExceptionStatus,
    },
    select: { id: true },
  });

  if (existingException) return;

  await tx.workflowException.create({
    data: {
      org_id: args.orgId,
      cycle_id: args.cycle.id,
      patient_id: args.cycle.patient_id,
      exception_type: 'prescription_structuring_block',
      description: `未構造化または不明な処方明細があります: ${args.blockedLines.map((line) => `${line.line_number}行目 ${line.drug_name}`).join(' / ')}`,
      severity: 'warning' satisfies ExceptionSeverity,
      status: 'open' satisfies ExceptionStatus,
    },
  });
}

async function createOutpatientInjectionBlockExceptionIfNeeded(
  tx: Tx,
  args: {
    orgId: string;
    cycle: Pick<LoadedCycleContext, 'id' | 'patient_id'>;
    blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
  },
) {
  const existingException = await tx.workflowException.findFirst({
    where: {
      org_id: args.orgId,
      cycle_id: args.cycle.id,
      exception_type: 'outpatient_injection_eligibility_block',
      status: 'open' satisfies ExceptionStatus,
    },
    select: { id: true },
  });

  if (existingException) return;

  await tx.workflowException.create({
    data: {
      org_id: args.orgId,
      cycle_id: args.cycle.id,
      patient_id: args.cycle.patient_id,
      exception_type: 'outpatient_injection_eligibility_block',
      description: `外来/在宅自己注射として調剤可否が未確認の注射剤があります: ${args.blockedLines.map((line) => `${line.line_number}行目 ${line.drug_name}`).join(' / ')}`,
      severity: 'warning' satisfies ExceptionSeverity,
      status: 'open' satisfies ExceptionStatus,
    },
  });
}

async function ensureFaxOriginalFollowupTaskTx(
  tx: Tx,
  args: {
    orgId: string;
    intakeId: string;
    cycleId: string;
    patientId: string;
    assignedTo: string | null;
    prescribedDate: Date;
  },
) {
  const dueDate = addDays(args.prescribedDate, 3);

  await upsertOperationalTask(tx, {
    orgId: args.orgId,
    taskType: 'fax_original_followup',
    title: 'FAX処方せん原本の回収確認が必要です',
    description: '訪問時回収または後日郵送到着後に原本回収を記録してください',
    priority: 'high',
    assignedTo: args.assignedTo,
    dueDate,
    slaDueAt: dueDate,
    dedupeKey: `fax-original-followup:${args.intakeId}`,
    relatedEntityType: 'prescription_intake',
    relatedEntityId: args.intakeId,
    metadata: {
      cycle_id: args.cycleId,
      patient_id: args.patientId,
      prescribed_date: args.prescribedDate.toISOString(),
    },
  });
}

type SourcePrescriptionLineValidationResult =
  | { ok: true }
  | { ok: false; error: 'invalid_source_prescription_line' | 'source_revision_conflict' };

function sameInstant(left: Date, right: string) {
  return left.getTime() === new Date(right).getTime();
}

async function validatePreviousPrescriptionLineSources(
  tx: Tx,
  args: {
    orgId: string;
    cycle: Pick<LoadedCycleContext, 'patient_id' | 'case_id'>;
    lines: CreateIntakeLineInput[];
  },
): Promise<SourcePrescriptionLineValidationResult> {
  const sourcedLines = args.lines.filter((line) => line.source_line_id);
  if (sourcedLines.length === 0) return { ok: true };

  const sourceLineIds = Array.from(new Set(sourcedLines.map((line) => line.source_line_id!)));
  const sourceRows = await tx.prescriptionLine.findMany({
    where: {
      org_id: args.orgId,
      id: { in: sourceLineIds },
    },
    select: {
      id: true,
      intake_id: true,
      updated_at: true,
      intake: {
        select: {
          id: true,
          updated_at: true,
          cycle: {
            select: {
              patient_id: true,
              case_id: true,
            },
          },
        },
      },
    },
  });
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));

  for (const line of sourcedLines) {
    if (
      !line.source_intake_id ||
      !line.source_line_id ||
      !line.source_intake_updated_at_snapshot ||
      !line.source_line_updated_at_snapshot
    ) {
      return { ok: false, error: 'invalid_source_prescription_line' };
    }

    const source = sourceById.get(line.source_line_id);
    if (!source) {
      return { ok: false, error: 'invalid_source_prescription_line' };
    }
    if (
      source.intake_id !== line.source_intake_id ||
      source.intake.id !== line.source_intake_id ||
      source.intake.cycle.patient_id !== args.cycle.patient_id ||
      source.intake.cycle.case_id !== args.cycle.case_id
    ) {
      return { ok: false, error: 'invalid_source_prescription_line' };
    }
    if (
      !sameInstant(source.updated_at, line.source_line_updated_at_snapshot) ||
      !sameInstant(source.intake.updated_at, line.source_intake_updated_at_snapshot)
    ) {
      return { ok: false, error: 'source_revision_conflict' };
    }
  }

  return { ok: true };
}

// 調剤ドラフト生成は dispense-draft-service.ts に分離。
// 処方登録完了後、createDispenseDraft() 経由で DispenseTask を自動生成する。

export async function createPrescriptionIntakeInTx(
  tx: Tx,
  input: CreateIntakeInput,
  orgId: string,
  userId: string,
  options: CreateIntakeOptions = {},
  prepared?: PreparedIntakeReads,
): Promise<TransactionResult> {
  const {
    cycle_id,
    case_id,
    patient_id,
    source_type,
    prescribed_date,
    prescription_expiry_date,
    refill_remaining_count,
    refill_next_dispense_date,
    split_dispense_total,
    split_dispense_current,
    split_next_dispense_date,
    lines,
    inquiry,
    prescriber_institution_id,
    ...rest
  } = input;

  const prescribedDateObj = new Date(prescribed_date);
  const expiryDate = prescription_expiry_date
    ? new Date(prescription_expiry_date)
    : addDays(prescribedDateObj, 4);

  if (!options.skipExpiryCheck) {
    const dateWindow = validatePrescriptionDateWindow(prescribed_date);
    if (!dateWindow.ok) {
      return { kind: 'error', error: dateWindow.reason };
    }
  }

  const target = await loadPrescriptionIntakeTargetContext(tx, {
    orgId,
    cycleId: cycle_id,
    caseId: case_id,
    patientId: patient_id,
    accessContext: options.accessContext,
  });
  if (!target) {
    return { kind: 'error', error: 'cycle_not_found' };
  }
  const existingCycle = target.kind === 'cycle' ? target.cycle : null;
  const cyclePatientScope: Pick<LoadedCycleContext, 'patient_id' | 'case_id'> =
    target.kind === 'cycle'
      ? target.cycle
      : {
          patient_id: target.careCase.patient_id,
          case_id: target.careCase.id,
        };

  const sourceValidation = await validatePreviousPrescriptionLineSources(tx, {
    orgId,
    cycle: cyclePatientScope,
    lines,
  });
  if (!sourceValidation.ok) {
    return { kind: 'error', error: sourceValidation.error };
  }
  // 読み取り検証(DrugMaster 解決)は tx 外で前倒し済みなら再実行しない。TOCTOU 上の
  // 懸念は薄い(DrugMaster はグローバル参照表で、書き込みは drug_master_id/drug_code を
  // 非正規化保存するだけ・FK 強制なし)。未前倒し(QR フロー等)のときは従来どおり tx 内で解決。
  const drugIdentityResolution =
    prepared?.drugIdentityResolution ?? (await resolveCreateIntakeLineDrugIdentities(tx, lines));
  if (!drugIdentityResolution.ok) {
    return {
      kind: 'error',
      error: 'invalid_drug_master_id',
      drugMasterIds: drugIdentityResolution.drugMasterIds,
    };
  }
  const resolvedLines = drugIdentityResolution.lines;

  if (source_type === 'refill') {
    if (refill_remaining_count == null || refill_remaining_count <= 0) {
      return { kind: 'error', error: 'invalid_refill_remaining_count' };
    }
    if (!refill_next_dispense_date) {
      return { kind: 'error', error: 'missing_refill_next_dispense_date' };
    }

    const previousIntake = existingCycle?.prescription_intakes[0] ?? null;
    const previousDispensedAt =
      existingCycle?.dispense_tasks
        .flatMap((task) => task.results)
        .sort((left, right) => right.dispensed_at.getTime() - left.dispensed_at.getTime())[0]
        ?.dispensed_at ?? null;
    const baselineDays = Math.max(...(previousIntake?.lines.map((line) => line.days) ?? []), 0);
    const baselineDate = previousDispensedAt ?? previousIntake?.prescribed_date ?? null;

    if (baselineDate && baselineDays > 0) {
      const targetDate = addDays(baselineDate, baselineDays);
      const windowStart = subDays(targetDate, 7);
      const windowEnd = addDays(targetDate, 7);
      const requestedDate = new Date(refill_next_dispense_date);

      if (requestedDate < windowStart || requestedDate > windowEnd) {
        return {
          kind: 'error',
          error: 'refill_window_out_of_range',
          targetDate,
          windowStart,
          windowEnd,
        };
      }
    }
  }

  const duplicateCandidates = collectDuplicatePrescriptionLines(resolvedLines);
  if (duplicateCandidates.length > 0) {
    return {
      kind: 'error',
      error: 'duplicate_prescription_lines',
      duplicates: duplicateCandidates,
    };
  }

  if (!options.skipStructuringCheck) {
    const structuringBlockedLines = collectStructuringBlockedLines(resolvedLines);
    if (structuringBlockedLines.length > 0) {
      if (existingCycle) {
        await createStructuringBlockExceptionIfNeeded(tx, {
          orgId,
          cycle: existingCycle,
          blockedLines: structuringBlockedLines,
        });
      }

      return {
        kind: 'error',
        error: 'structuring_blocked_lines',
        blockedLines: structuringBlockedLines.map((line) => ({
          line_number: line.line_number,
          drug_name: line.drug_name,
        })),
      };
    }
  }

  const outpatientInjectionBlockedLines =
    prepared?.outpatientInjectionBlockedLines ??
    (await collectOutpatientInjectionBlockedLines(tx, resolvedLines));
  if (outpatientInjectionBlockedLines.length > 0) {
    if (existingCycle) {
      await createOutpatientInjectionBlockExceptionIfNeeded(tx, {
        orgId,
        cycle: existingCycle,
        blockedLines: outpatientInjectionBlockedLines,
      });
    }

    return {
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: outpatientInjectionBlockedLines,
    };
  }

  const resolvedInstitution = await resolvePrescriberInstitutionFields(tx, orgId, {
    prescriber_institution_id,
    prescriber_institution: rest.prescriber_institution,
  });
  const cycle =
    target.kind === 'cycle'
      ? target.cycle
      : await createMedicationCycleContext(tx, {
          orgId,
          careCase: target.careCase,
        });

  const intake = await tx.prescriptionIntake.create({
    data: {
      org_id: orgId,
      cycle_id: cycle.id,
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
        create: resolvedLines.map((line) => {
          const parsedPackaging = parsePackagingMethod(line.packaging_instructions);
          const packagingMethod =
            line.packaging_method ??
            (parsedPackaging.method === 'other' ? 'other' : parsedPackaging.method);
          return {
            org_id: orgId,
            ...line,
            source_intake_updated_at_snapshot: line.source_intake_updated_at_snapshot
              ? new Date(line.source_intake_updated_at_snapshot)
              : undefined,
            source_line_updated_at_snapshot: line.source_line_updated_at_snapshot
              ? new Date(line.source_line_updated_at_snapshot)
              : undefined,
            packaging_method: packagingMethod,
            packaging_instruction_tags:
              line.packaging_instruction_tags && line.packaging_instruction_tags.length > 0
                ? line.packaging_instruction_tags
                : extractPackagingInstructionTags({
                    packagingInstructions: line.packaging_instructions,
                    notes: line.notes,
                    packagingMethod,
                  }),
          };
        }),
      },
    },
  });
  const rxNumber = formatPrescriptionCardNumber(intake.id, prescribed_date);
  if (typeof tx.prescriptionIntake.update === 'function') {
    await tx.prescriptionIntake.update({
      where: { id: intake.id },
      data: { rx_number: rxNumber },
    });
  }

  if (source_type === 'fax') {
    await ensureFaxOriginalFollowupTaskTx(tx, {
      orgId,
      intakeId: intake.id,
      cycleId: cycle.id,
      patientId: cycle.patient_id,
      assignedTo: cycle.primary_pharmacist_id ?? userId,
      prescribedDate: prescribedDateObj,
    });
  }

  if (inquiry) {
    await createInquiryArtifactsTx(tx, {
      orgId,
      userId,
      cycle: {
        id: cycle.id,
        patient_id: cycle.patient_id,
        case_id: cycle.case_id,
      },
      inquiry,
    });
  }

  const unresolvedInquiryCount =
    typeof tx.inquiryRecord?.count === 'function'
      ? await tx.inquiryRecord.count({
          where: {
            org_id: orgId,
            cycle_id: cycle.id,
            resolved_at: null,
          },
        })
      : 0;

  let updatedCycle;
  try {
    updatedCycle = await createDispenseDraft(tx, {
      orgId,
      userId,
      cycleId: cycle.id,
      currentStatus: cycle.overall_status,
      primaryPharmacistId: cycle.primary_pharmacist_id,
      shouldPauseForInquiry: unresolvedInquiryCount > 0,
      taskPriority: rest.prescription_category === 'emergency' ? 'emergency' : 'normal',
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      throw new PrescriptionIntakeTransactionRollback({
        kind: 'error',
        error: 'invalid_transition',
      });
    }
    if (err instanceof VersionConflictError) {
      throw new PrescriptionIntakeTransactionRollback({
        kind: 'error',
        error: 'version_conflict',
      });
    }
    throw err;
  }

  await enqueuePrescriptionCreatedWebhook(tx, {
    orgId,
    intakeId: intake.id,
    cycleId: cycle.id,
    patientId: cycle.patient_id,
    sourceType: source_type,
    lineCount: resolvedLines.length,
  });

  return {
    kind: 'intake',
    intake: {
      id: intake.id,
      rx_number: rxNumber,
      lines: resolvedLines.map((line) => ({
        drug_name: line.drug_name,
        drug_code: line.drug_code ?? null,
        drug_master_id: line.drug_master_id ?? null,
        source_drug_code: line.source_drug_code ?? null,
        source_drug_code_type: line.source_drug_code_type ?? null,
        drug_resolution_status: line.drug_resolution_status ?? null,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        start_date: line.start_date ?? null,
      })),
    },
    cycle: updatedCycle,
  };
}

export async function createPrescriptionIntake(
  input: CreateIntakeInput,
  orgId: string,
  userId: string,
  options: CreateIntakeOptions = {},
): Promise<CreateIntakeServiceResult> {
  const { prescribed_date } = input;

  if (!options.skipExpiryCheck) {
    const dateWindow = validatePrescriptionDateWindow(prescribed_date);
    if (!dateWindow.ok) {
      return { ok: false, error: dateWindow.reason };
    }
  }

  // DrugMaster(グローバル参照表・RLS 対象外)の解決系読み取りを interactive tx の外へ前倒しし、
  // 書き込み tx の timeout 予算を守る(RUN-20260622-001: tx 内 DrugMaster OR 検索 seq scan による
  // 5s 期限切れの根治)。エラー種別/順序は tx 内で従来位置(source 検証の後)に評価されるよう、
  // 解決結果ごと prepared に載せて createPrescriptionIntakeInTx へ引き渡す。
  const drugIdentityResolution = await resolveCreateIntakeLineDrugIdentities(prisma, input.lines);
  const outpatientInjectionBlockedLines = drugIdentityResolution.ok
    ? await collectOutpatientInjectionBlockedLines(prisma, drugIdentityResolution.lines)
    : [];
  const prepared: PreparedIntakeReads = {
    drugIdentityResolution,
    outpatientInjectionBlockedLines,
  };

  let txResult: TransactionResult;
  try {
    txResult = await withOrgContext(
      orgId,
      (tx) => createPrescriptionIntakeInTx(tx, input, orgId, userId, options, prepared),
      {
        timeoutMs: PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS,
        maxWaitMs: PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS,
      },
    );
  } catch (error) {
    if (error instanceof PrescriptionIntakeTransactionRollback) {
      txResult = error.result;
    } else if (error instanceof PrescriberInstitutionReferenceValidationError) {
      return { ok: false, error: 'prescriber_institution_not_found', message: error.message };
    } else {
      throw error;
    }
  }

  if (txResult.kind === 'error') {
    if (txResult.error === 'cycle_not_found') {
      return { ok: false, error: 'cycle_not_found' };
    }
    if (txResult.error === 'invalid_refill_remaining_count') {
      return { ok: false, error: 'invalid_refill_remaining_count' };
    }
    if (txResult.error === 'missing_refill_next_dispense_date') {
      return { ok: false, error: 'missing_refill_next_dispense_date' };
    }
    if (txResult.error === 'refill_window_out_of_range') {
      return {
        ok: false,
        error: 'refill_window_out_of_range',
        targetDate: txResult.targetDate,
        windowStart: txResult.windowStart,
        windowEnd: txResult.windowEnd,
      };
    }
    if (txResult.error === 'duplicate_prescription_lines') {
      return { ok: false, error: 'duplicate_prescription_lines', duplicates: txResult.duplicates };
    }
    if (txResult.error === 'structuring_blocked_lines') {
      return { ok: false, error: 'structuring_blocked_lines', blockedLines: txResult.blockedLines };
    }
    if (txResult.error === 'outpatient_injection_not_eligible') {
      return {
        ok: false,
        error: 'outpatient_injection_not_eligible',
        blockedLines: txResult.blockedLines,
      };
    }
    if (txResult.error === 'invalid_drug_master_id') {
      return {
        ok: false,
        error: 'invalid_drug_master_id',
        drugMasterIds: txResult.drugMasterIds,
      };
    }
    if (txResult.error === 'expiry_exceeded') {
      return { ok: false, error: 'expiry_exceeded' };
    }
    if (txResult.error === 'future_prescribed_date') {
      return { ok: false, error: 'future_prescribed_date' };
    }
    if (txResult.error === 'invalid_source_prescription_line') {
      return { ok: false, error: 'invalid_source_prescription_line' };
    }
    if (txResult.error === 'source_revision_conflict') {
      return { ok: false, error: 'source_revision_conflict' };
    }
    if (txResult.error === 'invalid_transition') {
      return { ok: false, error: 'invalid_transition' };
    }
    if (txResult.error === 'version_conflict') {
      return { ok: false, error: 'version_conflict' };
    }
  }

  const intake = txResult.intake;
  const cycle = txResult.cycle;

  // ── Post-creation hooks (best-effort, non-blocking) ──

  const { medicationChanges, profileSyncResult, prescriptionSupplyResult } =
    await runPrescriptionIntakePostCreateHooks({
      cycleId: cycle.id,
      intakeId: intake.id,
      patientId: cycle.patient_id,
      orgId,
      userId,
      lines: intake.lines,
      prescriberName: input.prescriber_name ?? null,
      sourceType: input.source_type,
    });

  return {
    ok: true,
    intake,
    cycle,
    medicationChanges,
    profileSyncResult,
    prescriptionSupplyResult,
  };
}

import { runPrescriptionIntakePostCreateHooks } from './prescription-intake-post-create';
export {
  runPrescriptionIntakePostCreateHooks,
  type ProfileSyncResult,
} from './prescription-intake-post-create';
