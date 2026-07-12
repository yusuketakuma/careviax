import { z } from 'zod';

export const documentDeliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);

const documentDeliveryRuleRowSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    document_type: z.string().trim().min(1).max(64),
    target_role: z.string().trim().min(1).max(64),
    channel: documentDeliveryChannelSchema,
    fallback_channels: z.array(documentDeliveryChannelSchema).max(3).nullable(),
    is_active: z.boolean(),
  })
  .strip()
  .superRefine((rule, context) => {
    const fallbackChannels = rule.fallback_channels ?? [];
    if (
      fallbackChannels.includes(rule.channel) ||
      new Set(fallbackChannels).size !== fallbackChannels.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fallback_channels'],
        message: 'Fallback channels must be unique and exclude the primary channel',
      });
    }
  });

export const documentDeliveryRulesResponseSchema = z
  .object({
    data: z.array(documentDeliveryRuleRowSchema).max(200),
    meta: z
      .object({
        total_count: z.number().int().nonnegative(),
        visible_count: z.number().int().nonnegative(),
        hidden_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        count_basis: z.literal('document_delivery_rules'),
        filters_applied: z
          .object({
            document_type: z.string().trim().min(1).max(64).nullable(),
          })
          .strict(),
        limit: z.number().int().min(1).max(200),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const identities = new Set<string>();
    for (const [index, rule] of response.data.entries()) {
      if (identities.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate document-delivery-rule identity',
        });
      }
      identities.add(rule.id);
    }

    const { total_count, visible_count, hidden_count, truncated, limit } = response.meta;
    if (
      visible_count !== response.data.length ||
      hidden_count !== total_count - visible_count ||
      total_count < visible_count ||
      truncated !== hidden_count > 0 ||
      visible_count > limit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['meta'],
        message: 'Document delivery rule counts are inconsistent',
      });
    }
  });

export type DeliveryChannel = z.infer<typeof documentDeliveryChannelSchema>;
export type DocumentDeliveryRuleRow = z.infer<typeof documentDeliveryRuleRowSchema>;
export type DocumentDeliveryRulesResponse = z.infer<typeof documentDeliveryRulesResponseSchema>;
