import { z } from 'zod';

const policySchema = z
  .object({
    safety_sign_sensitivity: z.enum(['low', 'standard', 'high']),
    slack_auto_calc: z.boolean(),
    interrupt_guard: z.boolean(),
    wait_release_notification: z.boolean(),
    quiet_hours: z.boolean(),
  })
  .strict();

const lockedKeys = ['safety_tag_display', 'two_person_audit', 'emergency_notification'] as const;

const responseDataSchema = z
  .object({
    generated_at: z.string().datetime({ offset: true }),
    pharmacy_label: z.string().trim().min(1).max(1_000),
    can_edit: z.boolean(),
    policy: policySchema,
    locked_items: z
      .array(
        z
          .object({
            key: z.enum(lockedKeys),
            label: z.string().trim().min(1).max(500),
            reason: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .length(lockedKeys.length),
    wip_revision_label: z.string().trim().min(1).max(100),
    change_log_count_this_month: z.number().int().nonnegative(),
  })
  .strict();

export const operationalPolicyResponseSchema = z
  .object({ data: responseDataSchema })
  .strict()
  .superRefine(({ data }, context) => {
    if (new Set(data.locked_items.map((item) => item.key)).size !== lockedKeys.length)
      context.addIssue({
        code: 'custom',
        path: ['data', 'locked_items'],
        message: 'Operational policy locked item set drift',
      });
  });

export function buildUpdatedOperationalPolicyResponseSchema(args: {
  values: Partial<z.infer<typeof policySchema>>;
  previousChangeLogCount: number | null;
}) {
  return operationalPolicyResponseSchema.superRefine(({ data }, context) => {
    if (!data.can_edit)
      context.addIssue({
        code: 'custom',
        path: ['data', 'can_edit'],
        message: 'Updated policy is not editable',
      });
    for (const [key, value] of Object.entries(args.values) as Array<
      [keyof z.infer<typeof policySchema>, boolean | string]
    >) {
      if (data.policy[key] !== value)
        context.addIssue({
          code: 'custom',
          path: ['data', 'policy', key],
          message: 'Updated policy differs from request',
        });
    }
    if (
      args.previousChangeLogCount !== null &&
      data.change_log_count_this_month !== args.previousChangeLogCount + 1
    )
      context.addIssue({
        code: 'custom',
        path: ['data', 'change_log_count_this_month'],
        message: 'Operational policy change log count drift',
      });
  });
}
