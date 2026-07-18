import { z } from 'zod';

import { CALENDAR_SLOT_KEYS } from '@/lib/dispensing/set-derivations';
import type { DispenseWorkbenchPhase } from '@/lib/dispensing/dispense-workbench-shared';

const idSchema = z.string().trim().min(1);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const nullableTextSchema = z.string().nullable();
const countSchema = z.number().int().nonnegative();
const phaseSchema = z.enum(['dispense', 'audit', 'set', 'set-audit']);

const patientRowSchema = z
  .object({
    patient_id: idSchema,
    cycle_id: idSchema.nullable(),
    name: z.string().trim().min(1),
    name_kana: z.string(),
    overall_status: z.string().trim().min(1).nullable(),
    badge: z.enum(['audited', 'in_progress', 'not_started']),
    start_date: dateKeySchema.nullable(),
    registered_date: dateKeySchema,
    latest_set_plan_id: idSchema.nullable(),
    latest_set_plan_cycle_id: idSchema.nullable(),
    representative_task_id: idSchema.nullable(),
    representative_task_status: z.string().trim().min(1).nullable(),
  })
  .strict();

export function buildDispenseWorkbenchPatientsResponseSchema(expected: {
  phase?: DispenseWorkbenchPhase;
  includeSetPlan?: boolean;
  limit?: number;
}) {
  return z
    .object({
      data: z.array(patientRowSchema),
      meta: z
        .object({
          generated_at: isoDateTimeSchema,
          limit: z.number().int().positive(),
          returned_count: countSchema,
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
          total_count: countSchema,
          count_basis: z
            .object({
              rows: z.literal('authorized_latest_cycle_per_patient'),
              total_count: z.literal('authorized_phase_search_exact'),
              phase_counts: z.literal('authorized_phase_search_exact'),
              set_split: z.literal('latest_set_plan_set_batch_exact'),
            })
            .strict(),
          filters_applied: z
            .object({
              phase: phaseSchema.nullable(),
              q_present: z.boolean(),
              sort: z.enum(['start_date', 'registered_date', 'name_kana']),
              order: z.enum(['asc', 'desc']),
              include_set_plan: z.boolean(),
            })
            .strict(),
          facets: z
            .object({
              total: countSchema,
              phase_counts: z
                .object({
                  dispense: countSchema,
                  audit: countSchema,
                  set: countSchema,
                  'set-audit': countSchema,
                })
                .strict(),
              other: countSchema,
            })
            .strict(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (meta.returned_count !== data.length) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'returned_count'],
          message: 'returned_count must match data length',
        });
      }
      if (meta.has_more !== Boolean(meta.next_cursor)) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'next_cursor'],
          message: 'next_cursor must match has_more',
        });
      }
      if (meta.filters_applied.phase !== (expected.phase ?? null)) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'filters_applied', 'phase'],
          message: 'phase mismatch',
        });
      }
      if (meta.filters_applied.include_set_plan !== Boolean(expected.includeSetPlan)) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'filters_applied', 'include_set_plan'],
          message: 'include_set_plan mismatch',
        });
      }
      if (expected.limit != null && meta.limit !== expected.limit) {
        context.addIssue({ code: 'custom', path: ['meta', 'limit'], message: 'limit mismatch' });
      }
    });
}

const comparisonRowSchema = z
  .object({
    key: idSchema,
    drug_name: z.string().trim().min(1),
    previous_label: nullableTextSchema,
    current_label: nullableTextSchema,
    change_type: z
      .enum(['added', 'removed', 'dose_changed', 'frequency_changed', 'days_changed'])
      .nullable(),
    direction: z.enum(['decrease', 'increase']).nullable(),
    inquiry_origin: z.boolean(),
  })
  .strict();

const countRowSchema = z
  .object({
    line_id: idSchema,
    result_id: idSchema.nullable(),
    line_number: countSchema.nullable(),
    drug_name: z.string().trim().min(1),
    drug_code: nullableTextSchema.optional(),
    prescribed_drug_name: nullableTextSchema.optional(),
    prescribed_drug_code: nullableTextSchema.optional(),
    actual_drug_name: nullableTextSchema.optional(),
    actual_drug_code: nullableTextSchema.optional(),
    dose: nullableTextSchema,
    frequency: z.string(),
    route: nullableTextSchema,
    tags: z.array(z.string()),
    is_narcotic: z.boolean(),
    is_generic: z.boolean(),
    prescribed_label: z.string(),
    prescribed_quantity: z.number().nonnegative().nullable(),
    start_date: dateKeySchema.nullable(),
    end_date: dateKeySchema.nullable(),
    days: z.number().int().positive().nullable(),
    line_updated_at: isoDateTimeSchema,
    dispensed_label: nullableTextSchema,
    dispensed_at: isoDateTimeSchema.nullable(),
    dispensed_quantity: z.number().nonnegative().nullable(),
    discrepancy_reason: nullableTextSchema,
    unit: z.string(),
    dispensing_method: nullableTextSchema,
    packaging_method: nullableTextSchema,
    packaging_instructions: nullableTextSchema,
    packaging_group_id: idSchema.nullable(),
  })
  .strict();

export function buildDispenseTaskWorkbenchResponseSchema(expected: {
  taskId: string;
  patientId: string;
}) {
  return z
    .object({
      data: z
        .object({
          task: z
            .object({
              id: z.literal(expected.taskId),
              status: idSchema,
              priority: idSchema,
              due_date: isoDateTimeSchema.nullable(),
            })
            .strict(),
          cycle: z
            .object({ id: idSchema, overall_status: idSchema, version: countSchema })
            .strict(),
          patient: z
            .object({ id: z.literal(expected.patientId), name: z.string().trim().min(1) })
            .strict(),
          intake: z
            .object({
              id: idSchema,
              prescribed_date: dateKeySchema,
              prescriber_institution: nullableTextSchema,
              prescriber_name: nullableTextSchema,
            })
            .strict()
            .nullable(),
          previous_intake: z.object({ prescribed_date: dateKeySchema }).strict().nullable(),
          safety: z
            .object({
              allergy: nullableTextSchema,
              renal: nullableTextSchema,
              handling_tags: z.array(z.string()),
              swallowing: nullableTextSchema,
              cautions: z.array(z.string()),
            })
            .strict(),
          comparison: z.array(comparisonRowSchema),
          count_rows: z.array(countRowSchema),
          packaging_groups: z
            .array(
              z
                .object({
                  id: idSchema,
                  label: z.string().trim().min(1),
                  method: idSchema,
                  slot: nullableTextSchema,
                  sort_order: countSchema,
                  version: countSchema,
                })
                .strict(),
            )
            .optional(),
          dispenser: z
            .object({
              id: idSchema,
              name: z.string().trim().min(1),
              time_label: nullableTextSchema,
            })
            .strict()
            .nullable(),
          auditor: z
            .object({ id: idSchema, name: z.string().trim().min(1) })
            .strict()
            .nullable(),
          is_self_audit: z.boolean(),
          has_narcotic: z.boolean(),
          visit_time_label: nullableTextSchema,
          resolved_inquiry: z
            .object({
              inquired_at: isoDateTimeSchema,
              resolved_at: isoDateTimeSchema.nullable(),
              institution: nullableTextSchema,
              change_detail: nullableTextSchema,
            })
            .strict()
            .nullable(),
          team_audit_total: countSchema,
          stock_check_date_label: nullableTextSchema,
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.has_narcotic !== data.count_rows.some((row) => row.is_narcotic)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'has_narcotic'],
          message: 'narcotic mismatch',
        });
      }
      if (data.is_self_audit && !data.dispenser) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'is_self_audit'],
          message: 'dispenser required',
        });
      }
    });
}

const calendarCellSchema = z
  .object({
    batch_id: idSchema.nullable(),
    state: z.enum(['empty', 'pending', 'set', 'hold', 'ok', 'ng']),
    quantity: z.number().nonnegative().nullable(),
    carry_type: nullableTextSchema,
    set_state: nullableTextSchema,
    audit_state: nullableTextSchema,
    ng_code: nullableTextSchema,
    held_reason: nullableTextSchema,
    version: countSchema.nullable(),
  })
  .strict();

const calendarCellsSchema = z
  .object({
    morning: calendarCellSchema,
    noon: calendarCellSchema,
    evening: calendarCellSchema,
    bedtime: calendarCellSchema,
    prn: calendarCellSchema,
  })
  .strict();

export function buildSetPlanCalendarResponseSchema(expectedPlanId: string) {
  return z
    .object({
      data: z
        .object({
          plan_id: z.literal(expectedPlanId),
          cycle_id: idSchema,
          cycle_version: countSchema,
          cycle_status: idSchema,
          set_method: idSchema,
          generation: z
            .object({
              batch_count: countSchema,
              needs_initial_generation: z.boolean(),
              latest_batch_updated_at: isoDateTimeSchema.nullable(),
              expected_updated_at: isoDateTimeSchema,
              can_generate: z.boolean(),
              can_force_regenerate: z.boolean(),
            })
            .strict()
            .optional(),
          narcotic_classification: z
            .object({
              unresolved_line_count: countSchema,
              status: z.enum(['normal', 'needs_review']),
            })
            .strict()
            .optional(),
          period_start: dateKeySchema,
          period_end: dateKeySchema,
          day_count: z.number().int().positive(),
          slots: z.array(z.enum(CALENDAR_SLOT_KEYS)).length(CALENDAR_SLOT_KEYS.length),
          rows: z.array(
            z
              .object({
                line: z
                  .object({
                    id: idSchema,
                    drug_name: z.string().trim().min(1),
                    dosage_form: nullableTextSchema.optional(),
                    dose: nullableTextSchema,
                    frequency: z.string(),
                    unit: nullableTextSchema,
                    route: nullableTextSchema.optional(),
                    packaging_instructions: nullableTextSchema.optional(),
                    packaging_instruction_tags: z.array(z.string()).optional(),
                    notes: nullableTextSchema.optional(),
                  })
                  .strict(),
                days: z.array(
                  z
                    .object({
                      day_number: z.number().int().positive(),
                      date: dateKeySchema,
                      cells: calendarCellsSchema,
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
          completion_gate: z
            .object({
              total_cells: countSchema,
              set_cells: countSchema,
              pending_cells: countSchema,
              hold_cells: countSchema,
              audited_ok_cells: countSchema,
              audited_ng_cells: countSchema,
              unaudited_cells: countSchema,
              set_complete: z.boolean(),
              audit_complete: z.boolean(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (new Set(data.slots).size !== CALENDAR_SLOT_KEYS.length) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'slots'],
          message: 'slots must be unique',
        });
      }
      data.rows.forEach((row, rowIndex) => {
        if (row.days.length !== data.day_count) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'rows', rowIndex, 'days'],
            message: 'day count mismatch',
          });
        }
      });
      if (
        data.narcotic_classification &&
        (data.narcotic_classification.status === 'normal') !==
          (data.narcotic_classification.unresolved_line_count === 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'narcotic_classification', 'status'],
          message: 'classification mismatch',
        });
      }
    });
}

const dataEnvelope = <T extends z.ZodType>(data: T) => z.object({ data }).strict();

const setBatchSchema = z
  .object({
    id: idSchema,
    line_id: idSchema,
    set_state: idSchema,
    audit_state: idSchema,
    version: countSchema,
    day_number: z.number().int().positive(),
    slot: idSchema,
  })
  .passthrough();

export function buildCreatePackagingGroupResponseSchema(expected: {
  label: string;
  method: string;
}) {
  return dataEnvelope(
    z
      .object({
        id: idSchema,
        label: z.literal(expected.label),
        method: z.literal(expected.method),
        version: countSchema,
        created: z.boolean(),
      })
      .passthrough(),
  ).transform(({ data }) => ({ data: { id: data.id, version: data.version } }));
}

export function buildUpdatePackagingGroupsResponseSchema(
  expected: Array<{ id: string; version: number }>,
) {
  return dataEnvelope(
    z
      .object({
        updated: z.array(z.object({ id: idSchema, version: countSchema }).strict()),
      })
      .strict(),
  ).superRefine(({ data }, context) => {
    const expectedVersions = new Map(expected.map((item) => [item.id, item.version + 1]));
    if (
      data.updated.length !== expected.length ||
      data.updated.some((item) => expectedVersions.get(item.id) !== item.version)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'updated'],
        message: 'updated groups mismatch',
      });
    }
  });
}

export function buildAssignPackagingLinesResponseSchema(expectedLineIds: string[]) {
  return dataEnvelope(
    z.object({ assigned: z.array(z.object({ line_id: idSchema }).strict()) }).strict(),
  ).superRefine(({ data }, context) => {
    if (
      data.assigned.length !== expectedLineIds.length ||
      data.assigned.some((item, index) => item.line_id !== expectedLineIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'assigned'],
        message: 'assigned lines mismatch',
      });
    }
  });
}

export function buildPrescriptionLineMutationResponseSchema(expectedLineId: string) {
  return dataEnvelope(z.object({ id: z.literal(expectedLineId) }).passthrough());
}

export function buildPrescriptionLinesMutationResponseSchema(expectedLineIds: string[]) {
  return dataEnvelope(
    z.object({ updated: z.array(z.object({ id: idSchema }).passthrough()) }).strict(),
  ).superRefine(({ data }, context) => {
    if (
      data.updated.length !== expectedLineIds.length ||
      data.updated.some((item, index) => item.id !== expectedLineIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'updated'],
        message: 'updated lines mismatch',
      });
    }
  });
}

export function buildDispenseResultsMutationResponseSchema(expectedTaskId: string) {
  return dataEnvelope(
    z
      .object({
        task_id: z.literal(expectedTaskId),
        partial: z.boolean(),
        idempotent: z.boolean().optional(),
        results: z.array(z.unknown()),
      })
      .strict(),
  );
}

export function buildVerifyDispenseBarcodeResponseSchema(expectedDrugName?: string) {
  return dataEnvelope(
    z
      .object({
        match: z.boolean(),
        decoded: z
          .object({
            gtin: z.string().optional(),
            expiryDate: z.string().optional(),
            lotNumber: z.string().optional(),
          })
          .strict(),
        expected: z
          .object({
            drug_code: nullableTextSchema,
            drug_name: expectedDrugName ? z.literal(expectedDrugName) : z.string().trim().min(1),
          })
          .strict(),
        warnings: z.array(z.string()),
      })
      .strict(),
  );
}

export function buildDispenseAuditMutationResponseSchema(expectedTaskId: string) {
  return dataEnvelope(
    z
      .object({
        id: idSchema,
        task_id: z.literal(expectedTaskId).optional(),
        result: idSchema,
        idempotent: z.boolean().optional(),
      })
      .passthrough(),
  );
}

export function buildSetBatchCellMutationResponseSchema(expectedBatchIds: string[]) {
  const dataSchema = z.union([
    setBatchSchema,
    z.object({ batches: z.array(setBatchSchema) }).strict(),
  ]);
  return dataEnvelope(dataSchema).superRefine(({ data }, context) => {
    const nestedBatches = (data as { batches?: unknown }).batches;
    const batches = Array.isArray(nestedBatches) ? nestedBatches : [data];
    if (
      batches.length !== expectedBatchIds.length ||
      batches.some((batch) => !expectedBatchIds.includes(batch.id))
    ) {
      context.addIssue({ code: 'custom', path: ['data'], message: 'mutated batches mismatch' });
    }
  });
}

export function buildSetBatchCollectionMutationResponseSchema(options: {
  expectedBatchIds?: string[];
  requireCountMatch?: boolean;
}) {
  return dataEnvelope(
    z
      .object({
        count: countSchema,
        batches: z.array(setBatchSchema),
      })
      .strict(),
  ).superRefine(({ data }, context) => {
    if (options.requireCountMatch && data.count !== data.batches.length) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'count'],
        message: 'batch count mismatch',
      });
    }
    if (
      options.expectedBatchIds &&
      data.batches.some((batch) => !options.expectedBatchIds?.includes(batch.id))
    ) {
      context.addIssue({ code: 'custom', path: ['data', 'batches'], message: 'unexpected batch' });
    }
  });
}

export function buildGenerateSetBatchesResponseSchema() {
  return dataEnvelope(
    z
      .object({
        count: countSchema,
        batches: z.array(setBatchSchema),
        reused: z.boolean(),
      })
      .strict(),
  );
}

export function buildSetAuditMutationResponseSchema(expectedPlanId: string) {
  return dataEnvelope(
    z
      .object({
        id: idSchema,
        plan_id: z.literal(expectedPlanId).optional(),
        result: idSchema,
        idempotent: z.boolean().optional(),
      })
      .passthrough(),
  );
}

export function buildCreateCycleHoldResponseSchema(expectedCycleId: string) {
  return dataEnvelope(
    z.object({ id: idSchema, cycle_id: z.literal(expectedCycleId) }).passthrough(),
  ).transform(({ data }) => ({ data: { id: data.id } }));
}

export function buildResolveCycleHoldResponseSchema(expectedHoldId: string) {
  return dataEnvelope(
    z.object({ id: z.literal(expectedHoldId), resolved: z.literal(true) }).strict(),
  );
}
