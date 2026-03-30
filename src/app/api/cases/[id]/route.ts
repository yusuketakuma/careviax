import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケース参照の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const careCase = await prisma.careCase.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          name_kana: true,
        },
      },
    },
  });
  if (!careCase) return notFound('ケースが見つかりません');

  const firstVisitDoc = await prisma.firstVisitDocument.findFirst({
    where: { case_id: id, org_id: ctx.orgId },
    select: {
      id: true,
      delivered_at: true,
      delivered_to: true,
      document_url: true,
      created_at: true,
    },
  });

  return success({
    data: {
      ...careCase,
      first_visit_doc: firstVisitDoc
        ? {
            ...firstVisitDoc,
            delivered_at: firstVisitDoc.delivered_at?.toISOString() ?? null,
            created_at: firstVisitDoc.created_at.toISOString(),
          }
        : null,
      first_visit_doc_delivered: firstVisitDoc?.delivered_at != null,
    },
  });
}

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

  const {
    start_date,
    end_date,
    required_visit_support,
    primary_pharmacist_id,
    backup_pharmacist_id,
    ...rest
  } = parsed.data;
  const normalizedPrimaryPharmacistId =
    primary_pharmacist_id === '' ? null : primary_pharmacist_id;
  const normalizedBackupPharmacistId =
    backup_pharmacist_id === '' ? null : backup_pharmacist_id;

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
        ...(required_visit_support !== undefined
          ? {
              required_visit_support: required_visit_support as Prisma.InputJsonValue,
            }
          : {}),
        ...rest,
      },
    });
  }, { requestContext: ctx });

  return success(careCase);
}
