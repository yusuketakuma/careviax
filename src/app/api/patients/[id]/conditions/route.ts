import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { updatePatientConditionsSchema } from '@/lib/validations/patient';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { AuthContext } from '@/lib/auth/context';

async function assertPatient(ctx: AuthContext, id: string) {
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) throw new Error('PATIENT_NOT_FOUND');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  try {
    await assertPatient(ctx, id);
  } catch {
    return notFound('患者が見つかりません');
  }

  const conditions = await prisma.patientCondition.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
    },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
  });

  return success({ data: conditions });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePatientConditionsSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  try {
    await assertPatient(ctx, id);
  } catch {
    return notFound('患者が見つかりません');
  }

  const data = await withOrgContext(ctx.orgId, async (tx) => {
    await tx.patientCondition.deleteMany({
      where: { org_id: ctx.orgId, patient_id: id },
    });
    if (parsed.data.conditions.length === 0) return [];

    await tx.patientCondition.createMany({
      data: parsed.data.conditions.map((condition) => ({
        org_id: ctx.orgId,
        patient_id: id,
        condition_type: condition.condition_type,
        name: condition.name,
        is_primary: condition.is_primary,
        is_active: condition.is_active,
        noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
        notes: condition.notes || null,
      })),
    });

    return tx.patientCondition.findMany({
      where: { org_id: ctx.orgId, patient_id: id },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });
  });

  return success({ data });
}
