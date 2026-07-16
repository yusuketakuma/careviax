import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectString } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { applyPrescriptionSupplyForIntake } from '@/modules/pharmacy/medication-stock/application/apply-prescription-supply';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

export const dynamic = 'force-dynamic';

const TASK_TYPE = 'pharmacy.medication_stock_unlinked_prescription_supply';

const resolvePrescriptionSupplySchema = z
  .object({
    stock_item_id: z.string().trim().min(1).max(191),
  })
  .strict();

class PrescriptionSupplyReviewConflict extends Error {}

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const taskId = normalizeRequiredRouteParam(rawId);
    if (!taskId) return validationError('タスクIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    const parsed = resolvePrescriptionSupplySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    const stockItemId = normalizeRequiredRouteParam(parsed.data.stock_item_id);
    if (!stockItemId) return validationError('残数台帳IDが不正です');

    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });

    try {
      const outcome = await withOrgContext(
        ctx.orgId,
        async (tx) => {
          const task = await tx.task.findFirst({
            where: {
              id: taskId,
              org_id: ctx.orgId,
              task_type: TASK_TYPE,
              status: { in: ['pending', 'in_progress'] },
              ...buildDashboardTaskAssignmentWhere(assignmentScope),
            },
            select: {
              id: true,
              assigned_to: true,
              related_entity_type: true,
              related_entity_id: true,
              metadata: true,
            },
          });
          if (
            !task ||
            task.related_entity_type !== 'prescription_line' ||
            !task.related_entity_id
          ) {
            return { kind: 'not_found' as const };
          }

          const intakeId = readJsonObjectString(task.metadata, 'prescription_intake_id');
          if (!intakeId) return { kind: 'not_found' as const };

          const line = await tx.prescriptionLine.findFirst({
            where: {
              id: task.related_entity_id,
              org_id: ctx.orgId,
              intake_id: intakeId,
              intake: { org_id: ctx.orgId },
            },
            select: {
              id: true,
              intake_id: true,
              intake: {
                select: {
                  cycle: {
                    select: {
                      patient_id: true,
                    },
                  },
                },
              },
            },
          });
          const patientId = line?.intake.cycle.patient_id;
          if (!line || !patientId) return { kind: 'not_found' as const };

          const writablePatient = await requireWritablePatient(tx, ctx, patientId);
          if ('response' in writablePatient) {
            return { kind: 'response' as const, response: writablePatient.response };
          }

          const result = await applyPrescriptionSupplyForIntake(tx, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            intakeId: line.intake_id,
            patientId,
            reviewSelection: {
              prescriptionLineId: line.id,
              stockItemId,
            },
          });
          const lineResult = result.results[0];
          if (!lineResult || lineResult.kind !== 'applied') {
            return {
              kind: 'review_required' as const,
              reasonCode:
                lineResult?.kind === 'review_required'
                  ? lineResult.reason_code
                  : 'selection_not_applicable',
            };
          }

          const audit = await createAuditLogEntry(tx, ctx, {
            action: 'medication_stock.prescription_supply_review_applied',
            targetType: 'Task',
            targetId: task.id,
            patientId,
            changes: {
              prescription_intake_id: line.intake_id,
              prescription_line_id: line.id,
              stock_item_id: lineResult.stock_item_id,
              stock_event_id: lineResult.stock_event_id,
              idempotent_replay: lineResult.idempotent_replay,
            },
          });
          const resolved = await resolveOperationalTasks(tx, {
            orgId: ctx.orgId,
            taskId: task.id,
            taskType: TASK_TYPE,
            status: 'completed',
            resolution: {
              state: 'resolved',
              actorUserId: ctx.userId,
              auditLogId: audit.id,
              reasonCode: 'prescription_supply_applied',
            },
          });
          const resolvedCount =
            typeof resolved === 'object' &&
            resolved !== null &&
            'count' in resolved &&
            typeof resolved.count === 'number'
              ? resolved.count
              : null;
          if (resolvedCount !== 1) throw new PrescriptionSupplyReviewConflict();

          return { kind: 'applied' as const, result: lineResult };
        },
        {
          requestContext: ctx,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeoutMs: 10_000,
        },
      );

      if (outcome.kind === 'not_found') return notFound('タスクが見つかりません');
      if (outcome.kind === 'response') return outcome.response;
      if (outcome.kind === 'review_required') {
        return conflict('選択した残数台帳には処方供給を反映できません', {
          reason_code: outcome.reasonCode,
        });
      }
      return success({ data: outcome.result });
    } catch (error) {
      if (error instanceof PrescriptionSupplyReviewConflict) {
        return conflict('タスクはすでに解決されています。再読み込みしてください');
      }
      throw error;
    }
  },
  {
    permission: 'canDispense',
    message: '処方供給の残数台帳紐づけを確定する権限がありません',
  },
);

export async function POST(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
}
