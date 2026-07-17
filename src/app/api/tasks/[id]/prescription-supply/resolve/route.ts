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
import {
  applyPrescriptionSupplyForIntake,
  createPrescriptionSupplyStockItemForReview,
  previewPrescriptionSupplyReview,
} from '@/modules/pharmacy';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

export const dynamic = 'force-dynamic';

const TASK_TYPE = 'pharmacy.medication_stock_unlinked_prescription_supply';

const resolvePrescriptionSupplySchema = z.union([
  z.object({ stock_item_id: z.string().trim().min(1).max(191) }).strict(),
  z
    .object({
      create_new: z.literal(true),
      managing_party: z.enum(['patient', 'family', 'facility', 'pharmacy']),
    })
    .strict(),
]);

class PrescriptionSupplyReviewConflict extends Error {}
class PrescriptionSupplyCreationConflict extends Error {
  constructor(readonly reasonCode: string) {
    super('Prescription supply application failed after stock item creation');
  }
}

const authenticatedGET = withAuthContext(
  async (_req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const taskId = normalizeRequiredRouteParam(rawId);
    if (!taskId) return validationError('タスクIDが不正です');

    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });
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
            related_entity_type: true,
            related_entity_id: true,
            metadata: true,
          },
        });
        if (!task || task.related_entity_type !== 'prescription_line' || !task.related_entity_id) {
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
            intake: { select: { cycle: { select: { patient_id: true } } } },
          },
        });
        const patientId = line?.intake.cycle.patient_id;
        if (!line || !patientId) return { kind: 'not_found' as const };

        const writablePatient = await requireWritablePatient(tx, ctx, patientId);
        if ('response' in writablePatient) {
          return { kind: 'response' as const, response: writablePatient.response };
        }
        const patient = await tx.patient.findFirst({
          where: { id: patientId, org_id: ctx.orgId },
          select: {
            id: true,
            display_id: true,
            name: true,
            name_kana: true,
            birth_date: true,
          },
        });
        if (!patient) return { kind: 'not_found' as const };

        const preview = await previewPrescriptionSupplyReview(tx, {
          orgId: ctx.orgId,
          intakeId: line.intake_id,
          patientId,
          prescriptionLineId: line.id,
        });
        if (preview.kind === 'not_found') return { kind: 'not_found' as const };

        return {
          kind: 'found' as const,
          data: {
            task: {
              id: task.id,
              reason_code: readJsonObjectString(task.metadata, 'reason_code'),
            },
            patient: {
              ...patient,
              birth_date: patient.birth_date.toISOString(),
            },
            preview,
          },
        };
      },
      { requestContext: ctx },
    );

    if (outcome.kind === 'not_found') return notFound('タスクが見つかりません');
    if (outcome.kind === 'response') return outcome.response;
    return success({ data: outcome.data });
  },
  {
    permission: 'canDispense',
    message: '処方供給の残数台帳紐づけを確認する権限がありません',
  },
);

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
    const command =
      'stock_item_id' in parsed.data
        ? {
            kind: 'existing' as const,
            stockItemId: normalizeRequiredRouteParam(parsed.data.stock_item_id),
          }
        : {
            kind: 'create_new' as const,
            managingParty: parsed.data.managing_party,
          };
    if (command.kind === 'existing' && !command.stockItemId) {
      return validationError('残数台帳IDが不正です');
    }

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

          let stockItemId = command.kind === 'existing' ? command.stockItemId : null;
          let stockItemCreated = false;
          if (command.kind === 'create_new') {
            const creation = await createPrescriptionSupplyStockItemForReview(tx, {
              orgId: ctx.orgId,
              userId: ctx.userId,
              intakeId: line.intake_id,
              patientId,
              prescriptionLineId: line.id,
              managingParty: command.managingParty,
            });
            if (creation.kind !== 'created') {
              return {
                kind:
                  creation.kind === 'not_found'
                    ? ('not_found' as const)
                    : ('review_required' as const),
                ...(creation.kind === 'review_required'
                  ? { reasonCode: creation.reason_code }
                  : {}),
              };
            }
            stockItemId = creation.stock_item_id;
            stockItemCreated = true;
          }
          if (!stockItemId) {
            return { kind: 'review_required' as const, reasonCode: 'selection_not_applicable' };
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
            const reasonCode =
              lineResult?.kind === 'review_required'
                ? lineResult.reason_code
                : 'selection_not_applicable';
            if (stockItemCreated) throw new PrescriptionSupplyCreationConflict(reasonCode);
            return {
              kind: 'review_required' as const,
              reasonCode,
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
              stock_item_created: stockItemCreated,
              ...(command.kind === 'create_new' ? { managing_party: command.managingParty } : {}),
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

          return {
            kind: 'applied' as const,
            result: { ...lineResult, stock_item_created: stockItemCreated },
          };
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
      if (error instanceof PrescriptionSupplyCreationConflict) {
        return conflict('新しい残数台帳を作成して処方供給を反映できませんでした', {
          reason_code: error.reasonCode,
        });
      }
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

export async function GET(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  return withSensitiveNoStore(await authenticatedGET(req, routeContext));
}
