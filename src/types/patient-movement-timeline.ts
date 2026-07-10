import { z } from 'zod';

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

const patientMovementTimelineEventSchema = z.custom<PatientMovementTimelineEvent>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.event_type === 'string' &&
    typeof event.category === 'string' &&
    typeof event.occurred_at === 'string' &&
    typeof event.title === 'string' &&
    typeof event.href === 'string' &&
    typeof event.privacy_level === 'string' &&
    typeof event.raw_available === 'boolean'
  );
});

export const patientMovementTimelineResponseSchema = z
  .object({
    data: z
      .object({
        movement_events: z.array(patientMovementTimelineEventSchema),
        partial_failures: z
          .array(z.object({ source: z.string(), message: z.string() }).strict())
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
            date_from: z.string().nullable(),
            date_to: z.string().nullable(),
          })
          .strict(),
        window_limit: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type PatientMovementTimelineResponse = z.infer<typeof patientMovementTimelineResponseSchema>;
