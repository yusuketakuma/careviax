import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const offsetDateTime = z.string().datetime({ offset: true });
const internalHref = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'));

const auditItemSchema = z
  .object({
    task_id: text(200),
    cycle_id: text(200),
    patient_name: text(500),
    priority: text(100),
    due_at: offsetDateTime.nullable(),
    intake_id: nullableText(200),
    prescribed_date: z.string().date().nullable(),
    handling_tags: z.array(text(100)).max(50),
    has_narcotic: z.boolean(),
    waiting_since: offsetDateTime.nullable(),
  })
  .strict();

const visitSchema = z
  .object({
    id: text(200),
    patient_name: text(500),
    visit_type: text(100),
    schedule_status: text(100),
    time_start: nullableText(100),
    time_end: nullableText(100),
    facility_batch_id: nullableText(200),
  })
  .strict();

const blockedReasonSchema = z
  .object({
    id: text(200),
    label: text(1_000),
    severity: z.enum(['critical', 'warning']),
    category: nullableText(200),
    age_minutes: z.number().int().nonnegative(),
    action_label: text(500),
    action_href: internalHref,
  })
  .strict();

export const dailyOpsCockpitResponseSchema = z
  .object({
    data: z
      .object({
        audit_queue: z.array(auditItemSchema).max(100),
        today_visits: z.array(visitSchema).max(500),
        blocked_reasons: z.array(blockedReasonSchema).max(100),
      })
      .passthrough()
      .transform(({ audit_queue, today_visits, blocked_reasons }) => ({
        audit_queue,
        today_visits,
        blocked_reasons,
      })),
  })
  .strict();

export type DailyOpsCockpitData = z.infer<typeof dailyOpsCockpitResponseSchema>['data'];
