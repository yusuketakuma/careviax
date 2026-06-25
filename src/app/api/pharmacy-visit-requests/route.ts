import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { formatUtcDateKey } from '@/lib/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { visitTypeValues } from '@/lib/validations/visit-schedule';
import { buildActivePatientShareCaseReadWhere } from '@/server/services/patient-share-access';

const visitRequestStatusSchema = z.enum([
  'draft',
  'requested',
  'accepted',
  'declined',
  'scheduled',
  'visited',
  'recording',
  'submitted',
  'base_reviewing',
  'returned',
  'confirmed',
  'physician_report_created',
  'claim_checked',
  'completed',
]);
const urgencySchema = z.enum(['normal', 'urgent', 'emergency']);

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

const optionalIsoDateTime = z
  .string()
  .datetime('日時形式が不正です')
  .transform((value) => new Date(value))
  .optional();

const createVisitRequestSchema = z
  .object({
    share_case_id: z.string().trim().min(1, '患者共有ケースIDは必須です'),
    urgency: urgencySchema.default('normal'),
    desired_start_at: optionalIsoDateTime,
    desired_end_at: optionalIsoDateTime,
    visit_type: z.enum(visitTypeValues).optional(),
    request_reason: z.string().trim().min(1, '依頼理由は必須です').max(2000),
    physician_instruction: optionalTrimmedString(2000),
    carry_items: z.unknown().optional(),
    patient_home_notes: optionalTrimmedString(2000),
  })
  .superRefine((value, ctx) => {
    if (
      value.desired_start_at &&
      value.desired_end_at &&
      value.desired_end_at <= value.desired_start_at
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['desired_end_at'],
        message: '希望終了日時は開始日時より後にしてください',
      });
    }
  });

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
}

function optionalJson(value: unknown) {
  return value === undefined ? undefined : toPrismaJsonInput(value);
}

function toSafeVisitRequest<T extends object>(row: T) {
  const source = row as T & {
    request_reason?: unknown;
    physician_instruction?: unknown;
    carry_items?: unknown;
    patient_home_notes?: unknown;
    decline_reason?: unknown;
  };
  const {
    request_reason: requestReason,
    physician_instruction: physicianInstruction,
    carry_items: carryItems,
    patient_home_notes: patientHomeNotes,
    decline_reason: declineReason,
    ...safe
  } = source;

  return {
    ...safe,
    has_request_reason: requestReason !== undefined && requestReason !== null,
    has_physician_instruction: physicianInstruction !== undefined && physicianInstruction !== null,
    has_carry_items: carryItems !== undefined && carryItems !== null,
    has_patient_home_notes: patientHomeNotes !== undefined && patientHomeNotes !== null,
    has_decline_reason: declineReason !== undefined && declineReason !== null,
  };
}

function dateOnlyFromDate(value: Date) {
  return utcDateFromLocalKey(formatUtcDateKey(value));
}

function inDateWindow(args: { asOf: Date; from: Date | null; to: Date | null }) {
  const asOfTime = dateOnlyFromDate(args.asOf).getTime();
  if (args.from && asOfTime < dateOnlyFromDate(args.from).getTime()) return false;
  if (args.to && asOfTime > dateOnlyFromDate(args.to).getTime()) return false;
  return true;
}

async function resolveContractEstimate(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  partnershipId: string;
  asOf: Date;
}) {
  const asOfDate = dateOnlyFromDate(args.asOf);
  const contract = await args.tx.pharmacyContract.findFirst({
    where: {
      org_id: args.orgId,
      partnership_id: args.partnershipId,
      status: 'active',
      OR: [{ effective_from: null }, { effective_from: { lte: asOfDate } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: asOfDate } }] }],
    },
    orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
    select: { id: true, closing_day: true, payment_due_rule: true },
  });

  if (!contract) {
    return {
      contractId: null,
      contractVersionId: null,
      estimatedAmount: null,
      snapshot: {
        estimate_status: 'missing_active_contract',
        as_of: formatUtcDateKey(asOfDate),
      },
    };
  }

  const version = await args.tx.pharmacyContractVersion.findFirst({
    where: {
      org_id: args.orgId,
      contract_id: contract.id,
      status: 'active',
      effective_from: { lte: asOfDate },
      OR: [{ effective_to: null }, { effective_to: { gte: asOfDate } }],
    },
    orderBy: [{ effective_from: 'desc' }, { version_no: 'desc' }],
    include: {
      fee_rules: {
        where: { is_active: true },
        orderBy: { created_at: 'asc' },
        take: 1,
      },
    },
  });

  if (!version) {
    return {
      contractId: contract.id,
      contractVersionId: null,
      estimatedAmount: null,
      snapshot: {
        estimate_status: 'missing_active_contract_version',
        as_of: formatUtcDateKey(asOfDate),
        contract_id: contract.id,
      },
    };
  }

  const feeRule = version.fee_rules[0] ?? null;
  if (!feeRule) {
    return {
      contractId: contract.id,
      contractVersionId: version.id,
      estimatedAmount: null,
      snapshot: {
        estimate_status: 'missing_fee_rule',
        as_of: formatUtcDateKey(asOfDate),
        contract_id: contract.id,
        contract_version_id: version.id,
      },
    };
  }

  const estimatedAmount =
    feeRule.billing_model === 'free'
      ? 0
      : feeRule.billing_model === 'fixed_per_visit' ||
          feeRule.billing_model === 'per_visit_with_addon'
        ? (feeRule.unit_price ?? null)
        : null;

  return {
    contractId: contract.id,
    contractVersionId: version.id,
    estimatedAmount,
    snapshot: {
      estimate_status: estimatedAmount === null ? 'manual_estimate_required' : 'estimated',
      as_of: formatUtcDateKey(asOfDate),
      contract_id: contract.id,
      contract_version_id: version.id,
      fee_rule_id: feeRule.id,
      billing_model: feeRule.billing_model,
      unit_price: feeRule.unit_price ?? null,
      tax_category: feeRule.tax_category,
      estimated_amount: estimatedAmount,
      closing_day: contract.closing_day ?? null,
      has_payment_due_rule: contract.payment_due_rule !== null,
    },
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!rawStatusResult.ok) return rawStatusResult.response;
    const rawStatus = rawStatusResult.value;
    const status = rawStatus ? visitRequestStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const shareCaseIdResult = readPresentOptionalSearchParam(
      searchParams,
      'share_case_id',
      '患者共有ケースIDを指定してください',
    );
    if (!shareCaseIdResult.ok) return shareCaseIdResult.response;
    const partnerPharmacyIdResult = readPresentOptionalSearchParam(
      searchParams,
      'partner_pharmacy_id',
      '協力薬局IDを指定してください',
    );
    if (!partnerPharmacyIdResult.ok) return partnerPharmacyIdResult.response;
    const shareCaseId = shareCaseIdResult.value;
    const partnerPharmacyId = partnerPharmacyIdResult.value;
    const now = new Date();

    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.pharmacyVisitRequest.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(shareCaseId ? { share_case_id: shareCaseId } : {}),
          ...(partnerPharmacyId ? { partner_pharmacy_id: partnerPharmacyId } : {}),
          share_case: { is: buildActivePatientShareCaseReadWhere({ orgId: ctx.orgId, asOf: now }) },
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          org_id: true,
          share_case_id: true,
          partnership_id: true,
          partner_pharmacy_id: true,
          requested_by: true,
          urgency: true,
          desired_start_at: true,
          desired_end_at: true,
          visit_type: true,
          status: true,
          contract_id: true,
          contract_version_id: true,
          estimated_amount: true,
          estimated_snapshot: true,
          accepted_by: true,
          accepted_at: true,
          declined_by: true,
          declined_at: true,
          cancelled_at: true,
          completed_at: true,
          created_at: true,
          updated_at: true,
          partner_pharmacy: { select: { id: true, name: true, status: true } },
          partnership: {
            select: {
              id: true,
              base_site: { select: { id: true, name: true } },
            },
          },
        },
      }),
    );

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return success({
      ...page,
      data: page.data.map(toSafeVisitRequest),
    });
  },
  {
    permission: 'canManagePatientSharing',
    message: '訪問依頼の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createVisitRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const estimateAsOf = parsed.data.desired_start_at ?? now;
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id: parsed.data.share_case_id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          starts_at: true,
          ends_at: true,
          partnership_id: true,
          partnership: {
            select: {
              id: true,
              status: true,
              effective_from: true,
              effective_to: true,
              partner_pharmacy_id: true,
              partner_pharmacy: { select: { id: true, status: true, name: true } },
              base_site: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      if (shareCase.status !== 'active') {
        return { response: conflict('共有中の患者共有ケースにのみ訪問依頼を作成できます') };
      }
      if (shareCase.partnership.status !== 'active') {
        return { response: conflict('有効な薬局間連携でのみ訪問依頼を作成できます') };
      }
      if (shareCase.partnership.partner_pharmacy.status !== 'active') {
        return { response: conflict('有効な協力薬局にのみ訪問依頼を作成できます') };
      }
      if (
        !inDateWindow({
          asOf: estimateAsOf,
          from: shareCase.starts_at,
          to: shareCase.ends_at,
        }) ||
        !inDateWindow({
          asOf: estimateAsOf,
          from: shareCase.partnership.effective_from,
          to: shareCase.partnership.effective_to,
        })
      ) {
        return { response: conflict('希望訪問日は患者共有または薬局間連携の有効期間外です') };
      }

      const estimate = await resolveContractEstimate({
        tx,
        orgId: ctx.orgId,
        partnershipId: shareCase.partnership_id,
        asOf: estimateAsOf,
      });

      const visitRequest = await tx.pharmacyVisitRequest.create({
        data: {
          org_id: ctx.orgId,
          share_case_id: shareCase.id,
          partnership_id: shareCase.partnership_id,
          partner_pharmacy_id: shareCase.partnership.partner_pharmacy_id,
          requested_by: ctx.userId,
          urgency: parsed.data.urgency,
          desired_start_at: parsed.data.desired_start_at,
          desired_end_at: parsed.data.desired_end_at,
          visit_type: parsed.data.visit_type,
          status: 'requested',
          request_reason: parsed.data.request_reason,
          physician_instruction: parsed.data.physician_instruction,
          carry_items: optionalJson(parsed.data.carry_items),
          patient_home_notes: parsed.data.patient_home_notes,
          contract_id: estimate.contractId,
          contract_version_id: estimate.contractVersionId,
          estimated_amount: estimate.estimatedAmount,
          estimated_snapshot: toPrismaJsonInput(estimate.snapshot),
        },
        include: {
          partner_pharmacy: { select: { id: true, name: true, status: true } },
          partnership: {
            select: {
              id: true,
              base_site: { select: { id: true, name: true } },
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_visit_request_created',
        targetType: 'PharmacyVisitRequest',
        targetId: visitRequest.id,
        changes: {
          share_case_id: shareCase.id,
          partnership_id: shareCase.partnership_id,
          partner_pharmacy_id: shareCase.partnership.partner_pharmacy_id,
          status: visitRequest.status,
          urgency: visitRequest.urgency,
          visit_type: visitRequest.visit_type ?? null,
          desired_start_at: visitRequest.desired_start_at?.toISOString() ?? null,
          desired_end_at: visitRequest.desired_end_at?.toISOString() ?? null,
          request_reason_length: parsed.data.request_reason.length,
          has_physician_instruction: parsed.data.physician_instruction !== undefined,
          has_carry_items: parsed.data.carry_items !== undefined,
          has_patient_home_notes: parsed.data.patient_home_notes !== undefined,
          contract_id: estimate.contractId,
          contract_version_id: estimate.contractVersionId,
          estimated_amount: estimate.estimatedAmount,
          estimate_status: estimate.snapshot.estimate_status,
        },
      });

      return { visitRequest: toSafeVisitRequest(visitRequest) };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.visitRequest, 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '訪問依頼の作成権限がありません',
  },
);
