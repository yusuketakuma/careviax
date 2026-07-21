import type { QueuePriority } from './communication-queue.contract';

function toQueuePriority(value: string | null | undefined): QueuePriority {
  if (value === 'urgent') return 'urgent';
  if (value === 'high') return 'high';
  return 'normal';
}

function parseInboundSignalTaskEventId(dedupeKey: string | null) {
  if (!dedupeKey?.startsWith('inbound-signal-task:')) return null;
  const match = dedupeKey.match(/^inbound-signal-task:([^:]+):\d+:/);
  return match?.[1] ?? null;
}

function parseInboundSignalTaskSignalId(dedupeKey: string | null) {
  if (!dedupeKey?.startsWith('inbound:')) return null;
  const match = dedupeKey.match(/^inbound:([^:]+):/);
  return match?.[1] ?? null;
}

export function buildInboundTaskStateByEventId(
  tasks: Array<{
    task_type: string;
    status: string;
    priority: string;
    dedupe_key: string | null;
  }>,
  signalEventIdBySignalId: Map<string, string> = new Map(),
) {
  const stateByEventId = new Map<
    string,
    {
      status: 'task_created' | 'task_completed';
      priority: QueuePriority;
      taskType: string;
    }
  >();

  for (const task of tasks) {
    const signalId = parseInboundSignalTaskSignalId(task.dedupe_key);
    const eventId =
      parseInboundSignalTaskEventId(task.dedupe_key) ??
      (signalId ? signalEventIdBySignalId.get(signalId) : null);
    if (!eventId) continue;

    const next = {
      status: ['completed', 'cancelled'].includes(task.status)
        ? ('task_completed' as const)
        : ('task_created' as const),
      priority: toQueuePriority(task.priority),
      taskType: task.task_type,
    };
    const current = stateByEventId.get(eventId);
    if (!current) {
      stateByEventId.set(eventId, next);
      continue;
    }
    if (current.status === 'task_completed' && next.status === 'task_created') {
      stateByEventId.set(eventId, next);
      continue;
    }
    if (priorityRank(next.priority) < priorityRank(current.priority)) {
      stateByEventId.set(eventId, { ...current, priority: next.priority });
    }
  }

  return stateByEventId;
}

export function buildInboundReviewStateByEventId(
  signals: Array<{
    inbound_event_id: string;
    review_status: string;
    action_status: string;
  }>,
) {
  const signalsByEventId = new Map<
    string,
    Array<{
      review_status: string;
      action_status: string;
    }>
  >();

  for (const signal of signals) {
    const current = signalsByEventId.get(signal.inbound_event_id) ?? [];
    current.push(signal);
    signalsByEventId.set(signal.inbound_event_id, current);
  }

  const stateByEventId = new Map<
    string,
    {
      status: 'task_completed' | 'reviewed_pending_action';
      priority: QueuePriority;
    }
  >();

  for (const [eventId, eventSignals] of signalsByEventId.entries()) {
    if (eventSignals.length === 0) continue;
    const allResolved = eventSignals.every(
      (signal) =>
        ['record_only', 'rejected'].includes(signal.review_status) ||
        ['ignored', 'linked_to_stock_event'].includes(signal.action_status),
    );
    if (allResolved) {
      stateByEventId.set(eventId, {
        status: 'task_completed',
        priority: 'normal',
      });
      continue;
    }

    const hasReviewDonePendingAction = eventSignals.some(
      (signal) =>
        ['accepted', 'auto_accepted'].includes(signal.review_status) &&
        signal.action_status === 'not_linked',
    );
    if (!hasReviewDonePendingAction) continue;
    stateByEventId.set(eventId, {
      status: 'reviewed_pending_action',
      priority: 'high',
    });
  }

  return stateByEventId;
}

function priorityRank(priority: QueuePriority) {
  switch (priority) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    default:
      return 2;
  }
}
