import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const timestampSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative();

const participantSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    role: z.string().trim().min(1).max(500),
    external_professional_id: idSchema.optional(),
    attended: z.boolean().optional(),
    is_report_recipient: z.boolean().optional(),
    email: z.string().email().optional(),
    fax: z.string().max(100).optional(),
  })
  .strict();

const actionItemSchema = z
  .object({
    title: z.string().trim().min(1).max(2_000),
    assignee: z.string().max(500).optional(),
    converted_task_id: idSchema.optional(),
    converted_at: timestampSchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (Boolean(item.converted_task_id) !== Boolean(item.converted_at)) {
      context.addIssue({
        code: 'custom',
        path: ['converted_task_id'],
        message: 'task conversion mismatch',
      });
    }
  });

export function buildConferenceNoteDetailResponseSchema(expectedNoteId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedNoteId),
          note_type: z.enum([
            'regular',
            'pre_discharge',
            'service_manager',
            'care_team',
            'emergency',
            'death_conference',
          ]),
          title: z.string().trim().min(1).max(1_000),
          content: textSchema,
          participants: z.array(participantSchema).max(200),
          conference_date: timestampSchema,
          action_items: z.array(actionItemSchema).max(200).nullable(),
          case_id: idSchema.nullable(),
          patient_id: idSchema.nullable().optional(),
          sync_summary: z
            .object({
              report_draft_ids: z.array(idSchema).optional(),
              billing_candidate_id: idSchema.nullable().optional(),
              visit_proposal_id: idSchema.nullable().optional(),
              tasks_created: countSchema.optional(),
              medication_issues_created: countSchema.optional(),
            })
            .strict()
            .nullable()
            .optional(),
          generated_report_id: idSchema.nullable().optional(),
          created_at: timestampSchema,
        })
        .strip(),
    })
    .strict();
}

const externalProfessionalSchema = z
  .object({
    id: idSchema,
    profession_type: idSchema,
    name: z.string().trim().min(1).max(500),
    organization_name: nullableTextSchema,
    department: nullableTextSchema,
    phone: nullableTextSchema,
    email: nullableTextSchema,
    fax: nullableTextSchema,
  })
  .strip();

export const conferenceExternalProfessionalsResponseSchema = z
  .object({ data: z.array(externalProfessionalSchema).max(500) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    data.forEach((item, index) => {
      if (ids.has(item.id))
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'duplicate professional',
        });
      ids.add(item.id);
    });
  });

export const prescriberInstitutionSuggestionResponseSchema = z
  .object({
    data: z
      .object({
        id: idSchema,
        name: z.string().trim().min(1).max(1_000),
        phone: nullableTextSchema,
        fax: nullableTextSchema,
        address: nullableTextSchema,
        prescribed_date: z.union([z.string().date(), timestampSchema]),
        prescriber_name: nullableTextSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

const communityActivitySchema = z
  .object({
    id: idSchema,
    activity_type: idSchema,
    title: z.string().trim().min(1).max(1_000),
    description: nullableTextSchema,
    partner_name: nullableTextSchema,
    activity_date: timestampSchema,
    target_population: nullableTextSchema,
    attendee_count: countSchema.nullable(),
    referrals_generated: countSchema.nullable(),
    follow_up_required: z.boolean(),
    outcome_summary: nullableTextSchema,
    created_at: timestampSchema,
  })
  .strip();

export const communityActivityCreateResponseSchema = z
  .object({ data: communityActivitySchema })
  .strict();

export const convertConferenceActionItemResponseSchema = z
  .object({ data: z.object({ task_id: idSchema }).strict() })
  .strict();

export const generateConferenceReportResponseSchema = z
  .object({
    data: z
      .object({
        report_draft_count: countSchema,
        queued_recipient_count: countSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    if (data.queued_recipient_count > data.report_draft_count) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'queued_recipient_count'],
        message: 'queued recipients exceed report drafts',
      });
    }
  });
