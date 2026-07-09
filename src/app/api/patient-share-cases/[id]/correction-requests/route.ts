import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  correctionRequestFieldPathSchema,
  correctionRequestTypeSchema,
  correctionTargetTypeSchema,
  isPatientShareCorrectionFieldPath,
  toPatientShareCorrectionRequestRow,
} from '@/lib/patient-share/correction-request-domain';
import { resolvePatientShareCorrectionRequestPolicy } from '@/server/services/patient-share-policy';

const correctionStatusSchema = z.enum(['open', 'responded', 'resolved', 'cancelled']);

const createCorrectionRequestSchema = z
  .object({
    target_type: correctionTargetTypeSchema,
    target_id: z.string().trim().min(1).max(128).optional(),
    field_path: correctionRequestFieldPathSchema.optional(),
    request_type: correctionRequestTypeSchema.default('correction'),
    reason: z.string().trim().min(1, '理由は必須です').max(1000),
    proposed_value: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.field_path &&
      !isPatientShareCorrectionFieldPath(value.target_type, value.field_path)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['field_path'],
        message: '修正依頼できない項目です',
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

const authenticatedGET = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者共有ケースIDが不正です');

    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!rawStatusResult.ok) return rawStatusResult.response;
    const rawStatus = rawStatusResult.value;
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
      const page = buildCursorPage(correctionRequests, limit, (row) => row.id);

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_correction_requests_viewed',
        targetType: 'PatientShareCorrectionRequest',
        targetId: id,
        patientId: shareCase.base_patient_id,
        changes: {
          target_screen: 'patient_share_case_correction_requests',
          viewer_role: ctx.role,
          share_case_id: id,
          viewed_count: page.data.length,
          correction_request_ids: page.data.map((row) => row.id),
          statuses: [...new Set(page.data.map((row) => row.status))].sort(),
          has_status_filter: Boolean(status),
          has_cursor: Boolean(cursor),
          has_more: page.hasMore,
          limit,
        },
      });

      return page;
    });

    if (!rows) return notFound('患者共有ケースが見つかりません');
    return success({
      data: rows.data.map(toPatientShareCorrectionRequestRow),
      meta: {
        has_more: rows.hasMore,
        next_cursor: rows.nextCursor ?? null,
      },
    });
  },
  {
    permission: 'canVisit',
    message: '修正依頼の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext<{ id: string }>(
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
      const correctionPolicy = resolvePatientShareCorrectionRequestPolicy({
        shareCaseStatus: shareCase.status,
        targetType: parsed.data.target_type,
      });
      if (!correctionPolicy.allowed) {
        return { response: conflict('共有中の患者共有ケースにのみ修正依頼を作成できます') };
      }

      const { requesterOwner, targetOwner } = correctionPolicy;
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
    return success({ data: toPatientShareCorrectionRequestRow(result.correctionRequest) }, 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '修正依頼の作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};
