import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { z } from 'zod';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

const updateInsuranceSchema = z.object({
  insurance_type: z.enum(['medical', 'care', 'public_subsidy']).optional(),
  insurer_number: z.string().max(8).optional().nullable(),
  symbol: z.string().max(100).optional().nullable(),
  number: z.string().max(20).optional().nullable(),
  branch_number: z.string().max(2).optional().nullable(),
  copay_ratio: z.number().int().min(0).max(100).optional().nullable(),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional()
    .nullable(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional()
    .nullable(),
  is_active: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateInsuranceSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  // Fold the patient-assignment access check into the resource query (single
  // round-trip). buildCareCaseAssignmentWhere returns null for owner/admin so
  // the relation filter is unset for privileged roles (bypass).
  const caseAssignmentWherePut = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const existing = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patient_id: id,
      org_id: ctx.orgId,
      ...(caseAssignmentWherePut ? { patient: { cases: { some: caseAssignmentWherePut } } } : {}),
    },
    select: { id: true },
  });
  if (!existing) return notFound('保険情報が見つかりません');

  const { valid_from, valid_until, ...rest } = parsed.data;

  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.patientInsurance.update({
      where: { id: insuranceId },
      data: {
        ...rest,
        ...(valid_from !== undefined
          ? { valid_from: valid_from ? new Date(valid_from) : null }
          : {}),
        ...(valid_until !== undefined
          ? { valid_until: valid_until ? new Date(valid_until) : null }
          : {}),
      },
    }),
  );

  return success({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const caseAssignmentWhereDelete = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const existing = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patient_id: id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhereDelete
        ? { patient: { cases: { some: caseAssignmentWhereDelete } } }
        : {}),
    },
    select: { id: true },
  });
  if (!existing) return notFound('保険情報が見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.patientInsurance.delete({
      where: { id: insuranceId },
    }),
  );

  return success({ id: insuranceId, deleted: true });
}
