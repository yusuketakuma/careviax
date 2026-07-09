import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { verifyClinicalExternalReferencePatientLink } from '@/server/services/standard-clinical-patient-linkage';

const verifySchema = z
  .object({
    external_reference_id: z.string().trim().min(1).max(200),
  })
  .strict();

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx, { params }) => {
    const { id: rawId } = await params;
    const patientId = normalizeRequiredRouteParam(rawId);
    if (!patientId) return validationError('患者IDが不正です');

    const body = await parseJsonObjectRequestBodyOrError(req, verifySchema, {
      invalidBody: 'リクエストボディが不正です',
      invalidInput: '入力値が不正です',
    });
    if (!body.ok) return body.response;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id: patientId, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: { id: true },
      });
      if (!patient) return { kind: 'patient_not_found' as const };

      const linkResult = await verifyClinicalExternalReferencePatientLink(tx, {
        orgId: ctx.orgId,
        patientId,
        externalReferenceId: body.data.external_reference_id,
        verifiedByUserId: ctx.userId,
      });
      if (!linkResult) return { kind: 'reference_not_found' as const };
      return { kind: 'linked' as const, linkResult };
    });

    if (result.kind === 'patient_not_found') return notFound('患者が見つかりません');
    if (result.kind === 'reference_not_found') {
      return notFound('外部clinical referenceが見つかりません');
    }

    return success({
      data: {
        external_reference_id: result.linkResult.externalReferenceId,
        patient_id: result.linkResult.patientId,
        updated_cache_count: result.linkResult.updatedCacheCount,
        requeued_queue_item_count: result.linkResult.requeuedQueueItemCount,
      },
    });
  },
  {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  },
);

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
}
