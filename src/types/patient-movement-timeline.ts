import { z } from 'zod';
import { isSafePatientMovementHref } from '@/lib/patient/movement-href';

export type PatientMovementEventType =
  | 'visit_schedule'
  | 'visit_record'
  | 'prescription_intake'
  | 'dispense_result'
  | 'inquiry'
  | 'care_report'
  | 'delivery_record'
  | 'management_plan'
  | 'first_visit_document'
  | 'conference_note'
  | 'billing_candidate'
  | 'operation_history'
  | 'self_report'
  | 'communication'
  | 'external_share'
  | 'visit_event'
  | 'prescription_event'
  | 'document_registered'
  | 'inbound_communication'
  | 'inbound_mcs'
  | 'inbound_phone'
  | 'inbound_fax'
  | 'inbound_email'
  | 'inbound_medication_stock_signal'
  | 'medication_stock_event'
  | 'medication_stock_snapshot'
  | 'medication_equivalence_review'
  | 'interprofessional_note'
  | 'care_team_update'
  | 'safety_signal'
  | 'task_created'
  | 'task_resolved'
  | 'support_session';

export type PatientMovementCategory =
  | 'visit'
  | 'prescription'
  | 'medication_stock'
  | 'interprofessional'
  | 'communication'
  | 'document'
  | 'billing'
  | 'task'
  | 'safety'
  | 'system';

export type PatientMovementSeverity = 'blocking' | 'urgent' | 'warning' | 'info' | 'normal';

export type PatientMovementBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type PatientMovementPrivacyLevel = 'summary' | 'detail' | 'raw_phi';

export type PatientMovementTimelineEvent<TDate = string> = {
  id: string;
  event_type: PatientMovementEventType;
  category: PatientMovementCategory;
  occurred_at: TDate;
  recorded_at?: TDate | null;
  title: string;
  summary: string | null;
  href: string;
  action_label: string;
  status: string | null;
  status_label: string | null;
  actor_name: string | null;
  actor_role: string | null;
  source_channel: string | null;
  source_label: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  severity: PatientMovementSeverity;
  badges: Array<{
    label: string;
    tone: PatientMovementBadgeTone;
  }>;
  metadata: string[];
  privacy_level: PatientMovementPrivacyLevel;
  raw_available: boolean;
};

export type PatientMovementTimelineEventDetail<TDate = string> = {
  patient_id: string;
  event_id: string;
  event: PatientMovementTimelineEvent<TDate>;
  destination: {
    href: string;
    label: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
  };
  raw_text: {
    available: boolean;
    included: false;
    reason: string;
  };
};

const patientMovementTimelineEventSchema = z
  .object({
    id: z.string().min(1),
    event_type: z.enum([
      'visit_schedule',
      'visit_record',
      'prescription_intake',
      'dispense_result',
      'inquiry',
      'care_report',
      'delivery_record',
      'management_plan',
      'first_visit_document',
      'conference_note',
      'billing_candidate',
      'operation_history',
      'self_report',
      'communication',
      'external_share',
      'visit_event',
      'prescription_event',
      'document_registered',
      'inbound_communication',
      'inbound_mcs',
      'inbound_phone',
      'inbound_fax',
      'inbound_email',
      'inbound_medication_stock_signal',
      'medication_stock_event',
      'medication_stock_snapshot',
      'medication_equivalence_review',
      'interprofessional_note',
      'care_team_update',
      'safety_signal',
      'task_created',
      'task_resolved',
      'support_session',
    ]),
    category: z.enum([
      'visit',
      'prescription',
      'medication_stock',
      'interprofessional',
      'communication',
      'document',
      'billing',
      'task',
      'safety',
      'system',
    ]),
    occurred_at: z.string().datetime({ offset: true }),
    recorded_at: z.string().datetime({ offset: true }).nullable().optional(),
    title: z.string().min(1),
    summary: z.string().nullable(),
    href: z
      .string()
      .min(1)
      .refine(isSafePatientMovementHref, 'movement href must be a safe internal UI path'),
    action_label: z.string().min(1),
    status: z.string().nullable(),
    status_label: z.string().nullable(),
    actor_name: z.string().nullable(),
    actor_role: z.string().nullable(),
    source_channel: z.string().nullable(),
    source_label: z.string().nullable(),
    related_entity_type: z.string().nullable(),
    related_entity_id: z.string().nullable(),
    severity: z.enum(['blocking', 'urgent', 'warning', 'info', 'normal']),
    badges: z
      .array(
        z
          .object({
            label: z.string().min(1),
            tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']),
          })
          .strict(),
      )
      .max(20),
    metadata: z.array(z.string()).max(100),
    privacy_level: z.enum(['summary', 'detail', 'raw_phi']),
    raw_available: z.boolean(),
  })
  .strict();

export const patientMovementTimelineResponseSchema = z
  .object({
    data: z
      .object({
        movement_events: z.array(patientMovementTimelineEventSchema).max(40),
        partial_failures: z
          .array(
            z
              .object({
                source: z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/),
                message: z.literal('一部のタイムライン情報を取得できませんでした'),
              })
              .strict(),
          )
          .max(24)
          .optional(),
      })
      .strict(),
    meta: z
      .object({
        next_cursor: z.string().min(1).nullable(),
        has_more: z.boolean(),
        returned_count: z.number().int().nonnegative(),
        count_basis: z.literal('bounded_latest_window'),
        filters: z
          .object({
            category: z
              .enum([
                'visit',
                'prescription',
                'medication_stock',
                'interprofessional',
                'communication',
                'document',
                'billing',
                'task',
                'safety',
                'system',
              ])
              .nullable(),
            date_from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable(),
            date_to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable(),
          })
          .strict(),
        window_limit: z.literal(40),
        selection_order: z.literal('occurred_at_desc_id_desc'),
        presentation_order: z.literal('occurred_at_asc_id_asc'),
        cursor_direction: z.literal('older'),
        is_current_window: z.boolean(),
        current_event_id: z.string().min(1).nullable(),
        presentation_terminal_event_id: z.string().min(1).nullable(),
        window_start_at: z.string().datetime({ offset: true }).nullable(),
        window_end_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, ctx) => {
    const events = response.data.movement_events;
    const eventIds = new Set<string>();

    for (const [index, event] of events.entries()) {
      if (eventIds.has(event.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'movement_events', index, 'id'],
          message: 'movement event IDs must be unique',
        });
      }
      eventIds.add(event.id);

      const previous = events[index - 1];
      if (!previous) continue;
      const previousTime = Date.parse(previous.occurred_at);
      const currentTime = Date.parse(event.occurred_at);
      if (
        currentTime > previousTime ||
        (currentTime === previousTime && event.id.localeCompare(previous.id) > 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'movement_events', index],
          message: 'movement events must use occurred_at DESC and id DESC ordering',
        });
      }
    }

    if (response.meta.returned_count !== events.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'returned_count'],
        message: 'returned_count must match movement_events length',
      });
    }
    if (events.length > response.meta.window_limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'window_limit'],
        message: 'window_limit must bound the returned events',
      });
    }
    if (response.meta.has_more !== Boolean(response.meta.next_cursor)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'next_cursor presence must match has_more',
      });
    }
    const newest = events[0] ?? null;
    const oldest = events.at(-1) ?? null;
    const hasFilters = Object.values(response.meta.filters).some((value) => value !== null);
    const hasPartialFailures = Boolean(response.data.partial_failures?.length);
    const expectedCurrentId =
      response.meta.is_current_window && !hasFilters && !hasPartialFailures
        ? (newest?.id ?? null)
        : null;
    const expectedTerminalId = newest?.id ?? null;
    const expectedStartAt = oldest?.occurred_at ?? null;
    const expectedEndAt = newest?.occurred_at ?? null;

    if (response.meta.current_event_id !== expectedCurrentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'current_event_id'],
        message:
          expectedCurrentId === null
            ? 'filtered, partial, older, or empty windows cannot identify patient current'
            : 'a complete unfiltered current window must identify its newest event',
      });
    }
    if (response.meta.presentation_terminal_event_id !== expectedTerminalId) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'presentation_terminal_event_id'],
        message: 'presentation terminal must identify the newest event in the bounded window',
      });
    }
    if (response.meta.window_start_at !== expectedStartAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'window_start_at'],
        message: 'window_start_at must match the oldest returned event',
      });
    }
    if (response.meta.window_end_at !== expectedEndAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'window_end_at'],
        message: 'window_end_at must match the newest returned event',
      });
    }
    if (
      response.meta.filters.date_from &&
      response.meta.filters.date_to &&
      response.meta.filters.date_from > response.meta.filters.date_to
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'filters', 'date_to'],
        message: 'date_to must be on or after date_from',
      });
    }
  });

export type PatientMovementTimelineResponse = z.infer<typeof patientMovementTimelineResponseSchema>;
