import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { requiresDedicatedTaskCompletion } from '@/lib/tasks/inline-completion';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { requireWritableTaskPatient } from '@/server/services/task-write-guard';

const bulkCompleteTaskSchema = z.object({
  ids: z
    .array(z.string().trim().min(1, 'タスクIDが不正です'))
    .min(1, 'タスクを選択してください')
    .max(100, '一度に完了できるタスクは100件までです'),
});

type BulkTaskFailure = {
  id: string | null;
  code:
    | 'not_found'
    | 'dedicated_completion_required'
    | 'invalid_status'
    | 'patient_not_writable'
    | 'conflict';
  message: string;
};

type BulkTask = {
  id: string;
  task_type: string;
  status: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

function writableFailureForStatus(id: string, status: number): BulkTaskFailure {
  return {
    id,
    code: status === 409 ? 'conflict' : 'patient_not_writable',
    message:
      status === 409 ? 'アーカイブ中の患者は復元するまで更新できません' : '患者が見つかりません',
  };
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = bulkCompleteTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const requestedIds = Array.from(new Set(parsed.data.ids));
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
  });
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: requestedIds },
      org_id: ctx.orgId,
      ...buildDashboardTaskAssignmentWhere(assignmentScope),
    },
    select: {
      id: true,
      task_type: true,
      status: true,
      related_entity_type: true,
      related_entity_id: true,
    },
  });

  const tasksById = new Map(tasks.map((task: BulkTask) => [task.id, task]));
  const failures: BulkTaskFailure[] = [];
  const eligibleIds: string[] = [];

  for (const id of requestedIds) {
    const task = tasksById.get(id);
    if (!task) {
      failures.push({
        id,
        code: 'not_found',
        message: 'タスクが見つかりません',
      });
      continue;
    }

    if (task.status !== 'pending' && task.status !== 'in_progress') {
      failures.push({
        id,
        code: 'invalid_status',
        message: 'タスクはすでに完了または取り消されています。再読み込みしてください',
      });
      continue;
    }

    if (requiresDedicatedTaskCompletion(task)) {
      failures.push({
        id,
        code: 'dedicated_completion_required',
        message: 'このタスクは専用画面で完了してください',
      });
      continue;
    }

    const writable = await requireWritableTaskPatient(prisma, ctx, task);
    if (writable && 'response' in writable) {
      failures.push(writableFailureForStatus(id, writable.response.status));
      continue;
    }

    eligibleIds.push(id);
  }

  let completed = 0;
  if (eligibleIds.length > 0) {
    const result = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.task.updateMany({
          where: {
            id: { in: eligibleIds },
            org_id: ctx.orgId,
            ...buildDashboardTaskAssignmentWhere(assignmentScope),
            status: { in: ['pending', 'in_progress'] },
          },
          data: {
            status: 'completed',
            completed_at: new Date(),
          },
        }),
      { requestContext: ctx },
    );
    completed = result.count;

    const staleCount = eligibleIds.length - result.count;
    if (staleCount > 0) {
      failures.push({
        id: null,
        code: 'conflict',
        message: `${staleCount}件のタスクはすでに完了または取り消されています。再読み込みしてください`,
      });
    }
  }

  return success({
    data: {
      total: requestedIds.length,
      completed,
      failed: requestedIds.length - completed,
      failures,
    },
  });
}
