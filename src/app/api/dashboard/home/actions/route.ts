import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { describeOperationalTask } from '@/server/services/operational-tasks';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { DASHBOARD_PIPELINE_STEPS } from '@/lib/dashboard/home-config';
import type {
  PipelineStep,
  ActionItem,
  QueuePriority,
  DashboardActionsResponse,
} from '@/types/dashboard-home';

function priorityRank(p: QueuePriority) {
  switch (p) {
    case 'urgent': return 0;
    case 'high': return 1;
    case 'normal': return 2;
    default: return 3;
  }
}

function sortActions(a: ActionItem, b: ActionItem) {
  const d = priorityRank(a.priority) - priorityRank(b.priority);
  if (d !== 0) return d;
  if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  if (a.due_at) return -1;
  if (b.due_at) return 1;
  return a.title.localeCompare(b.title, 'ja');
}

function buildCycleAggregateActionItems(statusMap: Record<string, number>): ActionItem[] {
  return [
    ...((statusMap.setting ?? 0) > 0
      ? [
          {
            id: 'aggregate:medication_set_queue',
            item_type: 'aggregate' as const,
            task_type: 'medication_set_queue',
            queue_label: 'セット',
            title: 'セット作成待ちがあります',
            summary: `${statusMap.setting}件のサイクルがセット作成待ちです。`,
            priority: 'normal' as const,
            due_at: null,
            action_href: '/medication-sets',
            action_label: 'セット管理を開く',
            owner_name: null,
            patient_name: null,
            badges: ['setting'],
          },
        ]
      : []),
    ...((statusMap.set_audited ?? 0) > 0
      ? [
          {
            id: 'aggregate:set_audit_queue',
            item_type: 'aggregate' as const,
            task_type: 'set_audit_queue',
            queue_label: 'セット監査',
            title: 'セット監査待ちがあります',
            summary: `${statusMap.set_audited}件のサイクルがセット監査待ちです。`,
            priority: 'high' as const,
            due_at: null,
            action_href: '/medication-sets',
            action_label: 'セット監査を開く',
            owner_name: null,
            patient_name: null,
            badges: ['set_audited'],
          },
        ]
      : []),
  ];
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const [cycleCounts, pendingTasks, communicationQueue] = await Promise.all([
    prisma.medicationCycle.groupBy({
      by: ['overall_status'],
      where: {
        org_id: req.orgId,
        overall_status: { notIn: ['cancelled', 'reported'] },
      },
      _count: { id: true },
    }),
    prisma.task.findMany({
      where: {
        org_id: req.orgId,
        status: { in: ['pending', 'in_progress'] },
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 12,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        priority: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    listCommunicationQueue(prisma, { orgId: req.orgId, limit: 6 }),
  ]);

  // Pipeline
  const statusMap: Record<string, number> = {};
  for (const row of cycleCounts) {
    statusMap[row.overall_status] = row._count.id;
  }

  const pipeline: PipelineStep[] = DASHBOARD_PIPELINE_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    count: step.statuses.reduce((sum, s) => sum + (statusMap[s] ?? 0), 0),
  }));

  // Actions from tasks
  const taskItems: ActionItem[] = pendingTasks.map((task) => {
    const presentation = describeOperationalTask(task);
    return {
      id: task.id,
      item_type: 'task',
      task_type: task.task_type,
      queue_label: presentation.queueLabel,
      title: task.title,
      summary: task.description ?? '',
      priority: (task.priority ?? 'normal') as QueuePriority,
      due_at: task.sla_due_at?.toISOString() ?? task.due_date?.toISOString() ?? null,
      action_href: presentation.actionHref,
      action_label: presentation.actionLabel,
      owner_name: task.assigned_to,
      patient_name: null,
      badges: [],
    };
  });

  // Actions from communication queue
  const commItems: ActionItem[] = communicationQueue.items.map((item) => ({
    id: item.id,
    item_type: 'self_report' as const,
    task_type: null,
    queue_label: item.channel,
    title: item.title,
    summary: item.summary,
    priority: item.priority,
    due_at: item.due_at,
    action_href: item.action_href,
    action_label: item.action_label,
    owner_name: null,
    patient_name: item.patient_name,
    badges: [],
  }));

  const aggregateItems = buildCycleAggregateActionItems(statusMap);
  const actions = [...taskItems, ...commItems, ...aggregateItems].sort(sortActions).slice(0, 10);

  return success({ data: { pipeline, actions } satisfies DashboardActionsResponse });
});
