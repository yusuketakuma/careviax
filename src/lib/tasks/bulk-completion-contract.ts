import { z } from 'zod';

export const BULK_COMPLETE_TASK_FAILURE_CODES = [
  'not_found',
  'dedicated_completion_required',
  'invalid_status',
  'patient_not_writable',
  'conflict',
] as const;

export const bulkCompleteTaskFailureSchema = z.object({
  id: z.string().nullable(),
  code: z.enum(BULK_COMPLETE_TASK_FAILURE_CODES),
  message: z.string().trim().min(1),
});

const bulkCompleteTasksResultSchema = z
  .object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    failures: z.array(bulkCompleteTaskFailureSchema),
  })
  .superRefine((value, ctx) => {
    if (value.completed + value.failed !== value.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failed'],
        message: 'completed and failed counts must add up to total',
      });
    }
  });

export const bulkCompleteTasksResponseSchema = z.object({
  data: bulkCompleteTasksResultSchema,
});

export type BulkCompleteTaskFailure = z.infer<typeof bulkCompleteTaskFailureSchema>;
export type BulkCompleteTasksResponse = z.infer<typeof bulkCompleteTasksResponseSchema>;
