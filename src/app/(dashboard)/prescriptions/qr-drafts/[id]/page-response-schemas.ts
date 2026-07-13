import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const optionalTextSchema = textSchema.optional();
const nullableTextSchema = textSchema.nullable();
const optionalNullableTextSchema = nullableTextSchema.optional();
const dateTimeSchema = z.string().datetime({ offset: true });

const qrLineSchema = z
  .object({
    drugName: optionalTextSchema,
    drugCode: optionalTextSchema,
    sourceDrugCode: optionalNullableTextSchema,
    sourceDrugCodeType: optionalNullableTextSchema,
    drugCodeResolutionStatus: z
      .enum(['resolved', 'review_required', 'unresolved'])
      .nullable()
      .optional(),
    drugCodeResolutionSource: optionalNullableTextSchema,
    candidateDrugMasterId: optionalNullableTextSchema,
    candidateDrugCode: optionalNullableTextSchema,
    candidateDrugName: optionalNullableTextSchema,
    dosageForm: optionalTextSchema,
    dose: optionalTextSchema,
    frequency: optionalTextSchema,
    days: z.number().int().positive().optional(),
    quantity: z.number().nonnegative().optional(),
    unit: optionalTextSchema,
    isGeneric: z.boolean().optional(),
    packagingMethod: optionalTextSchema,
    packagingInstructions: optionalTextSchema,
    packagingInstructionTags: z.array(textSchema).optional(),
    route: optionalTextSchema,
    dispensingMethod: optionalTextSchema,
    startDate: optionalTextSchema,
    endDate: optionalTextSchema,
    notes: optionalTextSchema,
  })
  .strict();

const supplementalRecordSchema = z
  .object({
    id: idSchema.optional(),
    recordType: idSchema,
    recordLabel: textSchema,
    lineNumber: z.number().int().positive(),
    summary: optionalNullableTextSchema,
    details: z.array(z.object({ label: textSchema, value: textSchema }).strict()).optional(),
    rawLine: textSchema,
  })
  .strip();

const parsedDataSchema = z
  .object({
    patientName: optionalTextSchema,
    patientNameKana: optionalTextSchema,
    patientBirthdate: optionalTextSchema,
    patientGender: optionalTextSchema,
    prescriptionDate: optionalTextSchema,
    prescriptionIssueDate: optionalNullableTextSchema,
    prescriptionExpirationDate: optionalNullableTextSchema,
    prescriberName: optionalTextSchema,
    prescriberInstitution: optionalTextSchema,
    prescriberInstitutionId: optionalNullableTextSchema,
    prescriberInstitutionCode: optionalTextSchema,
    prescriptionInsurance: z
      .object({
        insurerNumber: optionalTextSchema,
        symbol: optionalTextSchema,
        number: optionalTextSchema,
        branchNumber: optionalTextSchema,
        patientCopayRatio: z.number().min(0).max(100).optional(),
        publicSubsidies: z
          .array(
            z
              .object({
                rank: z.number().int().positive(),
                payerNumber: textSchema,
                recipientNumber: optionalTextSchema,
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    dispensingInstitution: z
      .object({ name: optionalTextSchema, institutionCode: optionalTextSchema })
      .strict()
      .optional(),
    remarks: z.array(textSchema).optional(),
    patientNotes: z.array(textSchema).optional(),
    splitInfo: z
      .object({
        dataId: idSchema,
        splitCount: z.number().int().positive(),
        sequenceNumber: z.number().int().positive(),
      })
      .strict()
      .nullable()
      .optional(),
    parseWarnings: z
      .array(
        z
          .object({
            recordType: optionalTextSchema,
            field: optionalTextSchema,
            message: textSchema,
          })
          .strict(),
      )
      .optional(),
    rawRecords: z
      .array(z.object({ recordType: idSchema, lineNumber: z.number().int().positive() }).strip())
      .optional(),
    lines: z.array(qrLineSchema).optional(),
    supplementalRecords: z.array(supplementalRecordSchema).optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (
      data.splitInfo &&
      (data.splitInfo.sequenceNumber > data.splitInfo.splitCount || data.splitInfo.splitCount > 100)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['splitInfo'],
        message: 'invalid QR split sequence',
      });
    }
  });

export function buildQrDraftDetailResponseSchema(expectedDraftId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedDraftId),
          patient_id: idSchema.nullable(),
          session_id: idSchema,
          status: z.enum(['pending', 'confirmed', 'discarded']),
          parsed_data: parsedDataSchema,
          parse_errors: z
            .array(z.object({ field: optionalTextSchema, message: textSchema }).strict())
            .nullable(),
          auto_completed: z
            .array(
              z
                .object({ field: idSchema, lineIndex: z.number().int().nonnegative().optional() })
                .strict(),
            )
            .nullable(),
          expected_qr_count: z.number().int().positive().nullable(),
          jahis_supplemental_records: z
            .array(
              z
                .object({
                  id: idSchema,
                  record_type: idSchema,
                  record_label: textSchema,
                  line_number: z.number().int().positive(),
                  summary: nullableTextSchema,
                })
                .strict(),
            )
            .optional(),
          created_at: dateTimeSchema,
        })
        .strip(),
    })
    .strict()
    .transform(({ data }) => data);
}

const caseOptionSchema = z
  .object({
    id: idSchema,
    patient_id: idSchema,
    display_id: nullableTextSchema.optional(),
    status: z.literal('active'),
  })
  .strip();

export function buildQrDraftCasesPageSchema(expectedPatientId: string) {
  return z
    .object({
      data: z.array(caseOptionSchema).max(20),
      meta: z
        .object({
          limit: z.literal(20),
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (meta.has_more !== Boolean(meta.next_cursor)) {
        context.addIssue({ code: 'custom', path: ['meta'], message: 'case cursor mismatch' });
      }
      if (new Set(data.map((careCase) => careCase.id)).size !== data.length) {
        context.addIssue({ code: 'custom', path: ['data'], message: 'duplicate case identity' });
      }
      data.forEach((careCase, index) => {
        if (careCase.patient_id !== expectedPatientId) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'patient_id'],
            message: 'case patient mismatch',
          });
        }
      });
    })
    .transform(({ data, meta }) => ({
      data: data.map(({ id, display_id, status }) => ({ id, display_id, status })),
      meta,
    }));
}

export function buildQrDraftConfirmResponseSchema(
  expectedPatientId: string,
  expectedCaseId: string,
) {
  return z
    .object({
      data: z
        .object({
          intake: z.object({ id: idSchema }).strip(),
          cycle: z
            .object({
              id: idSchema,
              patient_id: z.literal(expectedPatientId),
              case_id: z.literal(expectedCaseId),
            })
            .strip(),
        })
        .strip(),
    })
    .strict()
    .transform(({ data }) => ({
      intake: { id: data.intake.id },
      cycle: { id: data.cycle.id },
    }));
}
