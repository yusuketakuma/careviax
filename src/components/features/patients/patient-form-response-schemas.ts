import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const countSchema = z.number().int().nonnegative();
const listMetaSchema = z
  .object({
    total_count: countSchema,
    visible_count: countSchema,
    hidden_count: countSchema,
    truncated: z.boolean(),
    count_basis: idSchema,
    filters_applied: z.record(z.string(), z.unknown()),
    limit: z.number().int().positive(),
  })
  .strip()
  .superRefine((meta, context) => {
    if (
      meta.visible_count + meta.hidden_count !== meta.total_count ||
      meta.truncated !== meta.hidden_count > 0
    ) {
      context.addIssue({ code: 'custom', message: 'list count metadata mismatch' });
    }
  });

export const patientDuplicateCheckResponseSchema = z
  .object({
    data: z
      .object({
        duplicates: z.array(
          z
            .object({
              id: idSchema,
              name: z.string().trim().min(1).max(500),
              birth_date: z.union([z.string().date(), z.string().datetime({ offset: true })]),
              gender: idSchema,
            })
            .strict()
            .transform((duplicate) => ({ ...duplicate, name_kana: null })),
        ),
      })
      .strict(),
  })
  .strict();

export const patientFormFacilitiesResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idSchema,
          name: z.string().trim().min(1).max(500),
          address: nullableTextSchema,
        })
        .strip(),
    ),
    meta: listMetaSchema,
  })
  .strict()
  .transform(({ data }) => ({ data }));

export const patientFormFacilityUnitsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idSchema,
          name: z.string().trim().min(1).max(500),
          floor: nullableTextSchema,
          unit_type: nullableTextSchema,
        })
        .strip(),
    ),
  })
  .strict();

export const patientFormServiceAreasResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idSchema,
          site_id: idSchema,
          name: z.string().trim().min(1).max(500),
          area_type: idSchema,
          geo_data: z.record(z.string(), z.unknown()).nullable(),
          notes: nullableTextSchema,
          site: z
            .object({ id: idSchema, name: z.string().trim().min(1).max(500) })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    meta: listMetaSchema,
  })
  .strict()
  .transform(({ data }) => ({ data }));

export const patientFormPharmacistsResponseSchema = z
  .object({
    data: z.array(z.object({ id: idSchema, name: z.string().trim().min(1).max(500) }).strip()),
    meta: listMetaSchema,
  })
  .strict()
  .transform(({ data }) => ({ data }));

export const patientFormStaffResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: idSchema,
          name: z.string().trim().min(1).max(500),
          role: idSchema,
        })
        .strict()
        .transform(({ id, name }) => ({ id, name })),
    ),
  })
  .strict();
