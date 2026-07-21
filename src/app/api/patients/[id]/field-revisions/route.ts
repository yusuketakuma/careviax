import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { PATIENT_FIELD_REVISION_CATEGORIES } from '@/lib/patient/field-revision-categories';
import { getPatientPrivacyFlags } from '@/lib/patient/privacy';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { listPatientFieldRevisionPage } from '@/server/services/patient-field-revision-list';
import { z } from 'zod';

const fieldRevisionQuerySchema = z.object({
  category: z.enum(PATIENT_FIELD_REVISION_CATEGORIES).optional(),
  limit: boundedIntegerSearchParam('limit', 1, 200, 50),
});

async function authenticatedGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const url = new URL(req.url);
  const parsedQuery = parseSearchParams(fieldRevisionQuerySchema, url.searchParams);
  if (!parsedQuery.ok) {
    return validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors);
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: { id: true },
      });
      if (!patient) return null;

      const revisions = await listPatientFieldRevisionPage(tx, {
        orgId: ctx.orgId,
        patientId: patient.id,
        category: parsedQuery.data.category,
        limit: parsedQuery.data.limit,
        exposeSensitiveValues: !getPatientPrivacyFlags(ctx.role).sensitiveFieldsMasked,
      });
      return { patientId: patient.id, revisions };
    },
    { requestContext: ctx },
  );
  if (!result) return notFound('患者が見つかりません');

  const response = success({ data: result.revisions.data, meta: result.revisions.meta });

  recordPhiReadAuditForRequest(ctx, {
    patientId: result.patientId,
    targetType: 'patient',
    targetId: result.patientId,
    view: 'patient_field_revision_list',
    purpose: 'care',
  });

  return response;
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canVisit',
  message: '患者情報の閲覧権限がありません',
});
