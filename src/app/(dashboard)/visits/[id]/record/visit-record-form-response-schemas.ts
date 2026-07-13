import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);

const cdsAlertSchema = z
  .object({
    type: idSchema,
    severity: z.enum(['critical', 'warning', 'info']),
    message: z.string().trim().min(1).max(10_000),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const visitRecordCdsAlertsResponseSchema = z
  .object({ data: z.object({ alerts: z.array(cdsAlertSchema) }).strict() })
  .strict()
  .transform(({ data }) => data);

export function buildVisitRecordScheduleResponseSchema(expectedScheduleId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedScheduleId),
          patient_id: idSchema,
          cycle_id: idSchema.nullable(),
          scheduled_date: dateSchema,
          schedule_status: idSchema.optional(),
          visit_type: idSchema,
          carry_items_status: nullableTextSchema,
          recurrence_rule: nullableTextSchema.optional(),
          time_window_start: nullableTextSchema.optional(),
          case_: z
            .object({
              patient: z
                .object({ id: idSchema, name: z.string().trim().min(1).max(500) })
                .strip()
                .nullable()
                .optional(),
            })
            .strip()
            .nullable()
            .optional(),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const nestedPatientId = data.case_?.patient?.id;
      if (nestedPatientId && nestedPatientId !== data.patient_id) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'case_', 'patient', 'id'],
          message: 'visit schedule patient relation mismatch',
        });
      }
    })
    .transform(({ data }) => data);
}

export function buildVisitRecordHeaderSafetyResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          patient_id: z.literal(expectedPatientId),
          safety: z
            .object({
              safety_tags: z.array(textSchema),
              visible_safety_tags: z.array(textSchema),
              hidden_safety_tag_count: z.number().int().nonnegative(),
            })
            .strip(),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const all = new Set(data.safety.safety_tags);
      const visible = new Set(data.safety.visible_safety_tags);
      if (
        all.size !== data.safety.safety_tags.length ||
        visible.size !== data.safety.visible_safety_tags.length ||
        [...visible].some((tag) => !all.has(tag)) ||
        data.safety.hidden_safety_tag_count !== all.size - visible.size
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'safety'],
          message: 'patient safety tag counts mismatch',
        });
      }
    })
    .transform(({ data }) => ({ safety: data.safety }));
}

const savedVisitRecordSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    patient_id: idSchema,
  })
  .strip();

export function buildVisitRecordCreateResponseSchema(expectedPatientId: string) {
  return z
    .object({ data: z.object({ record: savedVisitRecordSchema }).strip() })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.record.patient_id !== expectedPatientId) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'record', 'patient_id'],
          message: 'created visit record patient mismatch',
        });
      }
    })
    .transform(({ data }) => data.record);
}

export function buildVisitRecordAttachmentPatchResponseSchema(
  expectedRecordId: string,
  expectedPatientId: string,
  previousVersion: number,
) {
  return z
    .object({ data: savedVisitRecordSchema })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.id !== expectedRecordId || data.patient_id !== expectedPatientId) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'patched visit record mismatch',
        });
      }
      if (data.version <= previousVersion) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'version'],
          message: 'patched visit record version did not advance',
        });
      }
    })
    .transform(({ data }) => data);
}
