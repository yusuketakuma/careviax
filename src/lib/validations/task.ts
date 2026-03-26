import { z } from 'zod';

export const taskStatusValues = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export const taskPriorityValues = ['urgent', 'high', 'normal', 'low'] as const;

export const createTaskSchema = z.object({
  task_type: z.string().trim().min(1).default('general'),
  title: z.string().trim().min(1, 'title は必須です').max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(taskPriorityValues).default('normal'),
  assigned_to: z.string().nullable().optional(),
  due_date: z
    .string()
    .datetime('due_date の日時形式が不正です')
    .nullable()
    .optional(),
  sla_due_at: z
    .string()
    .datetime('sla_due_at の日時形式が不正です')
    .nullable()
    .optional(),
  dedupe_key: z.string().trim().max(255).optional(),
  related_entity_type: z.string().trim().max(100).optional(),
  related_entity_id: z.string().trim().max(191).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateTaskSchema = z.object({
  status: z.enum(taskStatusValues).optional(),
  assigned_to: z.string().nullable().optional(),
  due_date: z
    .string()
    .datetime('due_date の日時形式が不正です')
    .nullable()
    .optional(),
});
