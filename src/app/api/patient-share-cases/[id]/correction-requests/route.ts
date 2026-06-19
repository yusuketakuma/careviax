import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

type PharmacyOwner = 'base_pharmacy' | 'partner_pharmacy';
const correctionStatusSchema = z.enum(['open', 'responded', 'resolved', 'cancelled']);
const correctionTargetTypeSchema = z.enum([
  'patient_profile',
  'care_case',
  'management_plan',
  'visit_request',
  'partner_visit_record',
  'claim_note',
  'billing_candidate',
]);
const correctionRequestTypeSchema = z.enum(['correction', 'addition']);
const fieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.[\]-]+$/, '項目パスが不正です');

const ALLOWED_FIELD_PATHS_BY_TARGET_TYPE: Record<
  z.infer<typeof correctionTargetTypeSchema>,
  ReadonlySet<string>
> = {
  patient_profile: new Set([
    'name',
    'name_kana',
    'birth_date',
    'gender',
    'phone',
    'allergy_info',
    'notes',
    'primary_residence.address',
    'primary_residence.unit_name',
  ]),
  care_case: new Set([
    'referral_source',
    'referral_date',
    'start_date',
    'end_date',
    'primary_pharmacist_id',
    'required_visit_support',
    'notes',
  ]),
  management_plan: new Set(['content', 'goals', 'monitoring_items', 'review_schedule']),
  visit_request: new Set([
    'request_reason',
    'desired_start_at',
    'desired_end_at',
    'physician_instruction',
    'carry_items',
    'patient_home_notes',
  ]),
  partner_visit_record: new Set([
    'visit_at',
    'pharmacist_id',
    'pharmacist_name',
    'record_content',
    'attachments',
  ]),
  claim_note: new Set([
    'prescription_received_by',
    'dispensing_pharmacy_name',
    'claim_status',
    'claim_note_text',
  ]),
  billing_candidate: new Set(['billing_status', 'exclusion_reason', 'amount_snapshot']),
};

const REQUIRED_OWNER_BY_TARGET_TYPE: Record<
  z.infer<typeof correctionTargetTypeSchema>,
  PharmacyOwner
> = {
  patient_profile: 'base_pharmacy',
  care_case: 'base_pharmacy',
  management_plan: 'base_pharmacy',
  visit_request: 'base_pharmacy',
  partner_visit_record: 'partner_pharmacy',
  claim_note: 'base_pharmacy',
  billing_candidate: 'base_pharmacy',
};

const createCorrectionRequestSchema = z
  .object({
    target_type: correctionTargetTypeSchema,
    target_id: z.string().trim().min(1).max(128).optional(),
    field_path: fieldPathSchema.optional(),
    request_type: correctionRequestTypeSchema.default('correction'),
    reason: z.string().trim().min(1, '理由は必須です').max(1000),
    proposed_value: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.field_path &&
      !ALLOWED_FIELD_PATHS_BY_TARGET_TYPE[value.target_type].has(value.field_path)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['field_path'],
        message: '修正依頼できない項目です',
      });
    }
  });

function oppositeOwner(owner: PharmacyOwner) {
  return owner === 'base_pharmacy' ? 'partner_pharmacy' : 'base_pharmacy';
}

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

type SafeCorrectionRequestRow = {
  id: string;
  share_case_id: string;
  target_owner: string;
  target_type: string;
  target_id: string | null;
  field_path: string | null;
  request_type: string;
  status: string;
  requested_by: string;
  responded_by: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toSafeCorrectionRequest(row: SafeCorrectionRequestRow) {
  return {
    id: row.id,
    share_case_id: row.share_case_id,
    target_owner: row.target_owner,
    target_type: row.target_type,
    target_id: row.target_id,
    field_path: row.field_path,
    request_type: row.request_type,
    status: row.status,
    requested_by: row.requested_by,
    responded_by: row.responded_by,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const GET = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者共有ケースIDが不正です');

    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatus = optionalSearchParam(searchParams.get('status'));
    const status = rawStatus ? correctionStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const rows = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, base_patient_id: true },
      });
      if (!shareCase) return null;

      const correctionRequests = await tx.patientShareCorrectionRequest.findMany({
        where: {
          org_id: ctx.orgId,
          share_case_id: id,
          ...(status ? { status: status.data } : {}),
        },
        select: {
          id: true,
          share_case_id: true,
          target_owner: true,
          target_type: true,
          target_id: true,
          field_path: true,
          request_type: true,
          status: true,
          requested_by: true,
          responded_by: true,
          resolved_by: true,
          resolved_at: true,
          created_at: true,
          updated_at: true,
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });
      const pageRows = correctionRequests.slice(0, limit);

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_correction_requests_viewed',
        targetType: 'PatientShareCorrectionRequest',
        targetId: id,
        patientId: shareCase.base_patient_id,
        changes: {
          target_screen: 'patient_share_case_correction_requests',
          viewer_role: ctx.role,
          share_case_id: id,
          viewed_count: pageRows.length,
          correction_request_ids: pageRows.map((row) => row.id),
          statuses: [...new Set(pageRows.map((row) => row.status))].sort(),
          has_status_filter: Boolean(status),
          has_cursor: Boolean(cursor),
          has_more: correctionRequests.length > limit,
          limit,
        },
      });

      return correctionRequests;
    });

    if (!rows) return notFound('患者共有ケースが見つかりません');
    const page = buildCursorPage(rows, limit, (row) => row.id);
    return success({
      ...page,
      data: page.data.map(toSafeCorrectionRequest),
    });
  },
  {
    permission: 'canVisit',
    message: '修正依頼の閲覧権限がありません',
  },
);

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者共有ケースIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCorrectionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          base_patient_id: true,
          base_case_id: true,
          shared_management_plan_id: true,
        },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      if (shareCase.status !== 'active') {
        return { response: conflict('共有中の患者共有ケースにのみ修正依頼を作成できます') };
      }

      const targetOwner = REQUIRED_OWNER_BY_TARGET_TYPE[parsed.data.target_type];
      const requesterOwner = oppositeOwner(targetOwner);
      const targetId = parsed.data.target_id;
      const targetValid =
        parsed.data.target_type === 'patient_profile'
          ? !targetId || targetId === shareCase.base_patient_id
          : parsed.data.target_type === 'care_case'
            ? Boolean(targetId && targetId === shareCase.base_case_id)
            : parsed.data.target_type === 'management_plan'
              ? Boolean(targetId && targetId === shareCase.shared_management_plan_id)
              : parsed.data.target_type === 'visit_request'
                ? Boolean(
                    targetId &&
                    (await tx.pharmacyVisitRequest.findFirst({
                      where: { id: targetId, org_id: ctx.orgId, share_case_id: id },
                      select: { id: true },
                    })),
                  )
                : parsed.data.target_type === 'partner_visit_record'
                  ? Boolean(
                      targetId &&
                      (await tx.partnerVisitRecord.findFirst({
                        where: { id: targetId, org_id: ctx.orgId, share_case_id: id },
                        select: { id: true },
                      })),
                    )
                  : parsed.data.target_type === 'claim_note'
                    ? Boolean(
                        targetId &&
                        (await tx.claimCooperationNote.findFirst({
                          where: {
                            id: targetId,
                            org_id: ctx.orgId,
                            partner_visit_record: {
                              share_case_id: id,
                              org_id: ctx.orgId,
                            },
                          },
                          select: { id: true },
                        })),
                      )
                    : Boolean(
                        targetId &&
                        (await tx.visitBillingCandidate.findFirst({
                          where: {
                            id: targetId,
                            org_id: ctx.orgId,
                            partner_visit_record: {
                              share_case_id: id,
                              org_id: ctx.orgId,
                            },
                          },
                          select: { id: true },
                        })),
                      );
      if (!targetValid) {
        return {
          response: validationError('入力値が不正です', {
            target_id: ['修正依頼対象が患者共有ケースに紐づいていません'],
          }),
        };
      }

      const correctionRequest = await tx.patientShareCorrectionRequest.create({
        data: {
          org_id: ctx.orgId,
          share_case_id: id,
          target_owner: targetOwner,
          target_type: parsed.data.target_type,
          target_id: parsed.data.target_id,
          field_path: parsed.data.field_path,
          request_type: parsed.data.request_type,
          reason: parsed.data.reason,
          proposed_value:
            parsed.data.proposed_value === undefined
              ? undefined
              : toPrismaJsonInput(parsed.data.proposed_value),
          status: 'open',
          requested_by: ctx.userId,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_correction_requested',
        targetType: 'PatientShareCorrectionRequest',
        targetId: correctionRequest.id,
        patientId: shareCase.base_patient_id,
        changes: {
          share_case_id: id,
          requester_owner: requesterOwner,
          target_owner: targetOwner,
          target_type: parsed.data.target_type,
          target_id: parsed.data.target_id ?? null,
          field_path: parsed.data.field_path ?? null,
          request_type: parsed.data.request_type,
          reason_length: parsed.data.reason.length,
          has_proposed_value: parsed.data.proposed_value !== undefined,
        },
      });

      return { correctionRequest };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.correctionRequest, 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '修正依頼の作成権限がありません',
  },
);
