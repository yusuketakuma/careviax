import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updatePharmacistCredentialSchema } from '@/lib/validations/pharmacist-credential';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬剤師認定情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const credentialId = normalizeRequiredRouteParam(id);
  if (!credentialId) return validationError('薬剤師認定情報IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePharmacistCredentialSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.pharmacistCredential.findFirst({
    where: { id: credentialId, org_id: ctx.orgId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  if (!existing) return notFound('薬剤師認定情報が見つかりません');

  if (parsed.data.user_id) {
    const refResult = await validateOrgReferences(ctx.orgId, {
      pharmacist_id: parsed.data.user_id,
    });
    if (!refResult.ok) return refResult.response;
  }

  const updated = await prisma.pharmacistCredential.update({
    where: { id: credentialId },
    data: {
      ...(parsed.data.user_id !== undefined ? { user_id: parsed.data.user_id } : {}),
      ...(parsed.data.certification_type !== undefined
        ? { certification_type: parsed.data.certification_type }
        : {}),
      ...(parsed.data.certification_number !== undefined
        ? { certification_number: parsed.data.certification_number ?? null }
        : {}),
      ...(parsed.data.issued_date !== undefined
        ? { issued_date: parsed.data.issued_date ? new Date(parsed.data.issued_date) : null }
        : {}),
      ...(parsed.data.expiry_date !== undefined
        ? { expiry_date: parsed.data.expiry_date ? new Date(parsed.data.expiry_date) : null }
        : {}),
      ...(parsed.data.tenure_years !== undefined ? { tenure_years: parsed.data.tenure_years } : {}),
      ...(parsed.data.weekly_work_hours !== undefined
        ? { weekly_work_hours: parsed.data.weekly_work_hours }
        : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return success({
    data: {
      id: updated.id,
      user_id: updated.user.id,
      user_name: updated.user.name,
      certification_type: updated.certification_type,
      certification_number: updated.certification_number,
      issued_date: updated.issued_date?.toISOString() ?? null,
      expiry_date: updated.expiry_date?.toISOString() ?? null,
      tenure_years: updated.tenure_years,
      weekly_work_hours: updated.weekly_work_hours,
      consented_patients: [],
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬剤師認定情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const credentialId = normalizeRequiredRouteParam(id);
  if (!credentialId) return validationError('薬剤師認定情報IDが不正です');

  const existing = await prisma.pharmacistCredential.findFirst({
    where: { id: credentialId, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('薬剤師認定情報が見つかりません');

  await prisma.pharmacistCredential.delete({
    where: { id: credentialId },
  });

  return success({ message: '薬剤師認定情報を削除しました' });
}
