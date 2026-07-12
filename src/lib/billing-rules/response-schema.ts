import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const jsonObjectSchema = z.record(z.string().max(200), z.unknown());

export const billingRuleResponseItemSchema = z
  .object({
    id: nonEmptyText(200),
    billing_scope: z.enum(['home_care_ssot', 'custom', 'custom_override']),
    rule_type: z.enum(['base', 'addition', 'regional_addition', 'reduction']),
    service_type: z.enum(['medical_home_visit', 'care_home_management', 'generic']),
    payer_basis: z.enum(['medical', 'care', 'self_pay', 'non_billable']).nullable(),
    provider_scope: z.enum(['pharmacy', 'hospital_clinic']).nullable(),
    selection_mode: z.enum(['auto', 'manual']),
    calculation_unit: z.enum(['point', 'unit', 'percent']),
    name: nonEmptyText(500),
    code: z.string().trim().min(1).max(200).nullable(),
    conditions: jsonObjectSchema,
    evidence_requirements: jsonObjectSchema,
    amount: z.number().int().nullable(),
    source_url: z.url().max(2_000).nullable(),
    source_note: z.string().max(4_000).nullable(),
    is_system: z.boolean(),
    is_active: z.boolean(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strip()
  .superRefine((rule, context) => {
    if (rule.updated_at < rule.created_at) {
      context.addIssue({
        code: 'custom',
        path: ['updated_at'],
        message: 'Billing rule update timestamp precedes creation',
      });
    }
    if (rule.is_system !== (rule.billing_scope === 'home_care_ssot')) {
      context.addIssue({
        code: 'custom',
        path: ['is_system'],
        message: 'Billing rule system flag does not match its scope',
      });
    }
  });

const billingSourceSchema = z
  .object({
    source_of_truth: nonEmptyText(500),
    sync_direction: z.string().max(200).nullable(),
    recovery_procedure: z.string().max(4_000).nullable(),
  })
  .strip();

export const billingRulesResponseSchema = z
  .object({
    data: z.array(billingRuleResponseItemSchema).max(2_000),
    meta: z
      .object({
        source: billingSourceSchema.nullable(),
        summary: z
          .object({
            ssot_rule_count: z.number().int().nonnegative(),
            custom_rule_count: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const ids = new Set<string>();
    for (const [index, rule] of data.entries()) {
      if (ids.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate billing rule identity',
        });
      }
      ids.add(rule.id);
    }
    const visibleCustomCount = data.filter(
      (rule) => rule.billing_scope !== 'home_care_ssot',
    ).length;
    if (meta.summary.custom_rule_count !== visibleCustomCount) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'summary', 'custom_rule_count'],
        message: 'Custom billing rule count does not match returned data',
      });
    }
  });

export function buildBillingRuleResponseSchema(expectedId?: string) {
  return z
    .object({ data: billingRuleResponseItemSchema })
    .strict()
    .refine(({ data }) => expectedId === undefined || data.id === expectedId, {
      path: ['data', 'id'],
      message: 'Billing rule identity does not match the request',
    });
}

export const billingSsotSyncResponseSchema = z
  .object({
    data: z
      .object({
        message: nonEmptyText(1_000),
        seeded: z.number().int().nonnegative().optional(),
      })
      .strip(),
  })
  .strict();

export type BillingRuleResponseItem = z.infer<typeof billingRuleResponseItemSchema>;
export type BillingRulesResponse = z.infer<typeof billingRulesResponseSchema>;
