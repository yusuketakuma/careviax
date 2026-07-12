import { z } from 'zod';

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}

const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const NOTIFICATION_RULE_ID = nonEmptyText(200);
const NOTIFICATION_EVENT_TYPE = nonEmptyText(200);
const NOTIFICATION_CHANNEL = z.enum(['in_app', 'email', 'sms', 'line', 'fax', 'mcs']);

const notificationRecipientsSchema = z
  .object({
    roles: z.array(nonEmptyText(200)).max(200).optional(),
    user_ids: z.array(nonEmptyText(200)).max(500).optional(),
  })
  .strip()
  .nullable();

const notificationRuleSchema = z
  .object({
    id: NOTIFICATION_RULE_ID,
    event_type: NOTIFICATION_EVENT_TYPE,
    channel: NOTIFICATION_CHANNEL,
    enabled: z.boolean(),
    recipients: notificationRecipientsSchema,
    created_at: z.string().datetime({ offset: true }),
  })
  .strip();

const notificationRuleMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.literal('notification_rules'),
    filters_applied: z.object({}).strict(),
    limit: z.number().finite().int().min(1).max(200),
  })
  .strict();

export const notificationRulesResponseSchema = z
  .object({
    data: z.array(notificationRuleSchema).max(200),
    meta: notificationRuleMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const ruleIds = new Set<string>();
    for (const [index, rule] of data.entries()) {
      if (ruleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Notification rule identities must be unique',
        });
      }
      ruleIds.add(rule.id);
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Notification rule data exceeds the requested limit',
      });
    }
    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal returned notification rule data length',
      });
    }
    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible notification rules',
      });
    }
    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden notification rule count',
      });
    }
  });

export type NotificationRulesResponse = z.infer<typeof notificationRulesResponseSchema>;
