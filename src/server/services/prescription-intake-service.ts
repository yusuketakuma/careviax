import { addDays, subDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';
import {
  extractPackagingInstructionTags,
  parsePackagingMethod,
} from '@/lib/prescription/packaging';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from '@/app/api/prescription-intakes/shared';
import { detectMedicationChanges, type MedicationChange } from '@/lib/prescription/medication-diff';
import type { Prisma, PrescriptionSourceType } from '@prisma/client';
import { InvalidTransitionError, VersionConflictError } from '@/lib/db/cycle-transition';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { createDispenseDraft } from '@/server/services/dispense-draft-service';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import {
  buildMedicationCycleAssignmentWhere,
  type PrescriptionAccessContext,
} from '@/server/services/prescription-access';

export interface CreateIntakeLineInput {
  line_number: number;
  drug_name: string;
  drug_code?: string;
  dosage_form?: string;
  dose: string;
  frequency: string;
  days: number;
  quantity?: number;
  unit?: string;
  is_generic?: boolean;
  is_generic_name_prescription?: boolean;
  packaging_instructions?: string;
  notes?: string;
  route?: 'internal' | 'external' | 'injection' | 'other';
  dispensing_method?: 'standard' | 'unit_dose' | 'crushed' | 'other';
  start_date?: string;
  end_date?: string;
}

export interface CreateIntakeInput {
  cycle_id?: string;
  case_id?: string;
  patient_id?: string;
  source_type: PrescriptionSourceType;
  prescribed_date: string;
  prescriber_name?: string;
  prescriber_institution_id?: string;
  prescriber_institution?: string;
  original_document_url?: string;
  refill_remaining_count?: number;
  refill_next_dispense_date?: string;
  split_dispense_total?: number;
  split_dispense_current?: number;
  split_next_dispense_date?: string;
  prescription_category?: string; // regular | emergency
  emergency_category?: string; // planned_disease_exacerbation | other_exacerbation | online
  lines: CreateIntakeLineInput[];
  inquiry?: {
    reason: string;
    inquiry_to_physician: string;
    inquiry_content: string;
    request_due_date?: string;
    proposal_origin?: 'post_inquiry' | 'pre_issuance';
    residual_adjustment?: boolean;
  };
}

export interface CreateIntakeOptions {
  skipStructuringCheck?: boolean;
  skipExpiryCheck?: boolean;
  accessContext?: PrescriptionAccessContext;
}

type CreatedIntakeLine = {
  drug_name: string;
  drug_code?: string | null;
  dose: string;
  frequency: string;
};

type CreatedIntake = {
  id: string;
  lines: CreatedIntakeLine[];
};

type UpdatedCycle = {
  id: string;
  patient_id: string;
  case_id: string | null;
};

// Discriminated union for results returned from within the transaction
type TransactionResult =
  | { kind: 'intake'; intake: CreatedIntake; cycle: UpdatedCycle }
  | { kind: 'error'; error: 'cycle_not_found' }
  | { kind: 'error'; error: 'invalid_refill_remaining_count' }
  | { kind: 'error'; error: 'missing_refill_next_dispense_date' }
  | {
      kind: 'error';
      error: 'refill_window_out_of_range';
      targetDate: Date;
      windowStart: Date;
      windowEnd: Date;
    }
  | {
      kind: 'error';
      error: 'duplicate_prescription_lines';
      duplicates: Array<{ key: string; lines: Array<{ line_number: number; drug_name: string }> }>;
    }
  | {
      kind: 'error';
      error: 'structuring_blocked_lines';
      blockedLines: Array<{ line_number: number; drug_name: string }>;
    }
  | { kind: 'error'; error: 'expiry_exceeded' }
  | { kind: 'error'; error: 'invalid_transition' }
  | { kind: 'error'; error: 'version_conflict' };

export type CreateIntakeServiceResult =
  | {
      ok: true;
      intake: CreatedIntake;
      cycle: UpdatedCycle;
      medicationChanges: MedicationChange[];
      profileSyncResult: ProfileSyncResult | null;
    }
  | { ok: false; error: 'cycle_not_found' }
  | { ok: false; error: 'invalid_refill_remaining_count' }
  | { ok: false; error: 'missing_refill_next_dispense_date' }
  | {
      ok: false;
      error: 'refill_window_out_of_range';
      targetDate: Date;
      windowStart: Date;
      windowEnd: Date;
    }
  | {
      ok: false;
      error: 'duplicate_prescription_lines';
      duplicates: Array<{ key: string; lines: Array<{ line_number: number; drug_name: string }> }>;
    }
  | {
      ok: false;
      error: 'structuring_blocked_lines';
      blockedLines: Array<{ line_number: number; drug_name: string }>;
    }
  | { ok: false; error: 'expiry_exceeded' }
  | { ok: false; error: 'prescriber_institution_not_found'; message: string }
  | { ok: false; error: 'invalid_transition' }
  | { ok: false; error: 'version_conflict' };

type LoadedCycleContext = {
  id: string;
  patient_id: string;
  case_id: string | null;
  overall_status: string;
  version: number;
  primary_pharmacist_id: string | null;
  prescription_intakes: Array<{
    id: string;
    source_type: PrescriptionSourceType;
    prescribed_date: Date;
    refill_remaining_count: number | null;
    refill_next_dispense_date: Date | null;
    lines: Array<{ days: number }>;
  }>;
  dispense_tasks: Array<{
    results: Array<{ dispensed_at: Date }>;
  }>;
};

async function loadCycleContext(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    cycleId?: string;
    caseId?: string;
    patientId?: string;
    accessContext?: PrescriptionAccessContext;
  },
): Promise<LoadedCycleContext | null> {
  if (args.cycleId) {
    const assignmentWhere = args.accessContext
      ? buildMedicationCycleAssignmentWhere(args.accessContext)
      : null;
    return tx.medicationCycle
      .findFirst({
        where: {
          id: args.cycleId,
          org_id: args.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          overall_status: true,
          version: true,
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
      })
      .then((cycle) =>
        cycle
          ? {
              ...cycle,
              primary_pharmacist_id: cycle.case_?.primary_pharmacist_id ?? null,
            }
          : null,
      );
  }

  if (!args.caseId || !args.patientId) {
    return null;
  }

  const caseAssignmentWhere = args.accessContext
    ? buildCareCaseAssignmentWhere(args.accessContext)
    : null;
  const careCase = await tx.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: {
      id: true,
      patient_id: true,
      primary_pharmacist_id: true,
    },
  });
  if (!careCase) return null;

  const createdCycle = await tx.medicationCycle.create({
    data: {
      org_id: args.orgId,
      case_id: careCase.id,
      patient_id: careCase.patient_id,
      overall_status: 'intake_received',
      version: 1,
    },
  });

  return {
    id: createdCycle.id,
    patient_id: createdCycle.patient_id,
    case_id: createdCycle.case_id,
    overall_status: createdCycle.overall_status,
    version: createdCycle.version,
    primary_pharmacist_id: careCase.primary_pharmacist_id ?? null,
    prescription_intakes: [],
    dispense_tasks: [],
  };
}

async function createInquiryArtifactsTx(
  tx: Prisma.TransactionClient,
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
      context_snapshot: {
        cycle_id: args.cycle.id,
        issue_id: null,
        line_id: null,
        reason: args.inquiry.reason,
      } as Prisma.InputJsonValue,
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

async function ensureFaxOriginalFollowupTaskTx(
  tx: Prisma.TransactionClient,
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

// 調剤ドラフト生成は dispense-draft-service.ts に分離。
// 処方登録完了後、createDispenseDraft() 経由で DispenseTask を自動生成する。

export async function createPrescriptionIntakeInTx(
  tx: Prisma.TransactionClient,
  input: CreateIntakeInput,
  orgId: string,
  userId: string,
  options: CreateIntakeOptions = {},
): Promise<TransactionResult> {
  const {
    cycle_id,
    case_id,
    patient_id,
    source_type,
    prescribed_date,
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
  const expiryDate = addDays(prescribedDateObj, 4);

  const cycle = await loadCycleContext(tx, {
    orgId,
    cycleId: cycle_id,
    caseId: case_id,
    patientId: patient_id,
    accessContext: options.accessContext,
  });
  if (!cycle) {
    return { kind: 'error', error: 'cycle_not_found' };
  }

  if (source_type === 'refill') {
    if (refill_remaining_count == null || refill_remaining_count <= 0) {
      return { kind: 'error', error: 'invalid_refill_remaining_count' };
    }
    if (!refill_next_dispense_date) {
      return { kind: 'error', error: 'missing_refill_next_dispense_date' };
    }

    const previousIntake = cycle.prescription_intakes[0] ?? null;
    const previousDispensedAt =
      cycle.dispense_tasks
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

  const duplicateCandidates = collectDuplicatePrescriptionLines(lines);
  if (duplicateCandidates.length > 0) {
    return {
      kind: 'error',
      error: 'duplicate_prescription_lines',
      duplicates: duplicateCandidates,
    };
  }

  if (!options.skipStructuringCheck) {
    const structuringBlockedLines = collectStructuringBlockedLines(lines);
    if (structuringBlockedLines.length > 0) {
      const existingException = await tx.workflowException.findFirst({
        where: {
          org_id: orgId,
          cycle_id: cycle.id,
          exception_type: 'prescription_structuring_block',
          status: 'open',
        },
        select: { id: true },
      });

      if (!existingException) {
        await tx.workflowException.create({
          data: {
            org_id: orgId,
            cycle_id: cycle.id,
            exception_type: 'prescription_structuring_block',
            description: `未構造化または不明な処方明細があります: ${structuringBlockedLines.map((line) => `${line.line_number}行目 ${line.drug_name}`).join(' / ')}`,
            severity: 'warning',
            status: 'open',
          },
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

  const resolvedInstitution = await resolvePrescriberInstitutionFields(tx, orgId, {
    prescriber_institution_id,
    prescriber_institution: rest.prescriber_institution,
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
        create: lines.map((line) => {
          const parsedPackaging = parsePackagingMethod(line.packaging_instructions);
          return {
            org_id: orgId,
            ...line,
            packaging_method: parsedPackaging.method,
            packaging_instruction_tags: extractPackagingInstructionTags({
              packagingInstructions: line.packaging_instructions,
              notes: line.notes,
              packagingMethod: parsedPackaging.method,
            }),
          };
        }),
      },
    },
  });

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
      return { kind: 'error', error: 'invalid_transition' };
    }
    if (err instanceof VersionConflictError) {
      return { kind: 'error', error: 'version_conflict' };
    }
    throw err;
  }

  return {
    kind: 'intake',
    intake: {
      id: intake.id,
      lines: lines.map((line) => ({
        drug_name: line.drug_name,
        drug_code: line.drug_code ?? null,
        dose: line.dose,
        frequency: line.frequency,
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
  const { prescribed_date, lines } = input;

  const prescribedDateObj = new Date(prescribed_date);
  const expiryDate = addDays(prescribedDateObj, 4);
  const now = new Date();

  if (!options.skipExpiryCheck && expiryDate < now) {
    return { ok: false, error: 'expiry_exceeded' };
  }

  let txResult: TransactionResult;
  try {
    txResult = await withOrgContext(orgId, (tx) =>
      createPrescriptionIntakeInTx(tx, input, orgId, userId, options),
    );
  } catch (error) {
    if (error instanceof PrescriberInstitutionReferenceValidationError) {
      return { ok: false, error: 'prescriber_institution_not_found', message: error.message };
    }
    throw error;
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
    if (txResult.error === 'expiry_exceeded') {
      return { ok: false, error: 'expiry_exceeded' };
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

  const { medicationChanges, profileSyncResult } = await runPrescriptionIntakePostCreateHooks({
    cycleId: cycle.id,
    intakeId: intake.id,
    patientId: cycle.patient_id,
    orgId,
    lines,
    prescriberName: input.prescriber_name ?? null,
    sourceType: input.source_type,
  });

  await notifyWebhookEventForOrg(orgId, 'prescription.created', {
    intakeId: intake.id,
    cycleId: cycle.id,
    patientId: cycle.patient_id,
    sourceType: input.source_type,
    lineCount: intake.lines.length,
  });

  return {
    ok: true,
    intake,
    cycle,
    medicationChanges,
    profileSyncResult,
  };
}

export async function runPrescriptionIntakePostCreateHooks(args: {
  cycleId: string;
  intakeId: string;
  patientId: string;
  orgId: string;
  lines: Array<{
    drug_name: string;
    drug_code?: string | null;
    dose: string;
    frequency: string;
    start_date?: string | Date | null;
  }>;
  prescriberName: string | null;
  sourceType: PrescriptionSourceType;
}): Promise<{
  medicationChanges: MedicationChange[];
  profileSyncResult: ProfileSyncResult | null;
}> {
  let medicationChanges: MedicationChange[] = [];
  let profileSyncResult: ProfileSyncResult | null = null;

  try {
    const [changes, syncResult] = await Promise.all([
      detectIntakeChanges(args.cycleId, args.intakeId, args.lines),
      syncMedicationProfiles(
        args.patientId,
        args.orgId,
        args.lines,
        args.prescriberName,
        args.sourceType,
      ),
    ]);
    medicationChanges = changes;
    profileSyncResult = syncResult;
  } catch {
    // Post-processing errors should not fail the intake creation
  }

  return { medicationChanges, profileSyncResult };
}

// ────────────────────────────────────────────────────────────────────────────
// #1 処方差分検知 — 前回処方との変更点を自動検出
// ────────────────────────────────────────────────────────────────────────────

async function detectIntakeChanges(
  cycleId: string,
  currentIntakeId: string,
  currentLines: Array<{
    drug_name: string;
    drug_code?: string | null;
    dose: string;
    frequency: string;
  }>,
): Promise<MedicationChange[]> {
  // 同一サイクルの前回処方を取得
  const previousIntake = await prisma.prescriptionIntake.findFirst({
    where: {
      cycle_id: cycleId,
      id: { not: currentIntakeId },
    },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      lines: {
        select: { drug_name: true, drug_code: true, dose: true, frequency: true },
      },
    },
  });

  if (!previousIntake) return [];

  return detectMedicationChanges(currentLines, previousIntake.lines);
}

// ────────────────────────────────────────────────────────────────────────────
// #2 服薬プロファイル自動同期 — QR 処方確定時に MedicationProfile を更新
// ────────────────────────────────────────────────────────────────────────────

export interface ProfileSyncResult {
  created: number;
  updated: number;
  discontinued: number;
}

async function syncMedicationProfiles(
  patientId: string,
  orgId: string,
  intakeLines: Array<{
    drug_name: string;
    drug_code?: string | null;
    dose: string;
    frequency: string;
    start_date?: Date | string | null;
  }>,
  prescriberName: string | null,
  sourceType: PrescriptionSourceType,
): Promise<ProfileSyncResult> {
  let created = 0;
  let updated = 0;
  let discontinued = 0;

  // 現在の is_current プロファイルを取得
  const existingProfiles = await prisma.medicationProfile.findMany({
    where: { org_id: orgId, patient_id: patientId, is_current: true },
  });

  const existingByKey = new Map(existingProfiles.map((p) => [p.drug_master_id || p.drug_name, p]));
  const incomingKeys = new Set<string>();

  // 新規処方の各行を upsert
  for (const line of intakeLines) {
    const key = line.drug_code || line.drug_name;
    incomingKeys.add(key);

    const existing = existingByKey.get(key);
    const startDate = line.start_date
      ? typeof line.start_date === 'string'
        ? new Date(line.start_date)
        : line.start_date
      : new Date();

    if (existing) {
      // 既存プロファイルを更新（dose/frequency が変わった場合のみ）
      if (existing.dose !== line.dose || existing.frequency !== line.frequency) {
        await prisma.medicationProfile.update({
          where: { id: existing.id },
          data: {
            dose: line.dose,
            frequency: line.frequency,
            prescriber: prescriberName,
            start_date: startDate,
            end_date: null,
            source: sourceType === 'qr_scan' ? 'qr_scan' : 'prescription',
          },
        });
        updated++;
      }
    } else {
      // 新規プロファイル作成
      await prisma.medicationProfile.create({
        data: {
          org_id: orgId,
          patient_id: patientId,
          drug_name: line.drug_name,
          drug_master_id: line.drug_code || null,
          dose: line.dose,
          frequency: line.frequency,
          prescriber: prescriberName,
          start_date: startDate,
          is_current: true,
          source: sourceType === 'qr_scan' ? 'qr_scan' : 'prescription',
        },
      });
      created++;
    }
  }

  // 今回の処方に含まれない既存プロファイルを中止扱い（一括更新）
  const idsToDiscontinue = [...existingByKey.entries()]
    .filter(([key]) => !incomingKeys.has(key))
    .map(([, profile]) => profile.id);

  if (idsToDiscontinue.length > 0) {
    const result = await prisma.medicationProfile.updateMany({
      where: { id: { in: idsToDiscontinue } },
      data: { is_current: false, end_date: new Date() },
    });
    discontinued = result.count;
  }

  return { created, updated, discontinued };
}
