import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { caseTransitionSchema, caseStatusTransitions } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

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

  const parsed = caseTransitionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { from, to } = parsed.data;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const existing = await prisma.careCase.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
  });
  if (!existing) return notFound('ケースが見つかりません');

  if (existing.status !== from) {
    return validationError(`現在のステータスが一致しません（現在: ${existing.status}）`);
  }

  const allowed = caseStatusTransitions[from];
  if (!allowed.includes(to)) {
    return validationError(`${from} から ${to} への遷移は許可されていません`);
  }

  // Phases that require first visit document delivery
  const visitPhases = new Set(['active']);

  const warnings: string[] = [];

  if (visitPhases.has(to)) {
    const firstVisitDoc = await prisma.firstVisitDocument.findFirst({
      where: { case_id: id, org_id: ctx.orgId },
      select: { id: true, delivered_at: true },
    });

    if (!firstVisitDoc || firstVisitDoc.delivered_at == null) {
      warnings.push('初回訪問文書が未交付です');
    }
  }

  const transitionResult = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updated = await tx.careCase.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: from,
          ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        },
        data: { status: to },
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

      return { ok: true as const, careCase: updatedCareCase };
    },
    { requestContext: ctx },
  );

  if (!transitionResult.ok) return transitionResult.response;

  return success({ data: transitionResult.careCase, warnings });
}
