import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const countSchema = z.number().int().nonnegative();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const nullableDateSchema = dateSchema.nullable();
const internalHrefSchema = z
  .string()
  .startsWith('/')
  .refine((href) => !href.startsWith('//'))
  .refine((href) => !/(?:token|storage_?key|x-amz-|signature)=/i.test(href));

const documentCheckSchema = z
  .object({
    key: idSchema,
    label: z.string().trim().min(1).max(500),
    completed: z.boolean(),
    severity: z.enum(['required', 'warning']),
    description: textSchema,
    action_href: internalHrefSchema,
    action_label: z.string().trim().min(1).max(500),
  })
  .strict();

const documentHistorySchema = z
  .object({
    id: idSchema,
    action: idSchema,
    document_type: nullableTextSchema,
    template_name: nullableTextSchema,
    template_version: nullableTextSchema,
    print_batch_id: idSchema.nullable().optional(),
    storage_location: nullableTextSchema,
    contract_date: nullableDateSchema,
    explanation_date: nullableDateSchema,
    explanation_staff_name: nullableTextSchema,
    signer_type: nullableTextSchema,
    signer_name: nullableTextSchema,
    signer_relationship: nullableTextSchema,
    reason: nullableTextSchema,
    note: nullableTextSchema,
    actor_id: idSchema,
    created_at: dateSchema,
  })
  .strict();

export function buildPatientDocumentsResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          patient: z
            .object({
              id: z.literal(expectedPatientId),
              name: z.string().trim().min(1).max(500),
              name_kana: z.string().max(500),
            })
            .strict(),
          print_readiness: z
            .object({
              overall_status: z.enum(['ready', 'warning', 'blocked']),
              missing_required_count: countSchema,
              warning_count: countSchema,
              template_versions: z.array(
                z
                  .object({
                    document_type: idSchema,
                    label: z.string().trim().min(1).max(500),
                    template_id: idSchema.nullable(),
                    template_name: nullableTextSchema,
                    template_version: nullableTextSchema,
                    effective_from: nullableDateSchema,
                    effective_to: nullableDateSchema,
                  })
                  .strict(),
              ),
              checks: z.array(documentCheckSchema),
            })
            .strict(),
          document_statuses: z.array(
            z
              .object({
                document_type: idSchema,
                label: z.string().trim().min(1).max(500),
                status: z.enum([
                  'not_created',
                  'created',
                  'printed',
                  'recovered',
                  'image_saved',
                  'replaced',
                  'invalidated',
                ]),
                status_label: z.string().trim().min(1).max(500),
                template_name: nullableTextSchema,
                template_version: nullableTextSchema,
                storage_location: nullableTextSchema,
                latest_action_at: nullableDateSchema,
                latest_printed_at: nullableDateSchema,
                latest_print_batch_id: idSchema.nullable(),
                latest_document_id: idSchema.nullable(),
                has_file: z.boolean(),
                delivered_at: nullableDateSchema,
                alerts: z.array(textSchema),
              })
              .strict(),
          ),
          first_visit_documents: z.array(
            z
              .object({
                id: idSchema,
                case_id: idSchema,
                emergency_contacts: z.array(
                  z
                    .object({
                      id: idSchema.optional(),
                      name: z.string().trim().min(1).max(500),
                      relation: nullableTextSchema,
                      phone: nullableTextSchema,
                      email: nullableTextSchema,
                      fax: nullableTextSchema,
                      organization_name: nullableTextSchema,
                      department: nullableTextSchema,
                      is_primary: z.boolean(),
                      is_emergency_contact: z.boolean(),
                    })
                    .strict(),
                ),
                document_url: nullableTextSchema,
                delivered_at: nullableDateSchema,
                delivered_to: nullableTextSchema,
                created_at: dateSchema,
                updated_at: dateSchema,
                history: z.array(documentHistorySchema),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const readiness = data.print_readiness;
      const missing = readiness.checks.filter(
        (check) => check.severity === 'required' && !check.completed,
      ).length;
      const warnings = readiness.checks.filter(
        (check) => check.severity === 'warning' && !check.completed,
      ).length;
      const expectedStatus = missing > 0 ? 'blocked' : warnings > 0 ? 'warning' : 'ready';
      if (
        readiness.missing_required_count !== missing ||
        readiness.warning_count !== warnings ||
        readiness.overall_status !== expectedStatus
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'print_readiness'],
          message: 'document readiness counts mismatch',
        });
      }
      for (const [path, values] of [
        ['template_versions', readiness.template_versions.map((item) => item.document_type)],
        ['checks', readiness.checks.map((item) => item.key)],
        ['document_statuses', data.document_statuses.map((item) => item.document_type)],
        ['first_visit_documents', data.first_visit_documents.map((item) => item.id)],
      ] as const) {
        if (new Set(values).size !== values.length)
          context.addIssue({ code: 'custom', path: ['data', path], message: 'duplicate identity' });
      }
    });
}

export function buildPatientHeaderSummaryResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          patient_id: z.literal(expectedPatientId),
          name: z.string().trim().min(1).max(500),
          name_kana: nullableTextSchema,
          birth_date: dateSchema,
          gender: idSchema,
          gender_label: textSchema,
          care_level: nullableTextSchema,
          care_level_label: nullableTextSchema,
          home_status_label: nullableTextSchema,
          residence_label: nullableTextSchema,
          primary_diagnosis: nullableTextSchema,
          intervention_start_date: z.string().date().nullable(),
          primary_pharmacist_name: nullableTextSchema,
          backup_pharmacist_name: nullableTextSchema,
          primary_staff_name: nullableTextSchema,
          backup_staff_name: nullableTextSchema,
          first_visit_date: nullableDateSchema,
          last_prescribed_date: nullableDateSchema,
          next_prescription_expected_date: nullableDateSchema,
          safety: z
            .object({
              allergy: nullableTextSchema,
              renal: nullableTextSchema,
              handling_tags: z.array(textSchema),
              swallowing: nullableTextSchema,
              cautions: z.array(textSchema),
              safety_tags: z.array(textSchema),
              visible_safety_tags: z.array(textSchema),
              hidden_safety_tag_count: countSchema,
            })
            .strict(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const { safety } = data;
      const all = new Set(safety.safety_tags);
      const visible = new Set(safety.visible_safety_tags);
      if (
        all.size !== safety.safety_tags.length ||
        visible.size !== safety.visible_safety_tags.length ||
        [...visible].some((tag) => !all.has(tag)) ||
        safety.hidden_safety_tag_count !== all.size - visible.size
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'safety'],
          message: 'safety tag counts mismatch',
        });
      }
    });
}
