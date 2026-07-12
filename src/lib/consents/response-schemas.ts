import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const offsetDateTime = z.string().datetime({ offset: true });
const persistedDate = z.union([z.string().date(), offsetDateTime]);
const consentType = z.enum([
  'visit_medication_management',
  'personal_info_handling',
  'external_sharing',
  'photo_capture',
]);
const consentMethod = z.enum(['paper_scan', 'digital']);
const auditedDocumentUrl = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/api/files/') && !value.startsWith('//'));

const templateOptionSchema = z
  .object({
    id: text(200),
    name: text(500),
    version: z.number().int().positive(),
    is_default: z.boolean(),
  })
  .passthrough()
  .transform(({ id, name, version, is_default }) => ({ id, name, version, is_default }));

export const consentTemplateListResponseSchema = z
  .object({
    data: z.array(templateOptionSchema).max(100),
    meta: z
      .object({
        total_count: z.number().int().nonnegative(),
        visible_count: z.number().int().nonnegative(),
        hidden_count: z.literal(0),
        truncated: z.literal(false),
        count_basis: z.literal('templates'),
        filters_applied: z
          .object({ template_type: z.literal('consent_form'), target_role: z.null() })
          .strict(),
        limit: z.number().int().positive().max(200),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (
      meta.visible_count !== data.length ||
      meta.total_count !== data.length ||
      new Set(data.map((item) => item.id)).size !== data.length
    )
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'Consent template list aggregate or identity drift',
      });
  });

const consentRecordSchema = z
  .object({
    id: text(200),
    patient_id: text(200),
    template_id: nullableText(200),
    template_version: z.number().int().positive().nullable(),
    template: z
      .object({ id: text(200), name: text(500), version: z.number().int().positive() })
      .strict()
      .nullable(),
    consent_type: consentType,
    method: consentMethod,
    obtained_date: persistedDate,
    expiry_date: persistedDate.nullable(),
    revoked_date: persistedDate.nullable(),
    document_url: auditedDocumentUrl.nullable(),
    has_document_url: z.boolean(),
    document_url_redacted: z.boolean(),
    is_active: z.boolean(),
    access_restricted: z.boolean(),
    created_at: offsetDateTime,
  })
  .passthrough()
  .transform(
    ({
      id,
      patient_id,
      template_id,
      template_version,
      template,
      consent_type,
      method,
      obtained_date,
      expiry_date,
      revoked_date,
      document_url,
      has_document_url,
      document_url_redacted,
      is_active,
      access_restricted,
      created_at,
    }) => ({
      id,
      patient_id,
      template_id,
      template_version,
      template,
      consent_type,
      method,
      obtained_date,
      expiry_date,
      revoked_date,
      document_url,
      has_document_url,
      document_url_redacted,
      is_active,
      access_restricted,
      created_at,
    }),
  );

function validateRecord(
  record: z.infer<typeof consentRecordSchema>,
  context: z.RefinementCtx,
  path: (string | number)[],
) {
  if (
    (record.template === null) !== (record.template_id === null) ||
    (record.template &&
      (record.template.id !== record.template_id ||
        record.template.version !== record.template_version))
  )
    context.addIssue({
      code: 'custom',
      path: [...path, 'template'],
      message: 'Consent template relation drift',
    });
  if (
    (record.revoked_date !== null) === record.is_active ||
    (record.document_url !== null && (!record.has_document_url || record.document_url_redacted)) ||
    (record.document_url_redacted && (!record.has_document_url || record.document_url !== null))
  )
    context.addIssue({
      code: 'custom',
      path,
      message: 'Consent status or document visibility drift',
    });
  if (record.expiry_date && record.expiry_date < record.obtained_date)
    context.addIssue({
      code: 'custom',
      path: [...path, 'expiry_date'],
      message: 'Consent expiry predates obtainment',
    });
}

export function buildConsentListResponseSchema(patientId: string) {
  return z
    .object({
      data: z.array(consentRecordSchema).max(50),
      meta: z
        .object({
          limit: z.literal(50),
          has_more: z.literal(false),
          next_cursor: z.null(),
          total_count: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      const ids = new Set<string>();
      let previousDate: string | null = null;
      for (const [index, record] of data.entries()) {
        if (
          record.patient_id !== patientId ||
          ids.has(record.id) ||
          (previousDate && record.obtained_date > previousDate)
        )
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'Consent patient, identity, or order drift',
          });
        ids.add(record.id);
        previousDate = record.obtained_date;
        validateRecord(record, context, ['data', index]);
      }
      if (meta.total_count !== data.length)
        context.addIssue({
          code: 'custom',
          path: ['meta', 'total_count'],
          message: 'Consent total count drift',
        });
    });
}

export function buildConsentRecordResponseSchema(args: {
  patientId: string;
  recordId?: string;
  expectedActive?: boolean;
}) {
  return z
    .object({ data: consentRecordSchema })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.patient_id !== args.patientId ||
        (args.recordId && data.id !== args.recordId) ||
        (args.expectedActive !== undefined && data.is_active !== args.expectedActive)
      )
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Consent mutation scope or state drift',
        });
      validateRecord(data, context, ['data']);
    });
}
