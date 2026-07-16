import { NextRequest } from 'next/server';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { normalizeJsonInput } from '@/lib/db/json';
import { success, validationError, notFound, conflict, forbidden } from '@/lib/api/response';
import { updateCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { Prisma } from '@prisma/client';
import {
  writePatientFieldRevisions,
  type PatientFieldRevisionEntry,
} from '@/server/services/patient-field-revision';

const WRITABLE_CASE_STATUSES = new Set(['referral_received', 'assessment', 'active', 'on_hold']);
const PHARMACIST_ASSIGNABLE_ROLES = new Set(['owner', 'admin', 'pharmacist', 'pharmacist_trainee']);
const STAFF_ASSIGNABLE_ROLES = new Set([...PHARMACIST_ASSIGNABLE_ROLES, 'clerk']);

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

function toRevisionValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

async function caseGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
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

  recordPhiReadAuditForRequest(ctx, {
    patientId: careCase.patient.id,
    targetType: 'care_case',
    targetId: careCase.id,
    view: 'care_case_detail',
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

export const GET = withAuthContext(caseGET, {
  permission: 'canViewDashboard',
  message: 'ケース参照の権限がありません',
});

async function casePATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateCaseSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    version,
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

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { user_id: ctx.userId, org_id: ctx.orgId, is_active: true },
        select: { role: true },
      });
      if (!membership || !hasPermission(membership.role, 'canVisit')) {
        return forbidden('ケース更新の権限がありません');
      }

      const freshAssignmentWhere = buildCareCaseAssignmentWhere({
        userId: ctx.userId,
        role: membership.role,
      });
      const existing = await tx.careCase.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(freshAssignmentWhere ? { AND: [freshAssignmentWhere] } : {}),
        },
      });
      if (!existing) return notFound('ケースが見つかりません');
      if (!WRITABLE_CASE_STATUSES.has(existing.status)) {
        return conflict('終了済みのケースは更新できません');
      }
      if (existing.version !== version) {
        return conflict('ケースが更新されています。再読み込みしてください', {
          expected_version: version,
          current_version: existing.version,
        });
      }

      const pharmacistIds = [normalizedPrimaryPharmacistId, normalizedBackupPharmacistId].filter(
        (value): value is string => Boolean(value),
      );
      const staffIds = [normalizedPrimaryStaffId, normalizedBackupStaffId].filter(
        (value): value is string => Boolean(value),
      );
      const assignedIds = Array.from(new Set([...pharmacistIds, ...staffIds]));
      if (assignedIds.length > 0) {
        const assignedMemberships = await tx.membership.findMany({
          where: { org_id: ctx.orgId, user_id: { in: assignedIds }, is_active: true },
          select: { user_id: true, role: true },
        });
        const assignedById = new Map(
          assignedMemberships.map((assigned) => [assigned.user_id, assigned.role]),
        );
        if (
          pharmacistIds.some(
            (userId) => !PHARMACIST_ASSIGNABLE_ROLES.has(assignedById.get(userId) ?? ''),
          )
        ) {
          return validationError('指定された薬剤師はこの組織に所属していません');
        }
        if (
          staffIds.some((userId) => !STAFF_ASSIGNABLE_ROLES.has(assignedById.get(userId) ?? ''))
        ) {
          return validationError('指定されたスタッフはこの組織に所属していません');
        }
      }

      const data: Prisma.CareCaseUpdateManyMutationInput = {
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
          ? { required_visit_support: normalizeInputJsonObject(required_visit_support) }
          : {}),
        version: { increment: 1 },
      };
      const updated = await tx.careCase.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          version,
          status: existing.status,
          ...(freshAssignmentWhere ? { AND: [freshAssignmentWhere] } : {}),
        },
        data,
      });
      if (updated.count !== 1) {
        return conflict('ケースが同時に更新されました。再読み込みしてください');
      }

      const careCase = await tx.careCase.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!careCase) return conflict('更新後のケースを取得できません');

      const revisionEntries: PatientFieldRevisionEntry[] = Object.entries(data)
        .filter(([fieldKey]) => fieldKey !== 'version')
        .map(([fieldKey, newValue]) => ({
          category: 'care_case',
          field_key: fieldKey,
          old_value: toRevisionValue(existing[fieldKey as keyof typeof existing]),
          new_value: toRevisionValue(newValue),
        }));
      await writePatientFieldRevisions(tx, {
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.id,
        actorId: ctx.userId,
        source: 'care_case_edit',
        entries: revisionEntries,
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'care_case_updated',
        targetType: 'CareCase',
        targetId: existing.id,
        patientId: existing.patient_id,
        changes: {
          changed_fields: revisionEntries.map((entry) => entry.field_key),
          previous_version: existing.version,
          version: careCase.version,
        },
      });

      return careCase;
    },
    { requestContext: ctx },
  );

  if (result instanceof Response) return result;
  return success({ data: result });
}

export const PATCH = withAuthContext(casePATCH, {
  permission: 'canVisit',
  message: 'ケース更新の権限がありません',
});
