import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();
const nullableNonNegativeInteger = z.number().finite().int().nonnegative().nullable();
const boundedStringList = z.array(nonEmptyText(500)).max(100).nullable();

const adminUserSchema = z
  .object({
    id: nonEmptyText(200),
    cognito_linked: z.boolean(),
    name: nonEmptyText(500),
    name_kana: z.string().max(500).nullable(),
    email: z.email().max(500),
    phone: z.string().max(100).nullable(),
    role: z.enum([
      'owner',
      'admin',
      'pharmacist',
      'pharmacist_trainee',
      'clerk',
      'driver',
      'external_viewer',
    ]),
    site_id: z.string().max(200).nullable(),
    site_name: z.string().max(500).nullable(),
    is_active: z.boolean(),
    account_status: z.enum([
      'pending_cognito',
      'invited',
      'active',
      'suspended',
      'retired',
      'cognito_failed',
    ]),
    invited_at: nullableTimestamp,
    last_invited_at: nullableTimestamp,
    activated_at: nullableTimestamp,
    deactivated_at: nullableTimestamp,
    deactivation_reason: z.string().max(4_000).nullable(),
    last_active_at: nullableTimestamp,
    max_daily_visits: nullableNonNegativeInteger,
    max_weekly_visits: nullableNonNegativeInteger,
    max_travel_minutes: nullableNonNegativeInteger,
    can_accept_emergency: z.boolean(),
    visit_specialties: boundedStringList,
    coverage_area: boundedStringList,
    can_dispense: z.boolean(),
    can_audit_dispense: z.boolean(),
    can_set: z.boolean(),
    can_audit_set: z.boolean(),
    credential_types: z.array(nonEmptyText(500)).max(100),
    monthly_visit_count: z.number().finite().int().nonnegative(),
  })
  .strip();

export const adminUsersResponseSchema = z
  .object({
    data: z.array(adminUserSchema),
    meta: z
      .object({
        total_count: z.number().finite().int().nonnegative(),
        visible_count: z.number().finite().int().nonnegative(),
        hidden_count: z.number().finite().int().nonnegative(),
        truncated: z.boolean(),
        count_basis: z.literal('unique_users'),
        filters_applied: z
          .object({
            site_id: z.null(),
            include_collaborators: z.literal(true),
          })
          .strict(),
        limit: z.number().finite().int().min(1).max(500),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (
      meta.visible_count !== data.length ||
      meta.total_count !== meta.visible_count + meta.hidden_count ||
      meta.truncated !== meta.hidden_count > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['meta'],
        message: 'Admin user list metadata does not match the returned data',
      });
    }

    const userIds = new Set<string>();
    const emails = new Set<string>();
    for (const [index, user] of data.entries()) {
      if (userIds.has(user.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate admin user identity',
        });
      }
      userIds.add(user.id);

      const emailKey = user.email.toLowerCase();
      if (emails.has(emailKey)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'email'],
          message: 'Duplicate admin user email',
        });
      }
      emails.add(emailKey);
    }
  });

export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;
