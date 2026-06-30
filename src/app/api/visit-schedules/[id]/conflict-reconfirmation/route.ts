import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requireAuthContext } from '@/lib/auth/context';
import { buildVisitScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { toPrismaJsonInput } from '@/lib/db/json';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { withOrgContext } from '@/lib/db/rls';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { formatUtcDateKey } from '@/lib/date-key';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const conflictReconfirmationSchema = z.object({
  target_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
  plan_id: z.enum(['plan_a', 'plan_b', 'plan_c']).optional(),
});

const RECONFIRMATION_CREATABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);

type ConflictReconfirmationRouteContext = {
  params: Promise<{ id?: string }>;
};

function buildConflictReconfirmationDedupeKey(scheduleId: string, dateKey: string) {
  return `schedule-conflict-reconfirmation:${scheduleId}:${dateKey}`;
}

export async function POST(req: NextRequest, routeContext: ConflictReconfirmationRouteContext) {
  try {
    const authResult = await requireAuthContext(req, {
      permission: 'canVisit',
      message: '患者再確認タスクの作成権限がありません',
    });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

    const scheduleId = normalizeRequiredRouteParam((await routeContext.params).id ?? '');
    if (!scheduleId) return withSensitiveNoStore(validationError('訪問予定IDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = conflictReconfirmationSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const assignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
        const schedule = await tx.visitSchedule.findFirst({
          where: {
            org_id: ctx.orgId,
            id: scheduleId,
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            case_id: true,
            pharmacist_id: true,
            scheduled_date: true,
            schedule_status: true,
            confirmed_at: true,
          },
        });

        if (!schedule) return { status: 'not_found' as const };

        const dateKey = formatUtcDateKey(schedule.scheduled_date);
        if (parsed.data.target_date && parsed.data.target_date !== dateKey) {
          return { status: 'date_mismatch' as const };
        }
        if (!RECONFIRMATION_CREATABLE_STATUSES.has(schedule.schedule_status)) {
          return { status: 'status_locked' as const };
        }

        const dedupeKey = buildConflictReconfirmationDedupeKey(schedule.id, dateKey);
        const taskMetadata = {
          source: 'schedule_conflict_resolution',
          plan_id: parsed.data.plan_id ?? null,
          confirmed_at_present: schedule.confirmed_at != null,
        };

        try {
          const task = await tx.task.create({
            data: {
              org_id: ctx.orgId,
              task_type: 'staff_work_request_visit',
              title: '訪問予定の患者再確認',
              description: '予定の重なり解消に伴う患者再確認依頼です。',
              priority: 'high',
              assigned_to: schedule.pharmacist_id,
              dedupe_key: dedupeKey,
              related_entity_type: 'case',
              related_entity_id: schedule.case_id,
              metadata: toPrismaJsonInput(taskMetadata),
            },
          });

          await createAuditLogEntry(tx, ctx, {
            action: 'visit_schedule_conflict_reconfirmation_task_created',
            targetType: 'VisitSchedule',
            targetId: schedule.id,
            changes: {
              task_id: task.id,
              task_type: 'staff_work_request_visit',
              result: 'created',
            },
          });

          return {
            status: 'created' as const,
            taskId: task.id,
            caseId: schedule.case_id,
          };
        } catch (cause) {
          if (!isPrismaUniqueConstraintError(cause)) throw cause;
          const task = await tx.task.findFirst({
            where: {
              org_id: ctx.orgId,
              dedupe_key: dedupeKey,
            },
            select: { id: true },
          });
          if (!task) throw cause;
          return {
            status: 'existing' as const,
            taskId: task.id,
            caseId: schedule.case_id,
          };
        }
      },
      {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (result.status === 'not_found') {
      return withSensitiveNoStore(notFound('対象の訪問予定が見つかりません'));
    }
    if (result.status === 'date_mismatch') {
      return withSensitiveNoStore(validationError('対象日の訪問予定ではありません'));
    }
    if (result.status === 'status_locked') {
      return withSensitiveNoStore(
        validationError('完了済みまたは中止済みの訪問予定には再確認依頼を作成できません'),
      );
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_conflict_reconfirmation', case_id: result.caseId },
    });

    return withSensitiveNoStore(
      success(
        {
          data: {
            task_id: result.taskId,
            status: result.status,
          },
        },
        result.status === 'created' ? 201 : 200,
      ),
    );
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return withSensitiveNoStore(conflict('再確認依頼の作成対象が同時に更新されました'));
    }
    return withSensitiveNoStore(internalError());
  }
}
