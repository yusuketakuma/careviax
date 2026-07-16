import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, conflict, forbidden } from '@/lib/api/response';
import { caseTransitionSchema, caseStatusTransitions } from '@/lib/validations/case';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { writePatientFieldRevisions } from '@/server/services/patient-field-revision';

async function transitionCase(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = caseTransitionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { from, to, version } = parsed.data;

  // Phases that require first visit document delivery
  const visitPhases = new Set(['active']);

  const transitionResult = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { user_id: ctx.userId, org_id: ctx.orgId, is_active: true },
        select: { role: true },
      });
      if (!membership || !hasPermission(membership.role, 'canVisit')) {
        return { ok: false as const, response: forbidden('ケース更新の権限がありません') };
      }

      const caseAssignmentWhere = buildCareCaseAssignmentWhere({
        userId: ctx.userId,
        role: membership.role,
      });
      const existing = await tx.careCase.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        },
      });
      if (!existing) {
        return { ok: false as const, response: notFound('ケースが見つかりません') };
      }
      if (existing.version !== version) {
        return {
          ok: false as const,
          response: conflict('ケースが更新されています。再読み込みしてください', {
            expected_version: version,
            current_version: existing.version,
          }),
        };
      }
      if (existing.status !== from) {
        return {
          ok: false as const,
          response: conflict(`現在のステータスが一致しません（現在: ${existing.status}）`),
        };
      }

      const allowed = caseStatusTransitions[from];
      if (!allowed.includes(to)) {
        return {
          ok: false as const,
          response: validationError(`${from} から ${to} への遷移は許可されていません`),
        };
      }

      const warnings: string[] = [];
      if (visitPhases.has(to)) {
        const firstVisitDoc = await tx.firstVisitDocument.findFirst({
          where: { case_id: id, org_id: ctx.orgId },
          select: { id: true, delivered_at: true },
        });
        if (!firstVisitDoc || firstVisitDoc.delivered_at == null) {
          warnings.push('初回訪問文書が未交付です');
        }
      }

      const updated = await tx.careCase.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: from,
          version,
          ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        },
        data: { status: to, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        return {
          ok: false as const,
          response: conflict('ケースが同時に更新されました。再読み込みしてください'),
        };
      }

      const updatedCareCase = await tx.careCase.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        },
      });
      if (!updatedCareCase) {
        return {
          ok: false as const,
          response: conflict('更新後のケースを取得できません。再読み込みしてください'),
        };
      }

      await writePatientFieldRevisions(tx, {
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.id,
        actorId: ctx.userId,
        source: 'care_case_transition',
        entries: [
          {
            category: 'care_case',
            field_key: 'status',
            old_value: existing.status,
            new_value: to,
          },
        ],
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'care_case_transitioned',
        targetType: 'CareCase',
        targetId: existing.id,
        patientId: existing.patient_id,
        changes: {
          previous_status: existing.status,
          status: to,
          previous_version: existing.version,
          version: updatedCareCase.version,
        },
      });

      // Auto-create a first_visit_document_delivery task when activating a case
      // without a delivered first visit document
      if (visitPhases.has(to) && warnings.length > 0) {
        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'first_visit_document_delivery',
          title: `初回訪問文書の交付確認 — ${existing.patient_id}`,
          description:
            '患者への初回訪問文書が未交付です。速やかに交付し、交付日時を記録してください。',
          priority: 'high',
          dedupeKey: `first_visit_doc_delivery:${id}`,
          relatedEntityType: 'care_case',
          relatedEntityId: id,
        });
      }

      return { ok: true as const, careCase: updatedCareCase, warnings };
    },
    { requestContext: ctx },
  );

  if (!transitionResult.ok) return transitionResult.response;

  return success({
    data: transitionResult.careCase,
    meta: { warnings: transitionResult.warnings },
  });
}

export const PATCH = withAuthContext(transitionCase, {
  permission: 'canVisit',
  message: 'ケース更新の権限がありません',
});
