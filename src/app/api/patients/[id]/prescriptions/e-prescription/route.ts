import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError, error } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { formatUtcDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';
import {
  createEPrescriptionAdapter,
  EPrescriptionAdapterError,
} from '@/server/adapters/e-prescription';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { createPrescriptionIntake } from '@/server/services/prescription-intake-service';

const fetchEPrescriptionSchema = z.object({
  prescription_id: z.string().min(1),
  case_id: z.string().trim().min(1).optional(),
});

const ACCEPTABLE_EPRESCRIPTION_STATUSES = ['issued', 'partially_dispensed'] as const;
const EPRESCRIPTION_INTAKE_CYCLE_STATUSES = [
  'intake_received',
  'structuring',
  'inquiry_pending',
  'inquiry_resolved',
  'ready_to_dispense',
] as const;

function normalizeComparablePatientName(value: string | null | undefined) {
  return value?.replace(/\s+/g, '').trim() || null;
}

function dateKeyFromOptionalIso(value: string | null | undefined, fallback?: Date) {
  if (!value && !fallback) return null;
  const date = value ? new Date(value) : fallback;
  if (!date) return null;
  if (Number.isNaN(date.getTime())) return null;
  return formatUtcDateKey(date);
}

function toOptionalValue<T>(value: T | null | undefined) {
  return value == null ? undefined : value;
}

function buildEPrescriptionResponseData(input: {
  id: string;
  cycle_id: string;
  source_type: string;
  prescribed_date: Date | string;
  external_prescription_id?: string | null;
}) {
  const prescribedDate =
    input.prescribed_date instanceof Date
      ? formatUtcDateKey(input.prescribed_date)
      : input.prescribed_date.slice(0, 10);

  return {
    id: input.id,
    cycle_id: input.cycle_id,
    source_type: input.source_type,
    prescribed_date: prescribedDate,
    external_prescription_id: input.external_prescription_id ?? null,
  };
}

function ePrescriptionAdapterErrorResponse(cause: EPrescriptionAdapterError) {
  if (cause.code === 'NOT_IMPLEMENTED') {
    return error('EPRESCRIPTION_NOT_ENABLED', cause.message, 501);
  }
  if (cause.code === 'INVALID_CONFIGURATION') {
    return error(
      'EPRESCRIPTION_CONFIGURATION_ERROR',
      '電子処方箋連携の設定が不完全です。管理者に確認してください。',
      503,
      { retriable: false },
    );
  }
  if (cause.code === 'UNAUTHORIZED') {
    return error(
      'EPRESCRIPTION_UPSTREAM_UNAUTHORIZED',
      '電子処方箋 API の認証に失敗しました。連携設定を確認してください。',
      502,
      { retriable: false, upstream_status: cause.status ?? null },
    );
  }
  return error('EPRESCRIPTION_UPSTREAM_FAILURE', cause.message, cause.retriable ? 503 : 502, {
    retriable: cause.retriable,
    upstream_status: cause.status ?? null,
  });
}

type ExistingEPrescriptionIntake = {
  id: string;
  cycle_id: string;
  prescribed_date: Date;
  source_type: string;
  external_prescription_id: string | null;
  cycle: {
    case_id: string;
  };
};

async function findExistingEPrescriptionIntake(args: {
  orgId: string;
  patientId: string;
  caseIds: string[];
  externalPrescriptionId: string;
}): Promise<ExistingEPrescriptionIntake | null> {
  return withOrgContext(args.orgId, (tx) =>
    tx.prescriptionIntake.findFirst({
      where: {
        org_id: args.orgId,
        source_type: 'e_prescription',
        external_prescription_id: args.externalPrescriptionId,
        cycle: {
          patient_id: args.patientId,
          case_id: { in: args.caseIds },
        },
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        cycle_id: true,
        prescribed_date: true,
        source_type: true,
        external_prescription_id: true,
        cycle: {
          select: {
            case_id: true,
          },
        },
      },
    }),
  );
}

/**
 * POST /api/patients/[id]/prescriptions/e-prescription
 *
 * 電子処方箋管理サービスから処方箋を取得し、PrescriptionIntake として受付登録する。
 * JAHIS QR 以外の電子処方箋受付パス（処方箋IDを直接指定）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '電子処方箋受付の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawPatientId } = await params;
  const patientId = normalizeRequiredRouteParam(rawPatientId);
  if (!patientId) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = fetchEPrescriptionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const requestedCaseId = parsed.data.case_id;

  const writable = await requireWritablePatient(prisma, ctx, patientId);
  if ('response' in writable) return writable.response;

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id: patientId, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true, name: true },
  });
  if (!patient) return notFound('患者が見つかりません');
  const caseIds = await listAccessiblePatientCaseIds({
    db: prisma,
    orgId: ctx.orgId,
    patientId,
    accessContext: { userId: ctx.userId, role: ctx.role },
  });
  if (caseIds.length === 0) {
    return error(
      'NO_ACCESSIBLE_CASE',
      'この患者にアクセス可能なケースがありません。担当者割り当てを確認してください。',
      422,
    );
  }
  if (requestedCaseId && !caseIds.includes(requestedCaseId)) {
    return error(
      'CASE_NOT_ACCESSIBLE',
      '指定されたケースにアクセスできません。担当者割り当てを確認してください。',
      422,
    );
  }

  const existingByRequestId = await findExistingEPrescriptionIntake({
    orgId: ctx.orgId,
    patientId,
    caseIds,
    externalPrescriptionId: parsed.data.prescription_id,
  });
  if (existingByRequestId) {
    if (requestedCaseId && existingByRequestId.cycle.case_id !== requestedCaseId) {
      return error(
        'EPRESCRIPTION_CASE_CONFLICT',
        'この電子処方箋は別のケースで受付済みです。',
        409,
        { existing_case_id: existingByRequestId.cycle.case_id },
      );
    }
    return success(
      {
        data: buildEPrescriptionResponseData(existingByRequestId),
        e_prescription_id: existingByRequestId.external_prescription_id,
        idempotent: true,
      },
      200,
    );
  }

  let adapter;
  let ePrescription;
  try {
    adapter = createEPrescriptionAdapter({
      provider: (process.env.EPRESCRIPTION_PROVIDER as 'stub' | 'mhlw') ?? 'stub',
      baseUrl: process.env.EPRESCRIPTION_BASE_URL,
      apiKey: process.env.EPRESCRIPTION_API_KEY,
      accessToken: process.env.EPRESCRIPTION_ACCESS_TOKEN,
    });
    ePrescription = await adapter.fetchPrescription(parsed.data.prescription_id);
  } catch (cause) {
    if (cause instanceof EPrescriptionAdapterError) {
      return ePrescriptionAdapterErrorResponse(cause);
    }
    throw cause;
  }

  if (!ePrescription) return notFound('処方箋が見つかりません');
  if (!(ACCEPTABLE_EPRESCRIPTION_STATUSES as readonly string[]).includes(ePrescription.status)) {
    return validationError('受付できない状態の電子処方箋です', {
      status: [ePrescription.status],
    });
  }

  if (ePrescription.patientExternalId && ePrescription.patientExternalId !== patient.id) {
    return validationError('電子処方箋の患者IDが選択中の患者と一致しません');
  }

  const ePrescriptionPatientName = normalizeComparablePatientName(ePrescription.patientName);
  if (
    ePrescriptionPatientName &&
    ePrescriptionPatientName !== normalizeComparablePatientName(patient.name)
  ) {
    return validationError('電子処方箋の患者氏名が選択中の患者と一致しません');
  }

  const issuedDateKey = dateKeyFromOptionalIso(ePrescription.issuedAt, new Date());
  if (!issuedDateKey) return validationError('電子処方箋の発行日が不正です');
  const expiryDateKey = dateKeyFromOptionalIso(ePrescription.expiresAt);
  if (ePrescription.expiresAt && !expiryDateKey) {
    return validationError('電子処方箋の有効期限が不正です');
  }

  if (ePrescription.prescriptionId !== parsed.data.prescription_id) {
    const existing = await findExistingEPrescriptionIntake({
      orgId: ctx.orgId,
      patientId,
      caseIds,
      externalPrescriptionId: ePrescription.prescriptionId,
    });
    if (existing) {
      if (requestedCaseId && existing.cycle.case_id !== requestedCaseId) {
        return error(
          'EPRESCRIPTION_CASE_CONFLICT',
          'この電子処方箋は別のケースで受付済みです。',
          409,
          { existing_case_id: existing.cycle.case_id },
        );
      }
      return success(
        {
          data: buildEPrescriptionResponseData(existing),
          e_prescription_id: ePrescription.prescriptionId,
          idempotent: true,
        },
        200,
      );
    }
  }

  const cycleResult = await withOrgContext(ctx.orgId, async (tx) => {
    const cycles = await tx.medicationCycle.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: patientId,
        case_id: requestedCaseId ?? { in: caseIds },
        overall_status: { in: [...EPRESCRIPTION_INTAKE_CYCLE_STATUSES] },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, case_id: true },
    });

    if (cycles.length === 0) {
      return error(
        'NO_ACTIVE_CYCLE',
        'この患者にアクティブな服薬サイクルがありません。先にケースを開始してください。',
        422,
      );
    }

    if (cycles.length > 1) {
      return error(
        'AMBIGUOUS_ACTIVE_CYCLE',
        requestedCaseId
          ? '指定されたケースには受付可能な服薬サイクルが複数あります。サイクルを整理してから再実行してください。'
          : 'この患者には受付可能なケースが複数あります。case_id を指定してください。',
        409,
        { case_ids: Array.from(new Set(cycles.map((cycle) => cycle.case_id))) },
      );
    }

    const [cycle] = cycles;
    return { id: cycle.id };
  });

  if (cycleResult instanceof NextResponse) return cycleResult;

  let intakeResult;
  try {
    intakeResult = await createPrescriptionIntake(
      {
        cycle_id: cycleResult.id,
        source_type: 'e_prescription',
        external_prescription_id: ePrescription.prescriptionId,
        prescribed_date: issuedDateKey,
        prescriber_name: toOptionalValue(ePrescription.prescriberName),
        prescriber_institution: toOptionalValue(ePrescription.prescriberInstitution),
        prescription_expiry_date: expiryDateKey ?? undefined,
        refill_remaining_count: toOptionalValue(ePrescription.refillRemainingCount),
        lines: ePrescription.items.map((item) => ({
          line_number: item.lineNumber,
          drug_name: item.drugName,
          drug_code: toOptionalValue(item.drugCode),
          dose: item.dose,
          frequency: item.frequency,
          days: item.days,
          quantity: toOptionalValue(item.quantity),
          unit: toOptionalValue(item.unit),
          notes: toOptionalValue(item.notes),
        })),
      },
      ctx.orgId,
      ctx.userId,
      {
        accessContext: { userId: ctx.userId, role: ctx.role },
      },
    );
  } catch (cause) {
    if (!isPrismaUniqueConstraintError(cause)) throw cause;
    const replayed = await findExistingEPrescriptionIntake({
      orgId: ctx.orgId,
      patientId,
      caseIds,
      externalPrescriptionId: ePrescription.prescriptionId,
    });
    if (!replayed) throw cause;
    if (requestedCaseId && replayed.cycle.case_id !== requestedCaseId) {
      return error(
        'EPRESCRIPTION_CASE_CONFLICT',
        'この電子処方箋は別のケースで受付済みです。',
        409,
        { existing_case_id: replayed.cycle.case_id },
      );
    }
    return success(
      {
        data: buildEPrescriptionResponseData(replayed),
        e_prescription_id: ePrescription.prescriptionId,
        idempotent: true,
      },
      200,
    );
  }

  if (!intakeResult.ok) {
    if (intakeResult.error === 'cycle_not_found')
      return validationError('指定されたサイクルが見つかりません');
    if (intakeResult.error === 'duplicate_prescription_lines') {
      return validationError('重複候補の処方明細があるため受付できません', {
        duplicates: intakeResult.duplicates,
      });
    }
    if (intakeResult.error === 'structuring_blocked_lines') {
      return validationError('未構造化または不明な処方明細があるため受付を完了できません', {
        blocked_lines: intakeResult.blockedLines,
      });
    }
    if (intakeResult.error === 'outpatient_injection_not_eligible') {
      return validationError('外来/在宅自己注射として調剤可否が未確認の注射剤があります', {
        blocked_lines: intakeResult.blockedLines,
      });
    }
    if (intakeResult.error === 'expiry_exceeded') {
      return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
    }
    if (intakeResult.error === 'future_prescribed_date') {
      return validationError('未来日の処方箋は登録できません');
    }
    if (intakeResult.error === 'invalid_source_prescription_line') {
      return validationError(
        '流用元の前回処方が見つからないか、この患者・ケースでは利用できません',
      );
    }
    if (intakeResult.error === 'source_revision_conflict') {
      return error('CONFLICT', '前回処方が更新されています。再読み込みしてください', 409);
    }
    if (intakeResult.error === 'prescriber_institution_not_found') {
      return validationError(intakeResult.message);
    }
    if (intakeResult.error === 'invalid_transition') {
      return validationError('サイクルの状態遷移が無効です');
    }
    if (intakeResult.error === 'version_conflict') {
      return validationError('他のユーザーによって更新されています。再読み込みしてください');
    }
    return validationError('処方受付の作成に失敗しました');
  }

  return success(
    {
      data: buildEPrescriptionResponseData({
        id: intakeResult.intake.id,
        cycle_id: intakeResult.cycle.id,
        source_type: 'e_prescription',
        prescribed_date: issuedDateKey,
        external_prescription_id: ePrescription.prescriptionId,
      }),
      e_prescription_id: ePrescription.prescriptionId,
      idempotent: false,
    },
    201,
  );
}
