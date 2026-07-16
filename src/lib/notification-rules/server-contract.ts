import { z } from 'zod';

export const notificationChannelSchema = z.enum(['in_app', 'email', 'sms', 'line', 'fax', 'mcs']);

export const notificationEventTypeSchema = z.string().trim().min(1).max(200);

const recipientIdSchema = z.string().trim().min(1).max(200);

export const notificationRecipientsSchema = z
  .object({
    roles: z.array(recipientIdSchema).max(200).optional(),
    user_ids: z.array(recipientIdSchema).max(500).optional(),
  })
  .superRefine((recipients, context) => {
    for (const key of ['roles', 'user_ids'] as const) {
      const values = recipients[key] ?? [];
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} に重複があります`,
        });
      }
    }
  });

export const notificationRulePublicSelect = {
  id: true,
  event_type: true,
  channel: true,
  recipients: true,
  enabled: true,
  created_at: true,
  updated_at: true,
} as const;
