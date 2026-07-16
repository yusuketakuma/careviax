import { z } from 'zod';

const reviewLineSchema = z
  .object({
    id: z.string(),
    drug_name: z.string(),
    drug_code: z.string().nullable(),
    dosage_form: z.string().nullable(),
    dose: z.string(),
    frequency: z.string(),
    days: z.number().int(),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    route: z.string().nullable(),
  })
  .strict();

const reviewCandidateSchema = z
  .object({
    id: z.string(),
    display_id: z.string().nullable(),
    display_name: z.string(),
    case_id: z.string().nullable(),
    unit: z.string(),
    dosage_form: z.string().nullable(),
    route: z.string().nullable(),
    equivalence_review_status: z.string(),
    applicable: z.boolean(),
    current_quantity: z.number().nullable(),
    snapshot_calculated_at: z.string().datetime().nullable(),
  })
  .strict();

const previewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('blocked'),
      reason_code: z.string(),
      line: reviewLineSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reviewable'),
      line: reviewLineSchema,
      normalized_supply: z
        .object({ quantity: z.number().positive(), unit: z.string().min(1) })
        .strict(),
      candidates: z.array(reviewCandidateSchema),
    })
    .strict(),
]);

export const prescriptionSupplyReviewEnvelopeSchema = z
  .object({
    data: z
      .object({
        task: z
          .object({
            id: z.string(),
            reason_code: z.string().nullable(),
          })
          .strict(),
        patient: z
          .object({
            id: z.string(),
            display_id: z.string().nullable(),
            name: z.string(),
            name_kana: z.string(),
            birth_date: z.string().datetime(),
          })
          .strict(),
        preview: previewSchema,
      })
      .strict(),
  })
  .strict();

export type PrescriptionSupplyReviewEnvelope = z.infer<
  typeof prescriptionSupplyReviewEnvelopeSchema
>;
export type PrescriptionSupplyReviewDetail = PrescriptionSupplyReviewEnvelope['data'];
