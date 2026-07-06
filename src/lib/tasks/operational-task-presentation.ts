import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { describeRegisteredOperationalTask } from '@/lib/tasks/task-registry';

export type OperationalTaskPresentation = {
  actionHref: string;
  actionLabel: string;
  queueLabel: string;
};

export type OperationalTaskPresentationInput = {
  task_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export function describeOperationalTask(
  task: OperationalTaskPresentationInput,
): OperationalTaskPresentation {
  const registeredPresentation = describeRegisteredOperationalTask(task);
  if (registeredPresentation) return registeredPresentation;

  if (task.related_entity_type === 'visit_schedule') {
    return {
      actionHref: task.related_entity_id
        ? buildScheduleFocusHref(task.related_entity_id)
        : '/schedules',
      actionLabel: '予定を確認',
      queueLabel: '訪問',
    };
  }
  return {
    actionHref: '/workflow',
    actionLabel: 'ワークフローを開く',
    queueLabel: '運用',
  };
}
