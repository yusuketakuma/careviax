import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const nullableDateSchema = dateSchema.nullable();
const countSchema = z.number().int().nonnegative();
const internalHrefSchema = z
  .string()
  .startsWith('/')
  .refine((href) => !href.startsWith('//'))
  .refine((href) => !/(?:token|storage_?key|x-amz-|signature)=/i.test(href));

const setPlanSchema = z
  .object({
    id: idSchema,
    cycle_id: idSchema,
    target_period_start: dateSchema,
    target_period_end: dateSchema,
    set_method: idSchema,
    packaging_summary_snapshot: z
      .object({
        packaging_method_name: nullableTextSchema.optional(),
        special_instructions: z.array(textSchema).optional(),
        tag_labels: z.array(textSchema).optional(),
      })
      .strip()
      .nullable(),
    notes: nullableTextSchema,
    created_at: dateSchema,
    packaging_method_ref: z
      .object({ id: idSchema, name: z.string().trim().min(1).max(500) })
      .strip()
      .nullable()
      .optional(),
    cycle: z
      .object({
        id: idSchema,
        patient_id: idSchema,
        case_: z
          .object({
            patient: z
              .object({
                id: idSchema,
                name: z.string().trim().min(1).max(500),
                name_kana: z.string().max(500),
              })
              .strip(),
          })
          .strip(),
      })
      .strip(),
    audits: z.array(z.object({ id: idSchema, result: idSchema, audited_at: dateSchema }).strip()),
  })
  .strip();

export function buildPrintHubSetPlansResponseSchema(expectedPatientId: string | null) {
  return z
    .object({ data: z.array(setPlanSchema) })
    .strict()
    .superRefine(({ data }, context) => {
      if (new Set(data.map((plan) => plan.id)).size !== data.length) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'duplicate set plan identity',
        });
      }
      data.forEach((plan, index) => {
        if (
          plan.cycle.id !== plan.cycle_id ||
          plan.cycle.case_.patient.id !== plan.cycle.patient_id ||
          (expectedPatientId !== null && plan.cycle.patient_id !== expectedPatientId)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'cycle'],
            message: 'set plan patient or cycle relation mismatch',
          });
        }
        if (
          new Date(plan.target_period_end).getTime() < new Date(plan.target_period_start).getTime()
        ) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'target_period_end'],
            message: 'set plan period is reversed',
          });
        }
      });
    });
}

const prescriptionLineSchema = z
  .object({
    id: idSchema,
    line_number: z.number().int().positive(),
    drug_name: z.string().trim().min(1).max(1_000),
    dose: nullableTextSchema,
    frequency: nullableTextSchema,
    days: z.number().int().positive().nullable(),
    quantity: z.number().nonnegative().nullable(),
    unit: nullableTextSchema,
    notes: nullableTextSchema,
  })
  .strip();

const prescriptionIntakeSchema = z
  .object({
    id: idSchema,
    cycle_id: idSchema,
    prescribed_date: nullableDateSchema,
    prescriber_name: nullableTextSchema,
    prescriber_institution: nullableTextSchema,
    lines: z.array(prescriptionLineSchema),
  })
  .strip()
  .superRefine((intake, context) => {
    if (new Set(intake.lines.map((line) => line.id)).size !== intake.lines.length) {
      context.addIssue({ code: 'custom', path: ['lines'], message: 'duplicate prescription line' });
    }
  });

export function buildPrintHubPrescriptionsPageSchema(expectedPatientId: string) {
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
            .strip(),
          data: z.array(prescriptionIntakeSchema).max(20),
          hasMore: z.boolean(),
          nextCursor: idSchema.nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.hasMore !== Boolean(data.nextCursor)) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'prescription cursor mismatch',
        });
      }
      if (new Set(data.data.map((intake) => intake.id)).size !== data.data.length) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'data'],
          message: 'duplicate prescription intake',
        });
      }
    })
    .transform(({ data }) => data);
}

const readinessCheckSchema = z
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
    reason: nullableTextSchema,
    note: nullableTextSchema,
    actor_id: idSchema.nullable(),
    created_at: dateSchema,
  })
  .strip();

export function buildPrintHubPatientDocumentsResponseSchema(expectedPatientId: string) {
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
            .strip(),
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
                    template_name: nullableTextSchema,
                    template_version: nullableTextSchema,
                    effective_from: nullableDateSchema,
                    effective_to: nullableDateSchema,
                  })
                  .strip(),
              ),
              checks: z.array(readinessCheckSchema),
            })
            .strict(),
          first_visit_documents: z.array(
            z
              .object({
                id: idSchema,
                case_id: idSchema,
                document_url: internalHrefSchema.nullable(),
                delivered_at: nullableDateSchema,
                delivered_to: nullableTextSchema,
                created_at: dateSchema,
                updated_at: dateSchema,
                emergency_contacts: z.array(
                  z
                    .object({
                      id: idSchema.nullable().default(null),
                      name: z.string().trim().min(1).max(500),
                      relation: nullableTextSchema,
                      organization_name: nullableTextSchema,
                      department: nullableTextSchema,
                      phone: nullableTextSchema,
                      email: nullableTextSchema,
                      fax: nullableTextSchema,
                      is_primary: z.boolean(),
                      is_emergency_contact: z.boolean(),
                    })
                    .strip(),
                ),
                history: z.array(documentHistorySchema),
              })
              .strip(),
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
      const status = missing > 0 ? 'blocked' : warnings > 0 ? 'warning' : 'ready';
      if (
        readiness.missing_required_count !== missing ||
        readiness.warning_count !== warnings ||
        readiness.overall_status !== status
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'print_readiness'],
          message: 'print readiness counts mismatch',
        });
      }
      for (const [path, values] of [
        ['first_visit_documents', data.first_visit_documents.map((document) => document.id)],
        ['checks', readiness.checks.map((check) => check.key)],
        [
          'template_versions',
          readiness.template_versions.map((template) => template.document_type),
        ],
      ] as const) {
        if (new Set(values).size !== values.length) {
          context.addIssue({ code: 'custom', path: ['data', path], message: 'duplicate identity' });
        }
      }
    })
    .transform(({ data }) => data);
}
