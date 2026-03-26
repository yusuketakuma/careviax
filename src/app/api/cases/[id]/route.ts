import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケース更新の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateCaseSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careCase.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('ケースが見つかりません');

  const normalizedPrimaryPharmacistId =
    parsed.data.primary_pharmacist_id === ''
      ? null
      : parsed.data.primary_pharmacist_id;
  const normalizedBackupPharmacistId =
    parsed.data.backup_pharmacist_id === ''
      ? null
      : parsed.data.backup_pharmacist_id;
  const { start_date, end_date, ...rest } = parsed.data;

  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(normalizedPrimaryPharmacistId
      ? { pharmacist_id: normalizedPrimaryPharmacistId }
      : {}),
    ...(normalizedBackupPharmacistId
      ? { pharmacist_id: normalizedBackupPharmacistId }
      : {}),
  });
  if (!refResult.ok) return refResult.response;

  const careCase = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.careCase.update({
      where: { id },
      data: {
        ...(start_date ? { start_date: new Date(start_date) } : {}),
        ...(end_date ? { end_date: new Date(end_date) } : {}),
        ...(normalizedPrimaryPharmacistId !== undefined
          ? { primary_pharmacist_id: normalizedPrimaryPharmacistId }
          : {}),
        ...(normalizedBackupPharmacistId !== undefined
          ? { backup_pharmacist_id: normalizedBackupPharmacistId }
          : {}),
        ...rest,
      },
    });
  });

  return success(careCase);
}
