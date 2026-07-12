import { z } from 'zod';

const dateKeySchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u);
const nonEmptyText = z.string().trim().min(1).max(500);
const identitySchema = z.string().trim().min(1).max(300);
const countSchema = z.number().finite().int().nonnegative();
const quantitySchema = z.number().finite().nonnegative();
const statusSchema = z.enum(['order_required', 'order_candidate', 'sufficient']);
const evidenceSchema = z.enum(['registered_stock', 'missing_adopted_stock_record']);
const basisSchema = z.enum(['line_end_date', 'line_start_date_plus_days', 'unknown']);
const urgencySchema = z.enum(['critical', 'warning', 'normal', 'unknown']);

const stockEvidenceFields = {
  stockRegistered: z.boolean(),
  stockEvidence: evidenceSchema,
};

function validateStockEvidence(
  value: {
    stockRegistered: boolean;
    stockEvidence: z.infer<typeof evidenceSchema>;
    stockQty: number;
  },
  context: z.RefinementCtx,
) {
  const expected = value.stockRegistered ? 'registered_stock' : 'missing_adopted_stock_record';
  if (value.stockEvidence !== expected) {
    context.addIssue({
      code: 'custom',
      path: ['stockEvidence'],
      message: 'Stock evidence must match stock registration state',
    });
  }
  if (!value.stockRegistered && value.stockQty !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['stockQty'],
      message: 'Missing adopted stock records must not report a stock quantity',
    });
  }
}

const drugForecastRowSchema = z
  .object({
    drugIdentityKey: identitySchema,
    drugCode: nonEmptyText.nullable(),
    drugKey: nonEmptyText,
    requiredQty: quantitySchema,
    stockQty: quantitySchema,
    unit: nonEmptyText,
    status: statusSchema,
    ...stockEvidenceFields,
  })
  .strip()
  .superRefine(validateStockEvidence);

const shortageDetailSchema = z
  .object({
    drugIdentityKey: identitySchema,
    drugCode: nonEmptyText.nullable(),
    drugKey: nonEmptyText,
    requiredQty: quantitySchema,
    stockQty: quantitySchema,
    unit: nonEmptyText,
    status: z.enum(['order_required', 'order_candidate']),
    ...stockEvidenceFields,
    affectedPatientCount: countSchema.min(1),
    runOutDateKey: dateKeySchema.nullable(),
    runOutBasis: basisSchema,
    urgency: urgencySchema,
  })
  .strip()
  .superRefine((value, context) => {
    validateStockEvidence(value, context);
    if ((value.runOutDateKey == null) !== (value.runOutBasis === 'unknown')) {
      context.addIssue({
        code: 'custom',
        path: ['runOutBasis'],
        message: 'Run-out basis must match run-out date availability',
      });
    }
  });

const affectedPatientSchema = z
  .object({
    key: identitySchema,
    patientId: identitySchema.nullable(),
    label: nonEmptyText,
    firstVisitDateKey: dateKeySchema,
    isFacilityBatch: z.boolean(),
    facilityPatientCount: countSchema.min(1).nullable(),
    shortagePatientCount: countSchema.min(1),
    dataBackedPatientCount: countSchema.min(1),
    shortageDrugKeys: z.array(nonEmptyText).min(1),
    runOutDateKey: dateKeySchema.nullable(),
    runOutBasis: basisSchema,
    urgency: urgencySchema,
    shortageDetails: z.array(shortageDetailSchema).min(1),
  })
  .strip()
  .superRefine((value, context) => {
    if (value.isFacilityBatch !== (value.patientId == null)) {
      context.addIssue({
        code: 'custom',
        path: ['patientId'],
        message: 'Patient identity must match card scope',
      });
    }
    if (value.isFacilityBatch !== (value.facilityPatientCount != null)) {
      context.addIssue({
        code: 'custom',
        path: ['facilityPatientCount'],
        message: 'Facility count must match card scope',
      });
    }
    if ((value.runOutDateKey == null) !== (value.runOutBasis === 'unknown')) {
      context.addIssue({
        code: 'custom',
        path: ['runOutBasis'],
        message: 'Run-out basis must match date availability',
      });
    }
    if (new Set(value.shortageDrugKeys).size !== value.shortageDrugKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['shortageDrugKeys'],
        message: 'Shortage drug labels must be unique',
      });
    }
    const detailKeys = new Set(value.shortageDetails.map((detail) => detail.drugKey));
    if (value.shortageDrugKeys.some((key) => !detailKeys.has(key))) {
      context.addIssue({
        code: 'custom',
        path: ['shortageDrugKeys'],
        message: 'Shortage labels must have detail evidence',
      });
    }
  });

const unresolvedDrugSchema = z
  .object({
    drugIdentityKey: identitySchema,
    drugCode: nonEmptyText.nullable(),
    reason: z.enum(['missing_code', 'code_not_found', 'ambiguous_code']),
    drugKey: nonEmptyText,
    requiredQty: quantitySchema,
    unit: nonEmptyText,
    affectedPatientCount: countSchema.min(1),
  })
  .strip();

export const inventoryForecastResponseSchema = z
  .object({
    data: z
      .object({
        week: z.object({ start_date: dateKeySchema, end_date: dateKeySchema }).strict(),
        drugs: z.array(drugForecastRowSchema),
        patients: z.array(affectedPatientSchema),
        unresolvedDrugs: z.array(unresolvedDrugSchema),
      })
      .strip(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    if (data.week.start_date > data.week.end_date) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'week'],
        message: 'Forecast week must be ordered',
      });
    }
    for (const [field, rows] of [
      ['drugs', data.drugs],
      ['patients', data.patients],
      ['unresolvedDrugs', data.unresolvedDrugs],
    ] as const) {
      const keys = rows.map((row) => ('key' in row ? row.key : row.drugIdentityKey));
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: 'custom',
          path: ['data', field],
          message: `${field} identities must be unique`,
        });
      }
    }
    const drugIds = new Set(data.drugs.map((drug) => drug.drugIdentityKey));
    for (const [patientIndex, patient] of data.patients.entries()) {
      for (const [detailIndex, detail] of patient.shortageDetails.entries()) {
        if (!drugIds.has(detail.drugIdentityKey)) {
          context.addIssue({
            code: 'custom',
            path: [
              'data',
              'patients',
              patientIndex,
              'shortageDetails',
              detailIndex,
              'drugIdentityKey',
            ],
            message: 'Patient shortage detail must reference a forecast drug',
          });
        }
      }
    }
  });

export type InventoryForecastResponse = z.infer<typeof inventoryForecastResponseSchema>;
