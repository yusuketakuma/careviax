import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { updateInterventionSchema } from '@/lib/validations/intervention';
import { prisma } from '@/lib/db/client';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientIds } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

async function buildInterventionAssignmentWhere(args: {
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.InterventionWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const patientIds = await listAccessiblePatientIds({
    db: prisma,
    orgId: args.orgId,
    accessContext: args.accessContext,
  });

  return { patient_id: { in: patientIds } };
}

async function getIntervention(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('介入記録IDが不正です');

  const assignmentWhere = await buildInterventionAssignmentWhere({
    orgId: ctx.orgId,
    accessContext: { userId: ctx.userId, role: ctx.role },
  });

  const intervention = await prisma.intervention.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
  });
  if (!intervention) return notFound('介入記録が見つかりません');

  recordPhiReadAuditForRequest(ctx, {
    patientId: intervention.patient_id,
    targetType: 'intervention',
    targetId: intervention.id,
    view: 'intervention_detail',
  });

  return success({ data: intervention });
}

async function updateIntervention(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('介入記録IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateInterventionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentWhere = await buildInterventionAssignmentWhere({
    orgId: ctx.orgId,
    accessContext: { userId: ctx.userId, role: ctx.role },
  });

  const existing = await prisma.intervention.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: { id: true },
  });
  if (!existing) return notFound('介入記録が見つかりません');

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.performed_at) {
    updateData.performed_at = new Date(parsed.data.performed_at);
  }

  const intervention = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.intervention.update({
      where: { id },
      data: updateData,
    });
  });

  return success({ data: intervention });
}

const authenticatedGET = withAuthContext(getIntervention, {
  permission: 'canVisit',
  message: '介入記録の閲覧権限がありません',
});

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const PATCH = withAuthContext(updateIntervention, {
  permission: 'canVisit',
  message: '介入記録の更新権限がありません',
});
