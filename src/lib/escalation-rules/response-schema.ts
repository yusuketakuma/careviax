import { z } from 'zod';
import {
  escalationActionTypes,
  escalationNotifyRoles,
  escalationTriggerTypes,
} from '@/lib/validations/escalation-rule';

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}

const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const ESCALATION_RULE_ID = nonEmptyText(200);
const ESCALATION_CONDITION = z
  .object({
    threshold_hours: z.number().finite().int().min(1).max(720),
    severity: z.enum(['normal', 'high', 'urgent']).optional(),
    status_in: z.array(nonEmptyText(200)).max(10).optional(),
  })
  .strip()
  .nullable();

const escalationRuleSchema = z
  .object({
    id: ESCALATION_RULE_ID,
    trigger_type: z.enum(escalationTriggerTypes),
    condition: ESCALATION_CONDITION,
    action: z.enum(escalationActionTypes),
    notify_role: z.enum(escalationNotifyRoles).nullable(),
    is_active: z.boolean(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strip();

const escalationRuleMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.literal('escalation_rules'),
    filters_applied: z.object({}).strict(),
    limit: z.number().finite().int().min(1).max(200),
  })
  .strict();

export const escalationRulesResponseSchema = z
  .object({
    data: z.array(escalationRuleSchema).max(200),
    meta: escalationRuleMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const ruleIds = new Set<string>();
    for (const [index, rule] of data.entries()) {
      if (ruleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Escalation rule identities must be unique',
        });
      }
      ruleIds.add(rule.id);
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Escalation rule data exceeds the requested limit',
      });
    }
    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal returned escalation rule data length',
      });
    }
    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible escalation rules',
      });
    }
    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden escalation rule count',
      });
    }
  });

export type EscalationRulesResponse = z.infer<typeof escalationRulesResponseSchema>;
