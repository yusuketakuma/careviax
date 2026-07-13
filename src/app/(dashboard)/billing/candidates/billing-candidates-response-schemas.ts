import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const dateTimeSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative();
const billingDomainSchema = z.enum(['home_care', 'pca_rental']);
const billingStatusSchema = z.enum(['candidate', 'confirmed', 'excluded', 'exported']);

const validationLayerSchema = z
  .object({
    label: textSchema.optional(),
    state: z.enum(['passed', 'manual_review', 'blocked']).optional(),
    message: textSchema.optional(),
    version: textSchema.optional(),
  })
  .strip();

const workflowSchema = z
  .object({
    review_state: z.enum(['pending', 'reviewed']).optional(),
    resolution_state: z.enum(['unresolved', 'confirmed', 'excluded']).optional(),
    reviewed_at: dateTimeSchema.nullable().optional(),
    reviewed_by: idSchema.nullable().optional(),
    closed_at: dateTimeSchema.nullable().optional(),
    closed_by: idSchema.nullable().optional(),
    note: nullableTextSchema.optional(),
  })
  .strip();

const billingCandidateSchema = z
  .object({
    id: idSchema,
    patient_id: idSchema.nullable(),
    patient_name: nullableTextSchema,
    billing_domain: billingDomainSchema,
    billing_target_type: z.enum(['patient', 'institution']).nullable().optional(),
    billing_target_id: idSchema.nullable().optional(),
    billing_target_name: nullableTextSchema.optional(),
    billing_target_label: nullableTextSchema.optional(),
    billing_month: dateSchema,
    billing_code: idSchema,
    billing_name: z.string().trim().min(1).max(1_000),
    points: z.number().finite().nonnegative().nullable(),
    quantity: z.number().int().positive(),
    status: billingStatusSchema,
    exclusion_reason: nullableTextSchema,
    updated_at: dateTimeSchema,
    effective_revision_code: nullableTextSchema.optional(),
    site_config_revision_code: nullableTextSchema.optional(),
    site_config_status: nullableTextSchema.optional(),
    calculation_breakdown: z
      .object({
        calculation_unit: textSchema.optional(),
        amount_yen: z.number().finite().nonnegative().nullable().optional(),
        rate_percent: z.number().finite().nonnegative().nullable().optional(),
        derived_points: z.number().finite().nonnegative().nullable().optional(),
      })
      .strip()
      .nullable()
      .optional(),
    source_snapshot: z
      .object({
        billing_scope: textSchema.optional(),
        selection_mode: textSchema.optional(),
        source_note: textSchema.optional(),
        ruleset_version: textSchema.optional(),
        revision_code: textSchema.optional(),
        site_config_revision_code: textSchema.optional(),
        site_config_status: textSchema.optional(),
        source_type: textSchema.optional(),
        source_entity_id: idSchema.optional(),
        conference_note_id: idSchema.optional(),
        billing_fee_type: textSchema.optional(),
        duplicate_interaction_fee_type: textSchema.optional(),
        billing_assignment: z
          .object({
            building_id: idSchema.nullable().optional(),
            unit_name: nullableTextSchema.optional(),
            assignment_scope: z.enum(['building', 'unit', 'patient']).optional(),
            building_patient_count: countSchema.nullable().optional(),
            unit_patient_count: countSchema.nullable().optional(),
          })
          .strip()
          .nullable()
          .optional(),
        billing_close: workflowSchema.nullable().optional(),
        validation_layers: z.record(z.string(), validationLayerSchema.nullable()).optional(),
      })
      .strip()
      .nullable()
      .optional(),
    workflow_state: workflowSchema.nullable().optional(),
  })
  .strip();

const summarySchema = z
  .object({
    total: countSchema,
    pending_review: countSchema,
    confirmed: countSchema,
    excluded: countSchema,
    exported: countSchema,
    reviewed: countSchema,
    ready_to_close: countSchema,
    blocked_from_close: countSchema,
    blocker_reasons: z.array(
      z.object({ reason: z.string().trim().min(1).max(1_000), count: countSchema }).strict(),
    ),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.total !==
        summary.pending_review + summary.confirmed + summary.excluded + summary.exported ||
      summary.reviewed !== summary.confirmed + summary.excluded + summary.exported
    )
      context.addIssue({ code: 'custom', message: 'billing summary count mismatch' });
  });

export function buildBillingCandidatesPageResponseSchema(expected: {
  billingMonth: string;
  billingDomain: z.infer<typeof billingDomainSchema>;
  patientId: string | null;
}) {
  return z
    .object({
      data: z.array(billingCandidateSchema).max(50),
      meta: z
        .object({
          limit: z.literal(50),
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
          summary: summarySchema.nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (meta.has_more !== Boolean(meta.next_cursor))
        context.addIssue({ code: 'custom', path: ['meta'], message: 'billing cursor mismatch' });
      if (new Set(data.map((candidate) => candidate.id)).size !== data.length)
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'duplicate billing candidate',
        });
      data.forEach((candidate, index) => {
        if (
          candidate.billing_month.slice(0, 10) !== expected.billingMonth ||
          candidate.billing_domain !== expected.billingDomain ||
          (expected.patientId && candidate.patient_id !== expected.patientId)
        )
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'billing candidate outside requested scope',
          });
      });
    });
}

export function buildBillingExportPreviewResponseSchema(expected: {
  billingMonth: string;
  billingDomain: z.infer<typeof billingDomainSchema>;
}) {
  return z
    .object({
      data: z
        .object({
          billing_month: z.literal(expected.billingMonth),
          billing_domain: z.literal(expected.billingDomain),
          total_count: countSchema,
          exportable_count: countSchema,
          total_points: z.number().finite().nonnegative(),
          total_amount_yen: z.number().finite().nonnegative(),
          status_counts: z.partialRecord(billingStatusSchema, countSchema),
          insurance_type_counts: z
            .object({ medical: countSchema, care: countSchema, self: countSchema })
            .strict(),
          exclusion_reasons: z.array(z.object({ reason: textSchema, count: countSchema }).strict()),
          generated_at: dateTimeSchema,
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const statusTotal = Object.values(data.status_counts).reduce((sum, count) => sum + count, 0);
      const insuranceTotal = Object.values(data.insurance_type_counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (statusTotal !== data.total_count || insuranceTotal !== data.exportable_count)
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'billing preview count mismatch',
        });
    });
}

export function buildBillingCandidateGenerationResponseSchema(
  expectedDomain: z.infer<typeof billingDomainSchema>,
) {
  return z
    .object({
      data: z
        .object({
          message: z.string().trim().min(1).max(1_000),
          billing_domain: z.literal(expectedDomain),
          generated: countSchema,
          home_care_generated: countSchema,
          pca_rental_generated: countSchema,
          confirmed: countSchema,
          review_required: countSchema,
          excluded: countSchema,
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.generated !== data.home_care_generated + data.pca_rental_generated ||
        data.generated !== data.confirmed + data.review_required + data.excluded ||
        (expectedDomain === 'home_care' && data.pca_rental_generated !== 0) ||
        (expectedDomain === 'pca_rental' && data.home_care_generated !== 0)
      )
        context.addIssue({ code: 'custom', path: ['data'], message: 'generation count mismatch' });
    });
}

export function buildBillingCandidateReviewResponseSchema(expected: {
  candidateId: string;
  action: 'confirm' | 'exclude' | 'reopen';
  previousUpdatedAt: string;
}) {
  const expectedStatus =
    expected.action === 'confirm'
      ? 'confirmed'
      : expected.action === 'exclude'
        ? 'excluded'
        : 'candidate';
  return z
    .object({
      data: z
        .object({
          id: z.literal(expected.candidateId),
          status: z.literal(expectedStatus),
          updated_at: dateTimeSchema,
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (new Date(data.updated_at).getTime() <= new Date(expected.previousUpdatedAt).getTime())
        context.addIssue({
          code: 'custom',
          path: ['data', 'updated_at'],
          message: 'billing version did not advance',
        });
    })
    .transform(({ data }) => data);
}

export function buildBillingCloseResponseSchema(
  expectedDomain: z.infer<typeof billingDomainSchema>,
) {
  return z
    .object({
      data: z
        .object({
          message: z.string().trim().min(1).max(1_000),
          billing_domain: z.literal(expectedDomain),
          exported_count: countSchema,
        })
        .strip(),
    })
    .strict()
    .transform(({ data }) => data);
}
