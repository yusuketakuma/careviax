import { z } from 'zod';

export const documentTemplateTypeSchema = z.enum([
  'care_report',
  'tracing_report',
  'management_plan',
  'medication_calendar',
  'contract_document',
  'important_matters',
  'privacy_consent',
  'consent_form',
]);

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();

const documentTemplateMetadataSchema = z
  .object({
    id: nonEmptyText(200),
    name: nonEmptyText(500),
    template_type: documentTemplateTypeSchema,
    target_role: z.string().max(100).nullable(),
    format: z.enum(['html', 'pdf']),
    version: z.number().finite().int().positive(),
    effective_from: nullableTimestamp,
    effective_to: nullableTimestamp,
    is_default: z.boolean(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strip()
  .refine(
    (value) =>
      value.effective_to === null ||
      value.effective_from === null ||
      value.effective_from < value.effective_to,
    { path: ['effective_to'], message: 'Template end time must be after its start time' },
  );

const documentTemplateDetailSchema = documentTemplateMetadataSchema.and(
  z.object({ content: z.record(z.string(), z.unknown()) }).strip(),
);

const documentTemplateBodyEditorDetailSchema = z
  .object({
    id: nonEmptyText(200),
    name: nonEmptyText(500),
    content: z.record(z.string(), z.unknown()),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strip();

export function buildDocumentTemplatesResponseSchema(
  expectedTemplateType: z.infer<typeof documentTemplateTypeSchema> | null,
) {
  return z
    .object({
      data: z.array(documentTemplateMetadataSchema),
      meta: z
        .object({
          total_count: z.number().finite().int().nonnegative(),
          visible_count: z.number().finite().int().nonnegative(),
          hidden_count: z.number().finite().int().nonnegative(),
          truncated: z.boolean(),
          count_basis: z.literal('templates'),
          filters_applied: z
            .object({
              template_type: documentTemplateTypeSchema.nullable(),
              target_role: z.null(),
            })
            .strict(),
          limit: z.number().finite().int().min(1).max(200),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (
        meta.filters_applied.template_type !== expectedTemplateType ||
        meta.visible_count !== data.length ||
        meta.total_count !== meta.visible_count + meta.hidden_count ||
        meta.truncated !== meta.hidden_count > 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['meta'],
          message: 'Template list metadata does not match the request or returned data',
        });
      }

      const templateIds = new Set<string>();
      for (const [index, template] of data.entries()) {
        if (templateIds.has(template.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate document template identity',
          });
        }
        if (expectedTemplateType !== null && template.template_type !== expectedTemplateType) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'template_type'],
            message: 'Template does not match the requested type',
          });
        }
        templateIds.add(template.id);
      }
    });
}

function withExpectedTemplateId<T extends { id: string }>(
  schema: z.ZodType<T>,
  expectedTemplateId: string,
) {
  return z
    .object({ data: schema })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.id !== expectedTemplateId) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'id'],
          message: 'Template response identity does not match the request',
        });
      }
    });
}

export function buildDocumentTemplateDetailResponseSchema(expectedTemplateId: string) {
  return withExpectedTemplateId(documentTemplateDetailSchema, expectedTemplateId);
}

export function buildDocumentTemplateBodyEditorResponseSchema(expectedTemplateId: string) {
  return withExpectedTemplateId(documentTemplateBodyEditorDetailSchema, expectedTemplateId);
}

export type DocumentTemplateType = z.infer<typeof documentTemplateTypeSchema>;
export type DocumentTemplateMetadata = z.infer<typeof documentTemplateMetadataSchema>;
export type DocumentTemplateDetail = z.infer<typeof documentTemplateDetailSchema>;
export type DocumentTemplatesResponse = z.infer<
  ReturnType<typeof buildDocumentTemplatesResponseSchema>
>;
export type DocumentTemplateDetailResponse = { data: DocumentTemplateDetail };
export type DocumentTemplateBodyEditorResponse = {
  data: z.infer<typeof documentTemplateBodyEditorDetailSchema>;
};
