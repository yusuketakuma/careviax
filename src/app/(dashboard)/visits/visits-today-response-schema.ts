import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableDateTime = z.string().datetime({ offset: true }).nullable();

const visitPrepCheckSchema = z
  .object({
    id: nonEmptyText(255),
    label: nonEmptyText(1_000),
    state: z.enum(['done', 'alert', 'progress', 'pending']),
  })
  .strict();

const visitPreparationCardSchema = z
  .object({
    schedule_id: nonEmptyText(255),
    visit_mode_href: nonEmptyText(2_048),
    time_label: nonEmptyText(100).nullable(),
    title: nonEmptyText(500),
    is_facility: z.boolean(),
    patient_count: z.number().int().nonnegative().nullable(),
    meta_label: nonEmptyText(500),
    safety_tags: z.array(nonEmptyText(255)).max(100),
    prep_done: z.number().int().nonnegative(),
    prep_total: z.number().int().nonnegative(),
    accent: z.enum(['ready', 'caution', 'progress']),
    checks: z.array(visitPrepCheckSchema).max(100),
    note: nonEmptyText(2_000).nullable(),
    note_tone: z.enum(['warning', 'info']).nullable(),
    actions: z
      .array(
        z
          .object({
            label: nonEmptyText(500),
            href: nonEmptyText(2_048),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.prep_done > card.prep_total || card.prep_total !== card.checks.length) {
      context.addIssue({
        code: 'custom',
        path: ['prep_total'],
        message: 'Preparation counts must match checks',
      });
    }
    if (card.is_facility !== (card.patient_count !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['patient_count'],
        message: 'Only facility cards may include a patient count',
      });
    }
    if ((card.note === null) !== (card.note_tone === null)) {
      context.addIssue({
        code: 'custom',
        path: ['note_tone'],
        message: 'Note and note tone must be present together',
      });
    }
  });

const visitPreparationBoardSchema = z
  .object({
    generated_at: z.string().datetime({ offset: true }),
    visit_count: z.number().int().nonnegative(),
    facility_patient_count: z.number().int().nonnegative(),
    cards: z.array(visitPreparationCardSchema).max(500),
    next_action: z
      .object({
        patient_name: nonEmptyText(500),
        due_at: nullableDateTime,
        has_narcotic: z.boolean(),
      })
      .strict()
      .nullable(),
    blocked_reasons: z
      .array(
        z
          .object({
            id: nonEmptyText(255),
            label: nonEmptyText(1_000),
            severity: z.enum(['critical', 'warning']),
            category: nonEmptyText(255),
            age_minutes: z.number().int().nonnegative(),
            action_label: nonEmptyText(500),
            action_href: nonEmptyText(2_048),
          })
          .strict(),
      )
      .max(100),
    evidence: z
      .object({
        route_calculated_at: nullableDateTime,
        vehicle_label: nonEmptyText(500).nullable(),
        prior_record_count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((board, context) => {
    const visitCount = board.cards.filter((card) => !card.is_facility).length;
    if (board.visit_count !== visitCount) {
      context.addIssue({
        code: 'custom',
        path: ['visit_count'],
        message: 'Visit count must match non-facility cards',
      });
    }

    const facilityPatientCount = board.cards.reduce(
      (total, card) => total + (card.patient_count ?? 0),
      0,
    );
    if (board.facility_patient_count !== facilityPatientCount) {
      context.addIssue({
        code: 'custom',
        path: ['facility_patient_count'],
        message: 'Facility patient count must match facility cards',
      });
    }
  });

export const visitsTodayResponseSchema = z
  .object({ data: visitPreparationBoardSchema })
  .strict()
  .transform((payload) => payload.data);
