import { addDays, subDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import {
  PrescriberInstitutionReferenceValidationError,
  resolvePrescriberInstitutionFields,
} from '@/lib/prescriptions/prescriber-institutions';
import {
  extractPackagingInstructionTags,
  parsePackagingMethod,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/dispensing/packaging';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from '@/lib/prescription/intake-validation';
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
import { findCurrentAndPreviousPrescriptionIntakesForMedicationDiff } from '@/server/services/prescription-intake-pair';
import { validatePrescriptionDateWindow } from '@/lib/prescription/prescription-date-window';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
  type PrescriptionDrugCodeSystem,
} from '@/lib/pharmacy/drug-identity-resolution';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

export interface CreateIntakeLineInput {
  line_number: number;
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  dosage_form?: string;
  dose: string;
  frequency: string;
  days: number;
  quantity?: number;
  unit?: string;
  is_generic?: boolean;
  is_generic_name_prescription?: boolean;
  packaging_method?: PackagingMethodValue;
  packaging_instructions?: string;
  packaging_instruction_tags?: PackagingInstructionTagValue[];
  notes?: string;
  route?: 'internal' | 'external' | 'injection' | 'other';
  dispensing_method?: 'standard' | 'unit_dose' | 'crushed' | 'other';
  start_date?: string;
  end_date?: string;
  source_intake_id?: string;
  source_line_id?: string;
  source_intake_updated_at_snapshot?: string;
  source_line_updated_at_snapshot?: string;
}

export interface CreateIntakeInput {
  cycle_id?: string;
  case_id?: string;
  patient_id?: string;
  source_type: PrescriptionSourceType;
  external_prescription_id?: string;
  prescribed_date: string;
  prescription_expiry_date?: string;
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
  drug_master_id?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  drug_resolution_status?: string | null;
  dose: string;
  frequency: string;
  days?: number | null;
  start_date?: string | Date | null;
};

type CreatedIntake = {
  id: string;
  rx_number: string | null;
  lines: CreatedIntakeLine[];
};

type MedicationProfileSyncLine = {
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  dose: string;
  frequency: string;
  start_date?: Date | string | null;
};

type PrescriptionLineDrugResolutionStatus =
  | 'resolved'
  | 'missing_code'
  | 'code_not_found'
  | 'ambiguous_code';

type ResolvedCreateIntakeLineInput = Omit<CreateIntakeLineInput, 'drug_code'> & {
  drug_code?: string | null;
  drug_master_id?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  drug_resolution_status: PrescriptionLineDrugResolutionStatus;
};

type UpdatedCycle = {
  id: string;
  patient_id: string;
  case_id: string | null;
};
type Tx = {
  careCase: Pick<Prisma.TransactionClient['careCase'], 'findFirst'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'create'>;
  communicationRequest: Pick<Prisma.TransactionClient['communicationRequest'], 'create'>;
  cycleTransitionLog: Pick<Prisma.TransactionClient['cycleTransitionLog'], 'create'>;
  dispenseTask: Pick<Prisma.TransactionClient['dispenseTask'], 'create' | 'findFirst'>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'count' | 'create'>;
  medicationCycle: Pick<
    Prisma.TransactionClient['medicationCycle'],
    'create' | 'findFirst' | 'updateMany'
  >;
  prescriberInstitution: Pick<Prisma.TransactionClient['prescriberInstitution'], 'findFirst'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'create'> &
    Partial<Pick<Prisma.TransactionClient['prescriptionIntake'], 'update'>>;
  prescriptionLine: Pick<Prisma.TransactionClient['prescriptionLine'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'create' | 'updateMany' | 'upsert'>;
  workflowException: Pick<Prisma.TransactionClient['workflowException'], 'create' | 'findFirst'>;
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
  | {
      kind: 'error';
      error: 'outpatient_injection_not_eligible';
      blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
    }
  | { kind: 'error'; error: 'invalid_drug_master_id'; drugMasterIds: string[] }
  | { kind: 'error'; error: 'expiry_exceeded' }
  | { kind: 'error'; error: 'future_prescribed_date' }
  | { kind: 'error'; error: 'invalid_source_prescription_line' }
  | { kind: 'error'; error: 'source_revision_conflict' }
  | { kind: 'error'; error: 'invalid_transition' }
  | { kind: 'error'; error: 'version_conflict' };

type TransactionRollbackResult = Extract<
  TransactionResult,
  { kind: 'error'; error: 'invalid_transition' | 'version_conflict' }
>;

export class PrescriptionIntakeTransactionRollback extends Error {
  constructor(readonly result: TransactionRollbackResult) {
    super(result.error);
    this.name = 'PrescriptionIntakeTransactionRollback';
  }
}

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
  | {
      ok: false;
      error: 'outpatient_injection_not_eligible';
      blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
    }
  | { ok: false; error: 'invalid_drug_master_id'; drugMasterIds: string[] }
  | { ok: false; error: 'expiry_exceeded' }
  | { ok: false; error: 'future_prescribed_date' }
  | { ok: false; error: 'prescriber_institution_not_found'; message: string }
  | { ok: false; error: 'invalid_source_prescription_line' }
  | { ok: false; error: 'source_revision_conflict' }
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

type LoadedCareCaseContext = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
};

type PrescriptionIntakeTargetContext =
  | { kind: 'cycle'; cycle: LoadedCycleContext }
  | { kind: 'case'; careCase: LoadedCareCaseContext };

async function createMedicationCycleContext(
  tx: Tx,
  args: { orgId: string; careCase: LoadedCareCaseContext },
): Promise<LoadedCycleContext> {
  const createdCycle = await tx.medicationCycle.create({
    data: {
      org_id: args.orgId,
      case_id: args.careCase.id,
      patient_id: args.careCase.patient_id,
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
    primary_pharmacist_id: args.careCase.primary_pharmacist_id ?? null,
    prescription_intakes: [],
    dispense_tasks: [],
  };
}

async function loadPrescriptionIntakeTargetContext(
  tx: Tx,
  args: {
    orgId: string;
    cycleId?: string;
    caseId?: string;
    patientId?: string;
    accessContext?: PrescriptionAccessContext;
  },
): Promise<PrescriptionIntakeTargetContext | null> {
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
      )
      .then((cycle) => (cycle ? { kind: 'cycle' as const, cycle } : null));
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

  return {
    kind: 'case',
    careCase: {
      id: careCase.id,
      patient_id: careCase.patient_id,
      primary_pharmacist_id: careCase.primary_pharmacist_id ?? null,
    },
  };
}

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

function normalizePrescriptionLineSourceDrugCodeType(
  value: string | null | undefined,
): Exclude<PrescriptionDrugCodeSystem, 'jan'> | null {
  const normalized = value?.trim();
  return normalized === 'yj' || normalized === 'receipt' || normalized === 'hot'
    ? normalized
    : null;
}

function readPrescriptionLineSourceDrugCode(line: CreateIntakeLineInput) {
  return normalizePrescriptionDrugCode(line.source_drug_code ?? line.drug_code);
}

function readPrescriptionLineDrugIdentityCodes(line: CreateIntakeLineInput) {
  const entries = [
    normalizePrescriptionDrugCode(line.source_drug_code),
    normalizePrescriptionDrugCode(line.drug_code),
  ];
  return Array.from(new Set(entries.filter((code): code is string => Boolean(code))));
}

function normalizePrescriptionLineDrugMasterId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

type ResolveCreateIntakeLineDrugIdentitiesResult =
  | { ok: true; lines: ResolvedCreateIntakeLineInput[] }
  | { ok: false; drugMasterIds: string[] };

/**
 * DrugMaster は org_id を持たないグローバル参照表(RLS 対象外)。よって解決系の読み取りは
 * RLS 付き interactive transaction の外(通常の `prisma`)からでも安全に実行できる。
 * ここでは `tx`(トランザクション内)と `prisma`(トランザクション外)の双方を受けられるよう、
 * `findMany` だけを要求する最小インターフェースに絞る。
 */
type DrugMasterReader = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};

/**
 * yj_code / receipt_code / hot_code の 3 列 OR 検索を、各列単体の WHERE に分割する。
 * 3 列同時 OR はプランナが seq scan に落ちやすく(RUN-20260622-001: 直 fetch 33.7s)、
 * 各列には個別 index(@@index([yj_code]) 等)があるため、列ごとに分けると index が効く。
 * 呼び出し側は返した WHERE ごとに findMany し、結果を id / yj_code で dedupe して結合する。
 */
function buildDrugMasterCodeWheres(codes: string[]): Prisma.DrugMasterWhereInput[] {
  if (codes.length === 0) return [];
  return [{ yj_code: { in: codes } }, { receipt_code: { in: codes } }, { hot_code: { in: codes } }];
}

/**
 * 書き込み transaction の外で先に済ませておける読み取り検証結果。interactive tx の
 * timeout 予算をグローバル参照表(DrugMaster)の読み取りに費やさないよう、
 * {@link createPrescriptionIntake} が事前計算して {@link createPrescriptionIntakeInTx} へ渡す。
 * 未指定(QR フロー等、tx 内で行が確定するケース)のときは従来どおり tx 内で解決する。
 */
export type PreparedIntakeReads = {
  drugIdentityResolution: ResolveCreateIntakeLineDrugIdentitiesResult;
  outpatientInjectionBlockedLines: Array<{
    line_number: number;
    drug_name: string;
    reason: string;
  }>;
};

/**
 * 書き込み+整合性再確認だけを担う短い tx の明示 timeout。読み取り検証を tx 外へ前倒しした後の
 * 残り作業(intake/line 作成・rx 採番・fax/inquiry・createDispenseDraft の状態遷移)向けに、
 * interactive tx 既定の 5s より余裕を持たせつつ上限を明示する。
 */
export const PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS = 15_000;
export const PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS = 5_000;

async function resolveCreateIntakeLineDrugIdentities(
  client: DrugMasterReader,
  lines: CreateIntakeLineInput[],
): Promise<ResolveCreateIntakeLineDrugIdentitiesResult> {
  const sourceCodes = Array.from(
    new Set(
      lines
        .flatMap((line) => readPrescriptionLineDrugIdentityCodes(line))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const explicitDrugMasterIds = Array.from(
    new Set(
      lines
        .map((line) => normalizePrescriptionLineDrugMasterId(line.drug_master_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  // 3 列 OR を各列単体の findMany に分割し(index が効く)、id で dedupe して結合する。
  // 明示 drug_master_id は id 単体の findMany を追加する。DrugMaster はグローバル参照表のため
  // 同一トランザクション接続を跨がないよう await を直列に回す(並列化はしない)。
  const drugMasterWheres: Prisma.DrugMasterWhereInput[] = [
    ...buildDrugMasterCodeWheres(sourceCodes),
    ...(explicitDrugMasterIds.length > 0 ? [{ id: { in: explicitDrugMasterIds } }] : []),
  ];
  const masterById = new Map<
    string,
    { id: string; yj_code: string; receipt_code: string | null; hot_code: string | null }
  >();
  for (const where of drugMasterWheres) {
    const rows = await client.drugMaster.findMany({
      where,
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    for (const row of rows) {
      masterById.set(row.id, row);
    }
  }
  const masters = [...masterById.values()];
  const invalidExplicitDrugMasterIds = explicitDrugMasterIds.filter((id) => {
    const master = masterById.get(id);
    return !master || !normalizeMedicationCode(master.yj_code);
  });
  if (invalidExplicitDrugMasterIds.length > 0) {
    return { ok: false, drugMasterIds: invalidExplicitDrugMasterIds };
  }

  const resolutions = buildDrugIdentityResolutionByCode(masters);
  const conflictingExplicitDrugMasterIds = Array.from(
    new Set(
      lines.flatMap((line) => {
        const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
        if (!explicitDrugMasterId) return [];
        return readPrescriptionLineDrugIdentityCodes(line).some((code) => {
          const resolution = resolveMedicationCode(code, resolutions);
          return resolution.status === 'resolved' && resolution.drug.id !== explicitDrugMasterId;
        })
          ? [explicitDrugMasterId]
          : [];
      }),
    ),
  );
  if (conflictingExplicitDrugMasterIds.length > 0) {
    return { ok: false, drugMasterIds: conflictingExplicitDrugMasterIds };
  }

  const resolvedLines: ResolvedCreateIntakeLineInput[] = lines.map((line) => {
    const sourceCode = readPrescriptionLineSourceDrugCode(line);
    const resolution = resolveMedicationCode(sourceCode, resolutions);
    const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
    const explicitDrugMaster = explicitDrugMasterId ? masterById.get(explicitDrugMasterId) : null;
    const explicitSourceCodeType = normalizePrescriptionLineSourceDrugCodeType(
      line.source_drug_code_type,
    );

    if (explicitDrugMaster) {
      const canonicalDrugCode =
        normalizeMedicationCode(explicitDrugMaster.yj_code) ?? explicitDrugMaster.yj_code;
      return {
        ...line,
        drug_code: canonicalDrugCode,
        drug_master_id: explicitDrugMaster.id,
        source_drug_code: sourceCode,
        source_drug_code_type: sourceCode
          ? resolution.status === 'resolved'
            ? resolution.sourceCodeSystem
            : explicitSourceCodeType
          : null,
        drug_resolution_status: 'resolved' as const,
      };
    }

    if (resolution.status === 'resolved') {
      return {
        ...line,
        drug_code: resolution.canonicalDrugCode,
        drug_master_id: resolution.drug.id,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: resolution.sourceCodeSystem,
        drug_resolution_status: 'resolved',
      };
    }

    if (resolution.status === 'ambiguous_code') {
      return {
        ...line,
        drug_code: null,
        drug_master_id: null,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: resolution.sourceCodeSystem,
        drug_resolution_status: 'ambiguous_code',
      };
    }

    if (resolution.status === 'code_not_found') {
      return {
        ...line,
        drug_code: null,
        drug_master_id: null,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: explicitSourceCodeType,
        drug_resolution_status: 'code_not_found',
      };
    }

    return {
      ...line,
      drug_code: null,
      drug_master_id: null,
      source_drug_code: null,
      source_drug_code_type: null,
      drug_resolution_status: 'missing_code',
    };
  });

  return { ok: true, lines: resolvedLines };
}

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

  const { medicationChanges, profileSyncResult } = await runPrescriptionIntakePostCreateHooks({
    cycleId: cycle.id,
    intakeId: intake.id,
    patientId: cycle.patient_id,
    orgId,
    lines: intake.lines,
    prescriberName: input.prescriber_name ?? null,
    sourceType: input.source_type,
  });

  try {
    await notifyWebhookEventForOrg(orgId, 'prescription.created', {
      intakeId: intake.id,
      cycleId: cycle.id,
      patientId: cycle.patient_id,
      sourceType: input.source_type,
      lineCount: intake.lines.length,
    });
  } catch {
    // Webhook delivery is best-effort and must not fail a committed intake.
  }

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
    drug_master_id?: string | null;
    drug_code?: string | null;
    dose: string;
    frequency: string;
    days?: number | null;
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
      detectIntakeChanges(args.orgId, args.patientId, args.intakeId),
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
  orgId: string,
  patientId: string,
  currentIntakeId: string,
): Promise<MedicationChange[]> {
  const { current, previous } = await findCurrentAndPreviousPrescriptionIntakesForMedicationDiff(
    prisma,
    {
      orgId,
      patientId,
      currentIntakeId,
    },
  );

  if (!current || !previous) return [];

  return detectMedicationChanges(current.lines, previous.lines);
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
  intakeLines: MedicationProfileSyncLine[],
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

  const drugMasterIdByCode = await resolveDrugMasterIdsByPrescriptionCode(intakeLines);
  const existingByKey = new Map<string, (typeof existingProfiles)[number]>();
  for (const profile of existingProfiles) {
    for (const key of profileKeys(profile)) {
      if (!existingByKey.has(key)) existingByKey.set(key, profile);
    }
  }
  const incomingKeys = new Set<string>();
  const profilesToCreate: Prisma.MedicationProfileCreateManyInput[] = [];

  // 新規処方の各行を upsert
  for (const line of intakeLines) {
    const drugCode = normalizePrescriptionDrugCode(line.drug_code);
    const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
    const resolvedDrugMasterId =
      explicitDrugMasterId ?? (drugCode ? (drugMasterIdByCode.get(drugCode) ?? null) : null);
    const keys = incomingLineKeys(line, resolvedDrugMasterId, drugCode);
    keys.forEach((key) => incomingKeys.add(key));

    const existing = keys.map((key) => existingByKey.get(key)).find(Boolean);
    const startDate = line.start_date
      ? typeof line.start_date === 'string'
        ? new Date(line.start_date)
        : line.start_date
      : new Date();

    if (existing) {
      const shouldRefreshDrugMasterId =
        resolvedDrugMasterId != null && existing.drug_master_id !== resolvedDrugMasterId;
      // 既存プロファイルを更新（dose/frequency またはマスタ解決結果が変わった場合のみ）
      if (
        existing.dose !== line.dose ||
        existing.frequency !== line.frequency ||
        shouldRefreshDrugMasterId
      ) {
        // テナント分離(二重防御): existing.id は org-scoped な findMany 由来だが、この sync は
        // RLS 外の global prisma 書込みのため WHERE に org_id を明示する。単一行更新だが
        // org_id を併用するため updateMany を使う(返り値 count は未使用、id 単独更新と挙動は等価)。
        await prisma.medicationProfile.updateMany({
          where: { id: existing.id, org_id: orgId },
          data: {
            ...(shouldRefreshDrugMasterId ? { drug_master_id: resolvedDrugMasterId } : {}),
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
      // 新規プロファイル作成。在宅の多剤併用では新規行が多数になり得るため、行ごとの
      // create(N 回の round-trip)を避け、ループ後に createMany で一括挿入する。
      // 各行は独立した新規プロファイルで相互依存しない。
      profilesToCreate.push({
        org_id: orgId,
        patient_id: patientId,
        drug_name: line.drug_name,
        drug_master_id: resolvedDrugMasterId,
        dose: line.dose,
        frequency: line.frequency,
        prescriber: prescriberName,
        start_date: startDate,
        is_current: true,
        source: sourceType === 'qr_scan' ? 'qr_scan' : 'prescription',
      });
      created++;
    }
  }

  // 新規プロファイルは多剤併用でも 1 回の挿入で済むよう一括作成する。
  if (profilesToCreate.length > 0) {
    await prisma.medicationProfile.createMany({ data: profilesToCreate });
  }

  // 今回の処方に含まれない既存プロファイルを中止扱い（一括更新）
  const idsToDiscontinue = existingProfiles
    .filter(
      (profile) =>
        (profile.source === 'prescription' || profile.source === 'qr_scan') &&
        profileKeys(profile).every((key) => !incomingKeys.has(key)),
    )
    .map((profile) => profile.id);

  if (idsToDiscontinue.length > 0) {
    const result = await prisma.medicationProfile.updateMany({
      where: { id: { in: idsToDiscontinue }, org_id: orgId },
      data: { is_current: false, end_date: new Date() },
    });
    discontinued = result.count;
  }

  return { created, updated, discontinued };
}

function normalizePrescriptionDrugCode(code: string | null | undefined) {
  return normalizeMedicationCode(code);
}

function profileKeys(profile: { drug_master_id?: string | null; drug_name: string }) {
  const drugMasterId = normalizePrescriptionDrugCode(profile.drug_master_id);
  if (drugMasterId) {
    // Some legacy rows stored a prescription drug code in drug_master_id before DrugMaster ids
    // were consistently synced. Keep that bridge separate from real canonical master identity.
    return [`master:${drugMasterId}`, `legacy-code:${drugMasterId}`];
  }

  const drugName = profile.drug_name.trim();
  return drugName ? [`name:${drugName}`] : [];
}

function incomingLineKeys(
  line: MedicationProfileSyncLine,
  resolvedDrugMasterId: string | null,
  normalizedDrugCode: string | null,
) {
  const keys: string[] = [];
  if (resolvedDrugMasterId) keys.push(`master:${resolvedDrugMasterId}`);
  if (normalizedDrugCode) {
    keys.push(`code:${normalizedDrugCode}`);
    if (resolvedDrugMasterId) keys.push(`legacy-code:${normalizedDrugCode}`);
  }
  if (normalizedDrugCode && !resolvedDrugMasterId) {
    const drugName = line.drug_name.trim();
    if (drugName) keys.push(`name:${drugName}`);
  }
  if (keys.length > 0) return keys;

  const drugName = line.drug_name.trim();
  return drugName ? [`name:${drugName}`] : [];
}

async function resolveDrugMasterIdsByPrescriptionCode(lines: MedicationProfileSyncLine[]) {
  const codes = Array.from(
    new Set(
      lines
        .filter((line) => !normalizePrescriptionLineDrugMasterId(line.drug_master_id))
        .map((line) => normalizePrescriptionDrugCode(line.drug_code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const byCode = new Map<string, string>();
  if (codes.length === 0) return byCode;

  // 3 列 OR を各列単体の findMany に分割(index が効く)。id で dedupe して結合する。
  const mastersById = new Map<
    string,
    { id: string; yj_code: string; receipt_code: string | null; hot_code: string | null }
  >();
  for (const where of buildDrugMasterCodeWheres(codes)) {
    const rows = await prisma.drugMaster.findMany({
      where,
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    for (const row of rows) {
      mastersById.set(row.id, row);
    }
  }
  const masters = [...mastersById.values()];

  // The shared resolver performs deterministic YJ-first resolution and leaves
  // duplicate receipt/HOT candidates unresolved instead of relying on DB order.
  const resolutions = buildDrugIdentityResolutionByCode(masters);
  for (const code of codes) {
    const resolution = resolveMedicationCode(code, resolutions);
    if (resolution.status === 'resolved') {
      byCode.set(code, resolution.drug.id);
    }
  }

  return byCode;
}
