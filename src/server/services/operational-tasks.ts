import { Prisma } from '@prisma/client';
import { describeOperationalTask as describeOperationalTaskShared } from '@/lib/tasks/operational-task-presentation';
import { allocateDisplayId } from '@/lib/db/display-id';

type Tx = {
  task: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
};

type TaskDisplayIdRow = {
  id: string;
  display_id: string | null;
};

type TaskDisplayIdReader = {
  task: {
    findFirst(args: unknown): Promise<TaskDisplayIdRow | null>;
  };
};

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type UpsertOperationalTaskInput = {
  orgId: string;
  taskType: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedTo?: string | null;
  dueDate?: Date | null;
  slaDueAt?: Date | null;
  dedupeKey?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  status?: TaskStatus;
};

type ResolveOperationalTaskInput = {
  orgId: string;
  dedupeKey?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  taskType?: string | null;
  status?: Extract<TaskStatus, 'completed' | 'cancelled'>;
};

async function ensureTaskDisplayId(
  tx: Tx,
  orgId: string,
  task: TaskDisplayIdRow,
): Promise<TaskDisplayIdRow> {
  if (task.display_id) return task;

  const displayId = await allocateDisplayId(
    tx as unknown as Prisma.TransactionClient,
    'Task',
    orgId,
  );
  const filled = await tx.task.updateMany({
    where: {
      id: task.id,
      org_id: orgId,
      display_id: null,
    },
    data: {
      display_id: displayId,
    },
  });
  const filledCount =
    typeof filled === 'object' &&
    filled !== null &&
    'count' in filled &&
    typeof filled.count === 'number'
      ? filled.count
      : null;

  if (filledCount === 1) {
    return { ...task, display_id: displayId };
  }
  if (filledCount !== 0) {
    throw new Error('Task display_id fill updated an unexpected number of rows');
  }

  const current = await (tx as Tx & TaskDisplayIdReader).task.findFirst({
    where: {
      id: task.id,
      org_id: orgId,
    },
    select: {
      id: true,
      display_id: true,
    },
  });
  if (!current?.display_id) {
    throw new Error('Task display_id fill did not converge');
  }
  return current;
}

export async function upsertOperationalTask(tx: Tx, input: UpsertOperationalTaskInput) {
  const nextStatus = input.status ?? 'pending';

  if (input.dedupeKey) {
    const task = (await tx.task.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: input.orgId,
          dedupe_key: input.dedupeKey,
        },
      },
      create: {
        org_id: input.orgId,
        task_type: input.taskType,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        status: nextStatus,
        assigned_to: input.assignedTo ?? null,
        due_date: input.dueDate ?? null,
        sla_due_at: input.slaDueAt ?? null,
        dedupe_key: input.dedupeKey,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        ...(nextStatus === 'completed' ? { completed_at: new Date() } : {}),
      },
      update: {
        task_type: input.taskType,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        status: nextStatus,
        assigned_to: input.assignedTo ?? null,
        due_date: input.dueDate ?? null,
        sla_due_at: input.slaDueAt ?? null,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        completed_at: nextStatus === 'completed' ? new Date() : null,
      },
      select: {
        id: true,
        display_id: true,
      },
    })) as TaskDisplayIdRow;
    return ensureTaskDisplayId(tx, input.orgId, task);
  }

  const displayId = await allocateDisplayId(
    tx as unknown as Prisma.TransactionClient,
    'Task',
    input.orgId,
  );
  return tx.task.create({
    data: {
      org_id: input.orgId,
      display_id: displayId,
      task_type: input.taskType,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      status: nextStatus,
      assigned_to: input.assignedTo ?? null,
      due_date: input.dueDate ?? null,
      sla_due_at: input.slaDueAt ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
      ...(nextStatus === 'completed' ? { completed_at: new Date() } : {}),
    },
  });
}

export async function resolveOperationalTasks(tx: Tx, input: ResolveOperationalTaskInput) {
  const nextStatus = input.status ?? 'completed';

  return tx.task.updateMany({
    where: {
      org_id: input.orgId,
      status: {
        in: ['pending', 'in_progress'],
      },
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
      ...(input.taskType ? { task_type: input.taskType } : {}),
      ...(input.relatedEntityType ? { related_entity_type: input.relatedEntityType } : {}),
      ...(input.relatedEntityId ? { related_entity_id: input.relatedEntityId } : {}),
    },
    data: {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date() : null,
    },
  });
}

export const describeOperationalTask = describeOperationalTaskShared;
