import { z } from 'zod';

const countSchema = z.number().finite().int().nonnegative();
const identitySchema = z.string().trim().min(1).max(255);
const nameSchema = z.string().trim().min(1).max(200);

const pharmacistWorkloadSchema = z
  .object({
    pharmacist_id: identitySchema,
    pharmacist_name: nameSchema,
    confirmed_visits: countSchema,
    pending_tasks: countSchema,
    urgent_items: countSchema,
    callback_followups: countSchema,
    facility_clusters: countSchema,
  })
  .strip()
  .superRefine((workload, context) => {
    if (workload.callback_followups > workload.pending_tasks) {
      context.addIssue({
        code: 'custom',
        path: ['callback_followups'],
        message: 'Callback follow-ups cannot exceed pending tasks',
      });
    }
  });

export const performanceWorkflowResponseSchema = z
  .object({
    data: z
      .object({
        route_control: z
          .object({
            locked_schedules: countSchema,
            pending_override_requests: countSchema,
            emergency_impact_items: countSchema,
          })
          .strip(),
        outcome_metrics: z
          .object({
            completed_last_7_days: countSchema,
            disrupted_last_7_days: countSchema,
            urgent_completed_last_7_days: countSchema,
            awaiting_reports: countSchema,
            open_exceptions: countSchema,
          })
          .strip()
          .superRefine((metrics, context) => {
            if (metrics.urgent_completed_last_7_days > metrics.completed_last_7_days) {
              context.addIssue({
                code: 'custom',
                path: ['urgent_completed_last_7_days'],
                message: 'Urgent completed visits cannot exceed all completed visits',
              });
            }
          }),
        workload_metrics: z
          .object({ pharmacists: z.array(pharmacistWorkloadSchema).max(6) })
          .strip()
          .superRefine(({ pharmacists }, context) => {
            const ids = new Set<string>();
            for (const [index, pharmacist] of pharmacists.entries()) {
              if (ids.has(pharmacist.pharmacist_id)) {
                context.addIssue({
                  code: 'custom',
                  path: ['pharmacists', index, 'pharmacist_id'],
                  message: 'Performance workload pharmacist identities must be unique',
                });
              }
              ids.add(pharmacist.pharmacist_id);
            }
          }),
      })
      .strip(),
  })
  .strict();

export type PerformanceWorkflowResponse = z.infer<typeof performanceWorkflowResponseSchema>;
