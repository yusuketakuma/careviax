import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { normalizeJsonInput } from '@/lib/db/json';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { Prisma } from '@prisma/client';

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function normalizeOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeOptionalDate(value: string | undefined) {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケース参照の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');
  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);

  const careCase = await prisma.careCase.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
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

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケース更新の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateCaseSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const existing = await prisma.careCase.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
  });
  if (!existing) return notFound('ケースが見つかりません');

  const {
    start_date,
    end_date,
    required_visit_support,
    primary_pharmacist_id,
    backup_pharmacist_id,
    primary_staff_id,
    backup_staff_id,
    referral_source,
    notes,
    end_reason,
    ...rest
  } = parsed.data;
  const normalizedPrimaryPharmacistId = primary_pharmacist_id === '' ? null : primary_pharmacist_id;
  const normalizedBackupPharmacistId = backup_pharmacist_id === '' ? null : backup_pharmacist_id;
  const normalizedPrimaryStaffId = primary_staff_id === '' ? null : primary_staff_id;
  const normalizedBackupStaffId = backup_staff_id === '' ? null : backup_staff_id;
  const normalizedStartDate = normalizeOptionalDate(start_date);
  const normalizedEndDate = normalizeOptionalDate(end_date);
  const normalizedReferralSource = normalizeOptionalText(referral_source);
  const normalizedNotes = normalizeOptionalText(notes);
  const normalizedEndReason = normalizeOptionalText(end_reason);

  const pharmacistIds = [normalizedPrimaryPharmacistId, normalizedBackupPharmacistId].filter(
    (value): value is string => Boolean(value),
  );
  const staffIds = [normalizedPrimaryStaffId, normalizedBackupStaffId].filter(
    (value): value is string => Boolean(value),
  );
  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(pharmacistIds.length > 0 ? { pharmacist_ids: pharmacistIds } : {}),
    ...(staffIds.length > 0 ? { staff_ids: staffIds } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const careCase = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.careCase.update({
        where: { id },
        data: {
          ...(normalizedStartDate !== undefined ? { start_date: normalizedStartDate } : {}),
          ...(normalizedEndDate !== undefined ? { end_date: normalizedEndDate } : {}),
          ...(normalizedPrimaryPharmacistId !== undefined
            ? { primary_pharmacist_id: normalizedPrimaryPharmacistId }
            : {}),
          ...(normalizedBackupPharmacistId !== undefined
            ? { backup_pharmacist_id: normalizedBackupPharmacistId }
            : {}),
          ...(normalizedPrimaryStaffId !== undefined
            ? { primary_staff_id: normalizedPrimaryStaffId }
            : {}),
          ...(normalizedBackupStaffId !== undefined
            ? { backup_staff_id: normalizedBackupStaffId }
            : {}),
          ...(normalizedReferralSource !== undefined
            ? { referral_source: normalizedReferralSource }
            : {}),
          ...(normalizedNotes !== undefined ? { notes: normalizedNotes } : {}),
          ...(normalizedEndReason !== undefined ? { end_reason: normalizedEndReason } : {}),
          ...(required_visit_support !== undefined
            ? {
                required_visit_support: normalizeInputJsonObject(required_visit_support),
              }
            : {}),
          ...rest,
        },
      });
    },
    { requestContext: ctx },
  );

  return success(careCase);
}
