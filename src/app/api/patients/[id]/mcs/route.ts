import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { parseOptionalBoundedIntegerParam } from '@/lib/api/pagination';
import {
  getPatientMcsOverview,
  PATIENT_MCS_MAX_MESSAGE_LIMIT,
  PATIENT_MCS_PROFILE_TASK_TYPE,
} from '@/server/services/patient-mcs';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

const mcsProfileSchema = z.object({
  linked_status: z.enum(['linked', 'unlinked', 'unknown']).default('unknown'),
  participation_status: z.enum(['invited', 'joined', 'not_joined', 'unknown']).default('unknown'),
  pharmacy_participants: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  counterpart_roles: z
    .array(z.enum(['physician', 'visiting_nurse', 'care_manager', 'family', 'facility', 'other']))
    .max(12)
    .default([]),
  last_checked_at: z.string().datetime().nullable().default(null),
  note: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .default(null)
    .transform((value) => (value && value.length > 0 ? value : null)),
});

async function authorizeMcsRequest(
  req: NextRequest,
  params: Promise<{ id: string }>,
  message: string,
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message,
  });
  if ('response' in authResult) return authResult;
  const ctx = authResult.ctx;
  if (!canViewSensitivePatientData(ctx.role)) {
    return { response: forbidden(message) };
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return { response: validationError('患者IDが不正です') };

  return { ctx, id };
}

async function loadVisibleMcsPatient(id: string, ctx: AuthContext) {
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true, name: true },
  });
  if (!patient) return { response: notFound('患者が見つかりません') };

  return { patient };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeMcsRequest(req, params, 'MCS 連携の閲覧権限がありません');
  if ('response' in authorized) return authorized.response;
  const { ctx, id } = authorized;

  const limitResult = parseOptionalBoundedIntegerParam(
    req.nextUrl.searchParams.get('limit'),
    0,
    PATIENT_MCS_MAX_MESSAGE_LIMIT,
  );
  if (!limitResult.ok) {
    return validationError(
      `limit は 0 から ${PATIENT_MCS_MAX_MESSAGE_LIMIT} の整数で指定してください`,
    );
  }
  const limit = limitResult.value;

  const patientResult = await loadVisibleMcsPatient(id, ctx);
  if ('response' in patientResult) return patientResult.response;
  const { patient } = patientResult;

  const data = await getPatientMcsOverview({
    orgId: ctx.orgId,
    patientId: id,
    limit,
  });

  return success({
    data: {
      patient,
      ...data,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeMcsRequest(req, params, 'MCS 連携の更新権限がありません');
  if ('response' in authorized) return authorized.response;
  const { ctx, id } = authorized;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = mcsProfileSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patientResult = await loadVisibleMcsPatient(id, ctx);
  if ('response' in patientResult) return patientResult.response;
  const { patient } = patientResult;

  const updatedAt = new Date();
  const profile = {
    ...parsed.data,
    updated_at: updatedAt,
  };

  await withOrgContext(ctx.orgId, async (tx) => {
    await upsertOperationalTask(tx, {
      orgId: ctx.orgId,
      taskType: PATIENT_MCS_PROFILE_TASK_TYPE,
      title: `${patient.name} MCS 連携プロフィール`,
      description: parsed.data.note,
      priority: 'normal',
      status: 'completed',
      dedupeKey: `patient_mcs_profile:${id}`,
      relatedEntityType: 'patient',
      relatedEntityId: id,
      metadata: parsed.data,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'patient_mcs_profile_updated',
      targetType: 'Patient',
      targetId: id,
      changes: parsed.data,
    });
  });

  return success({
    data: {
      profile,
    },
  });
}
