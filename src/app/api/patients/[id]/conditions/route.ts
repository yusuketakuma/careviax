import { format } from 'date-fns';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { updatePatientConditionsSchema } from '@/lib/validations/patient';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { AuthContext } from '@/lib/auth/context';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  sortJsonArrayStable,
  writePatientFieldRevisions,
} from '@/server/services/patient-field-revision';

type ConditionAuditSubject = {
  condition_type: string;
  name?: string | null;
  is_primary?: boolean | null;
  is_active?: boolean | null;
  noted_at?: Date | string | null;
  notes?: string | null;
};

function countConditionTypes(conditions: ConditionAuditSubject[]) {
  return conditions.reduce<Record<string, number>>((counts, condition) => {
    counts[condition.condition_type] = (counts[condition.condition_type] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeConditionsForAudit(conditions: ConditionAuditSubject[]) {
  return conditions.map((condition) => ({
    condition_type: condition.condition_type,
    is_primary: Boolean(condition.is_primary),
    is_active: Boolean(condition.is_active),
    has_noted_at: Boolean(condition.noted_at),
    has_notes: typeof condition.notes === 'string' && condition.notes.trim().length > 0,
  }));
}

function buildConditionReplacementAuditChanges(args: {
  beforeConditions: ConditionAuditSubject[];
  afterConditions: ConditionAuditSubject[];
}) {
  const countActive = (conditions: ConditionAuditSubject[]) =>
    conditions.filter((condition) => Boolean(condition.is_active)).length;
  const countPrimary = (conditions: ConditionAuditSubject[]) =>
    conditions.filter((condition) => Boolean(condition.is_primary)).length;

  return {
    before_count: args.beforeConditions.length,
    after_count: args.afterConditions.length,
    active_count_before: countActive(args.beforeConditions),
    active_count_after: countActive(args.afterConditions),
    primary_count_before: countPrimary(args.beforeConditions),
    primary_count_after: countPrimary(args.afterConditions),
    condition_type_counts_before: countConditionTypes(args.beforeConditions),
    condition_type_counts_after: countConditionTypes(args.afterConditions),
    before: summarizeConditionsForAudit(args.beforeConditions),
    after: summarizeConditionsForAudit(args.afterConditions),
  };
}

function normalizeConditionRevisionSnapshot(condition: ConditionAuditSubject) {
  return {
    condition_type: condition.condition_type,
    name: condition.name ?? null,
    is_primary: Boolean(condition.is_primary),
    is_active: Boolean(condition.is_active),
    noted_at: condition.noted_at ? format(new Date(condition.noted_at), 'yyyy-MM-dd') : null,
    notes: condition.notes ?? null,
  };
}

function staleConditionsConflict(expectedUpdatedAt: string, currentUpdatedAt: Date | null) {
  return conflict('患者病名・問題が他の操作で更新されています。再読み込みしてください', {
    conflict_type: 'stale_patient_conditions',
    expected_updated_at: expectedUpdatedAt,
    current_updated_at: currentUpdatedAt?.toISOString() ?? null,
  });
}

async function assertPatient(ctx: AuthContext, id: string) {
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true, updated_at: true },
  });
  if (!patient) throw new Error('PATIENT_NOT_FOUND');
  return patient;
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  let patient;
  try {
    patient = await assertPatient(ctx, id);
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

  return success({
    data: conditions,
    metadata: {
      expected_updated_at: patient.updated_at.toISOString(),
      version_basis: 'patient_updated_at',
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

async function authenticatedPUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const nextUpdatedAt = new Date();
      const claimed = await tx.patient.updateMany({
        where: { id, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data: { updated_at: nextUpdatedAt },
      });
      if (claimed.count !== 1) {
        const currentPatient = await tx.patient.findFirst({
          where: applyPatientAssignmentWhere(
            { id, org_id: ctx.orgId },
            { userId: ctx.userId, role: ctx.role },
          ),
          select: { updated_at: true },
        });
        return {
          kind: 'response' as const,
          response: staleConditionsConflict(
            parsed.data.expected_updated_at,
            currentPatient?.updated_at ?? null,
          ),
        };
      }

      const beforeConditions = await tx.patientCondition.findMany({
        where: { org_id: ctx.orgId, patient_id: id },
        select: {
          condition_type: true,
          name: true,
          is_primary: true,
          is_active: true,
          noted_at: true,
          notes: true,
        },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });

      const beforeSnapshot = sortJsonArrayStable(
        beforeConditions.map(normalizeConditionRevisionSnapshot),
      );

      await tx.patientCondition.deleteMany({
        where: { org_id: ctx.orgId, patient_id: id },
      });

      if (parsed.data.conditions.length > 0) {
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
      }

      const afterConditions = await tx.patientCondition.findMany({
        where: { org_id: ctx.orgId, patient_id: id },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });

      const afterSnapshot = sortJsonArrayStable(
        afterConditions.map(normalizeConditionRevisionSnapshot),
      );

      await writePatientFieldRevisions(tx, {
        orgId: ctx.orgId,
        patientId: id,
        actorId: ctx.userId,
        entries: [
          {
            category: 'conditions',
            field_key: 'conditions',
            field_label: '病名・問題',
            old_value: beforeSnapshot.length > 0 ? beforeSnapshot : null,
            new_value: afterSnapshot.length > 0 ? afterSnapshot : null,
          },
        ],
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_conditions_replaced',
        targetType: 'Patient',
        targetId: id,
        patientId: id,
        changes: buildConditionReplacementAuditChanges({
          beforeConditions,
          afterConditions,
        }),
      });

      return {
        kind: 'updated' as const,
        conditions: afterConditions,
        expectedUpdatedAt: nextUpdatedAt,
      };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'response') return result.response;

  return success({
    data: result.conditions,
    metadata: {
      expected_updated_at: result.expectedUpdatedAt.toISOString(),
      version_basis: 'patient_updated_at',
    },
  });
}

export async function PUT(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPUT(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
