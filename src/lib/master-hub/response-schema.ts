import { z } from 'zod';

const MASTER_HUB_KEYS = [
  'drugs',
  'institutions',
  'professionals',
  'facilities',
  'staff',
  'equipment',
  'vehicles',
  'pharmacy_sites',
  'operating_hours',
  'dispensing',
  'billing',
] as const;

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}
const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const INTERNAL_HREF = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'Master hub link must be an internal path',
  });
const MASTER_HUB_TIMESTAMP = z.string().datetime({ offset: true });

const masterHubCardSchema = z
  .object({
    key: z.enum(MASTER_HUB_KEYS),
    title: nonEmptyText(500),
    count: NON_NEGATIVE_COUNT,
    count_unit: nonEmptyText(50),
    last_updated_at: MASTER_HUB_TIMESTAMP.nullable(),
    status: z.enum(['healthy', 'checking', 'due_soon', 'expired']),
    status_count: NON_NEGATIVE_COUNT.nullable(),
    note: nonEmptyText(4_000),
    issue_count: NON_NEGATIVE_COUNT,
    next_action_hint: nonEmptyText(1_000),
    action_label: nonEmptyText(200),
    action_href: INTERNAL_HREF,
  })
  .strip();

const todayOpsNextActionSchema = z
  .object({
    label: nonEmptyText(500),
    description: nonEmptyText(4_000),
    href: INTERNAL_HREF,
  })
  .strip();

const todayOpsBlockedReasonSchema = z
  .object({
    id: nonEmptyText(200),
    label: nonEmptyText(4_000),
    severity: z.enum(['critical', 'warning']),
    category: nonEmptyText(200),
    age_minutes: NON_NEGATIVE_COUNT,
    action_label: nonEmptyText(200),
    action_href: INTERNAL_HREF,
  })
  .strip();

const todayOpsRailSchema = z
  .object({
    next_action: todayOpsNextActionSchema,
    blocked_reasons: z.array(todayOpsBlockedReasonSchema).max(3),
  })
  .strip();

export const masterHubResponseSchema = z
  .object({
    generated_at: MASTER_HUB_TIMESTAMP,
    masters: z.array(masterHubCardSchema).length(MASTER_HUB_KEYS.length),
    change_log_month_count: NON_NEGATIVE_COUNT,
    rail: todayOpsRailSchema,
  })
  .strict()
  .superRefine(({ masters }, context) => {
    const masterKeys = new Set<string>();
    for (const [index, master] of masters.entries()) {
      if (masterKeys.has(master.key)) {
        context.addIssue({
          code: 'custom',
          path: ['masters', index, 'key'],
          message: 'Duplicate master hub identity',
        });
      }
      masterKeys.add(master.key);

      if (
        master.status === 'checking' &&
        (master.status_count == null || master.status_count < 1)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['masters', index, 'status_count'],
          message: 'Checking master must provide a positive status count',
        });
      }
      if (master.status !== 'checking' && master.status_count !== null) {
        context.addIssue({
          code: 'custom',
          path: ['masters', index, 'status_count'],
          message: 'Only checking masters may provide a status count',
        });
      }
    }

    for (const key of MASTER_HUB_KEYS) {
      if (!masterKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['masters'],
          message: `Missing master hub key: ${key}`,
        });
      }
    }
  });

export const masterHubEnvelopeResponseSchema = z
  .object({
    data: masterHubResponseSchema,
  })
  .strict();

export type MasterHubResponse = z.infer<typeof masterHubResponseSchema>;
export type MasterHubEnvelopeResponse = z.infer<typeof masterHubEnvelopeResponseSchema>;
