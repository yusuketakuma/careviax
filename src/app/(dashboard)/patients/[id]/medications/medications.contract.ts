import { z } from 'zod';
import { apiCursorPageSchema } from '@/lib/api/response-schemas';
import { patientGenderSchema } from '@/lib/validations/patient';

const apiDateSchema = z.union([z.string().date(), z.string().datetime()]);

export const medicationProfileSchema = z
  .object({
    id: z.string().trim().min(1),
    patient_id: z.string().trim().min(1),
    drug_name: z.string().trim().min(1),
    dose: z.string().nullable(),
    frequency: z.string().nullable(),
    start_date: apiDateSchema.nullable(),
    end_date: apiDateSchema.nullable(),
    prescriber: z.string().nullable(),
    is_current: z.literal(true),
    source: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .superRefine((profile, context) => {
    if (
      profile.start_date &&
      profile.end_date &&
      new Date(profile.start_date).getTime() > new Date(profile.end_date).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['end_date'],
        message: 'Medication end date must not precede the start date',
      });
    }
  });

export const medicationProfilesCursorResponseSchema = apiCursorPageSchema(medicationProfileSchema, {
  allowAdditionalMeta: true,
});

const medicationAllergySchema = z.object({
  drug_name: z.string().trim().min(1),
  category: z.enum(['drug', 'food', 'other']),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']),
});

export const patientMedicationSummaryResponseSchema = z
  .object({
    data: z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1),
      name_kana: z.string(),
      birth_date: apiDateSchema,
      gender: patientGenderSchema,
      allergy_info: z
        .array(z.union([z.string().trim().min(1), medicationAllergySchema]))
        .nullable(),
    }),
  })
  .strict();

const inquiryRecordSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  inquiry_to_physician: z.string().trim().min(1),
  inquiry_content: z.string().trim().min(1),
  result: z.enum(['changed', 'unchanged', 'pending']).nullable(),
  proposal_origin: z.enum(['post_inquiry', 'pre_issuance']).nullable(),
  residual_adjustment: z.boolean().nullable(),
  change_detail: z.string().nullable(),
  inquired_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
  line: z
    .object({
      drug_name: z.string().nullable(),
      line_number: z.number().int().positive().nullable(),
    })
    .nullable(),
});

export const inquiryRecordsResponseSchema = z
  .object({ data: z.array(inquiryRecordSchema) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, record] of payload.data.entries()) {
      if (ids.has(record.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate inquiry record id',
        });
      }
      ids.add(record.id);
    }
  });

export type MedicationProfile = z.infer<typeof medicationProfileSchema>;
