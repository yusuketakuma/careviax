import { z } from 'zod';

export const nullableReferenceIdSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .transform((value) => value ?? null);

export const nullableNonNegativeIntSchema = z
  .number()
  .int()
  .min(0)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const nullableNoteSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const pharmacyDrugStockRequestedPayloadSchema = z.object({
  is_stocked: z.boolean(),
  reorder_point: nullableNonNegativeIntSchema,
  preferred_generic_id: nullableReferenceIdSchema,
  adoption_note: nullableNoteSchema,
});

export const formularyTemplateItemSchema = z.object({
  drug_master_id: z.string().trim().min(1),
  reorder_point: nullableNonNegativeIntSchema,
  preferred_generic_id: nullableReferenceIdSchema,
  adoption_note: nullableNoteSchema,
});

export type PharmacyDrugStockRequestedPayload = z.infer<
  typeof pharmacyDrugStockRequestedPayloadSchema
>;

export type FormularyTemplateItem = z.infer<typeof formularyTemplateItemSchema>;
