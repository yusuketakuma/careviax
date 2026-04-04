import { Prisma } from '@prisma/client';
import {
  describeOperationalTask as describeOperationalTaskShared,
} from '@/lib/tasks/operational-task-presentation';

type Tx = Prisma.TransactionClient;

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

export async function upsertOperationalTask(
  tx: Tx,
  input: UpsertOperationalTaskInput
) {
  const nextStatus = input.status ?? 'pending';

  if (input.dedupeKey) {
    return tx.task.upsert({
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
    });
  }

  return tx.task.create({
    data: {
      org_id: input.orgId,
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

export async function resolveOperationalTasks(
  tx: Tx,
  input: ResolveOperationalTaskInput
) {
  const nextStatus = input.status ?? 'completed';

  return tx.task.updateMany({
    where: {
      org_id: input.orgId,
      status: {
        in: ['pending', 'in_progress'],
      },
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
      ...(input.taskType ? { task_type: input.taskType } : {}),
      ...(input.relatedEntityType
        ? { related_entity_type: input.relatedEntityType }
        : {}),
      ...(input.relatedEntityId
        ? { related_entity_id: input.relatedEntityId }
        : {}),
    },
    data: {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date() : null,
    },
  });
}

export const describeOperationalTask = describeOperationalTaskShared;
