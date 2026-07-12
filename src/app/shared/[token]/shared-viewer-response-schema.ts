import { z } from 'zod';

const text = z.string().trim().min(1).max(10_000);
const shortText = z.string().trim().min(1).max(1_000);
const nullableText = z.string().max(10_000).nullable();
const count = z.number().finite().int().nonnegative();
const dateTime = z.string().datetime({ offset: true });
const apiDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTime]);

const archiveSchema = z
  .object({
    status: z.enum(['active', 'archived']),
    archived: z.boolean(),
    archived_at: dateTime.nullable(),
  })
  .strict()
  .superRefine((archive, context) => {
    const expectedArchived = archive.archived_at != null;
    if (archive.archived !== expectedArchived) {
      context.addIssue({
        code: 'custom',
        path: ['archived'],
        message: 'Archive flag and timestamp must agree',
      });
    }
    if (archive.status !== (expectedArchived ? 'archived' : 'active')) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Archive status and timestamp must agree',
      });
    }
  });

const medicationProfileSchema = z
  .object({
    id: shortText,
    drug_name: shortText,
    dose: nullableText,
    frequency: nullableText,
    start_date: dateTime.nullable(),
    end_date: dateTime.nullable(),
    is_current: z.literal(true),
  })
  .strip();

const visitScheduleSchema = z
  .object({
    id: shortText,
    scheduled_date: dateTime,
    time_window_start: dateTime.nullable(),
    time_window_end: dateTime.nullable(),
    schedule_status: shortText,
  })
  .strip();

const careReportSchema = z
  .object({
    id: shortText,
    report_type: shortText,
    status: z.enum(['sent', 'confirmed']),
    created_at: dateTime,
  })
  .strip();

const unsupportedSelfReportHistoryRowSchema = z
  .object({
    id: shortText,
    reported_by_name: shortText,
    relation: nullableText,
    category: shortText,
    subject: shortText,
    content: text,
    requested_callback: z.boolean(),
    preferred_contact_time: nullableText,
    status: shortText,
    created_at: dateTime,
    triaged_at: dateTime.nullable(),
  })
  .strip();

const labeledCountSchema = (key: string) =>
  z
    .object({
      [key]: shortText,
      label: shortText,
      count,
    })
    .strip();

const signalLabelSchema = (key: string) =>
  z
    .object({
      [key]: shortText,
      label: shortText,
    })
    .strip();

const inboundRecentEventSchema = z
  .object({
    received_at: dateTime,
    event_type: shortText,
    event_type_label: shortText,
    source_channel: shortText,
    source_channel_label: shortText,
    sender_role: shortText,
    sender_role_label: shortText,
    flags: z
      .object({
        medication_stock: z.boolean(),
        patient_safety: z.boolean(),
        schedule: z.boolean(),
        report: z.boolean(),
      })
      .strict(),
    signal_domains: z.array(signalLabelSchema('signal_domain')).max(50),
    signal_types: z.array(signalLabelSchema('signal_type')).max(50),
  })
  .strip();

const inboundSummarySchema = z
  .object({
    version: z.literal(1),
    window: z
      .object({
        from: dateTime,
        to: dateTime,
        days: z.number().int().positive().max(365),
      })
      .strict()
      .superRefine((window, context) => {
        if (window.from > window.to) {
          context.addIssue({ code: 'custom', path: ['to'], message: 'Inbound window is reversed' });
        }
      }),
    totals: z
      .object({
        event_count: count,
        signal_count: count,
        safety_event_count: count,
        medication_stock_event_count: count,
        schedule_event_count: count,
        report_event_count: count,
        urgent_signal_count: count,
        truncated: z.boolean(),
      })
      .strict(),
    latest_received_at: dateTime.nullable(),
    event_type_counts: z.array(labeledCountSchema('event_type')).max(200),
    signal_domain_counts: z.array(labeledCountSchema('signal_domain')).max(200),
    signal_type_counts: z.array(labeledCountSchema('signal_type')).max(200),
    source_channel_counts: z.array(labeledCountSchema('source_channel')).max(200),
    recent_events: z.array(inboundRecentEventSchema).max(10),
  })
  .strip()
  .superRefine((summary, context) => {
    const { totals } = summary;
    for (const key of [
      'safety_event_count',
      'medication_stock_event_count',
      'schedule_event_count',
      'report_event_count',
    ] as const) {
      if (totals[key] > totals.event_count) {
        context.addIssue({
          code: 'custom',
          path: ['totals', key],
          message: `${key} exceeds event count`,
        });
      }
    }
    if (totals.urgent_signal_count > totals.signal_count) {
      context.addIssue({
        code: 'custom',
        path: ['totals', 'urgent_signal_count'],
        message: 'Urgent signals exceed signal count',
      });
    }
    if (sumCounts(summary.event_type_counts) !== totals.event_count) {
      context.addIssue({
        code: 'custom',
        path: ['event_type_counts'],
        message: 'Event type counts do not match total',
      });
    }
    if (sumCounts(summary.source_channel_counts) !== totals.event_count) {
      context.addIssue({
        code: 'custom',
        path: ['source_channel_counts'],
        message: 'Source channel counts do not match total',
      });
    }
    if (sumCounts(summary.signal_domain_counts) !== totals.signal_count) {
      context.addIssue({
        code: 'custom',
        path: ['signal_domain_counts'],
        message: 'Signal domain counts do not match total',
      });
    }
    if (sumCounts(summary.signal_type_counts) !== totals.signal_count) {
      context.addIssue({
        code: 'custom',
        path: ['signal_type_counts'],
        message: 'Signal type counts do not match total',
      });
    }
    if (summary.recent_events.length > totals.event_count) {
      context.addIssue({
        code: 'custom',
        path: ['recent_events'],
        message: 'Recent events exceed event count',
      });
    }
    if ((totals.event_count === 0) !== (summary.latest_received_at == null)) {
      context.addIssue({
        code: 'custom',
        path: ['latest_received_at'],
        message: 'Latest received timestamp and event count must agree',
      });
    }
  });

function sumCounts(rows: Array<Record<string, string | number>>) {
  return rows.reduce((sum, row) => sum + (typeof row.count === 'number' ? row.count : 0), 0);
}

const publicScopeSchema = z
  .object({
    allergy_info: z.boolean().optional(),
    medication_list: z.boolean().optional(),
    visit_schedule: z.boolean().optional(),
    care_reports: z.boolean().optional(),
    inbound_communication_summary: z.boolean().optional(),
  })
  .strict()
  .refine((scope) => Object.values(scope).some((enabled) => enabled === true), {
    message: 'At least one supported public scope must be enabled',
  });

export const sharedViewerResponseSchema = z
  .object({
    data: z
      .object({
        patient: z
          .object({
            id: shortText,
            name: shortText,
            birth_date: apiDate.nullable(),
            gender: z.enum(['male', 'female', 'other', 'unknown']).nullable(),
            archive: archiveSchema,
          })
          .strip(),
        allergy_info: nullableText.optional(),
        medication_profiles: z.array(medicationProfileSchema).optional(),
        visit_schedules: z.array(visitScheduleSchema).max(10).optional(),
        care_reports: z.array(careReportSchema).max(3).optional(),
        inbound_communication_summary: inboundSummarySchema.optional(),
        self_report_history: z.array(unsupportedSelfReportHistoryRowSchema).max(0),
        shared_summary: z
          .object({
            headline: text,
            bullets: z.array(text).max(4),
            key_medications: z.array(shortText).max(4),
            next_visit_date: dateTime.nullable(),
          })
          .strip(),
        scope: publicScopeSchema,
        expires_at: dateTime,
      })
      .strip(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const sectionRules = [
      ['medication_list', 'medication_profiles'],
      ['visit_schedule', 'visit_schedules'],
      ['care_reports', 'care_reports'],
      ['inbound_communication_summary', 'inbound_communication_summary'],
    ] as const;

    for (const [scopeKey, sectionKey] of sectionRules) {
      const enabled = data.scope[scopeKey] === true;
      const present = data[sectionKey] !== undefined;
      if (enabled !== present) {
        context.addIssue({
          code: 'custom',
          path: ['data', sectionKey],
          message: `${sectionKey} presence must match ${scopeKey} scope`,
        });
      }
    }
    if (data.allergy_info !== undefined && data.scope.allergy_info !== true) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'allergy_info'],
        message: 'Allergy information requires allergy scope',
      });
    }

    addDuplicateIssues(data.medication_profiles ?? [], 'id', context, 'medication_profiles');
    addDuplicateIssues(data.visit_schedules ?? [], 'id', context, 'visit_schedules');
    addDuplicateIssues(data.care_reports ?? [], 'id', context, 'care_reports');
  });

function addDuplicateIssues(
  rows: Array<{ id: string }>,
  key: 'id',
  context: z.RefinementCtx,
  section: string,
) {
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (ids.has(row[key])) {
      context.addIssue({
        code: 'custom',
        path: ['data', section, index, key],
        message: `${section} identities must be unique`,
      });
    }
    ids.add(row[key]);
  }
}

export type SharedViewerResponse = z.infer<typeof sharedViewerResponseSchema>;
export type SharedViewerPayload = SharedViewerResponse['data'];
