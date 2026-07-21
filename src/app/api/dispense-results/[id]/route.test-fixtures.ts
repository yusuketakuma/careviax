import { NextRequest } from 'next/server';

export function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function createMalformedJsonPatchRequest(id = 'result_1') {
  return new NextRequest(`http://localhost/api/dispense-results/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"actual_drug_name":',
  });
}

export function createExistingDispenseResult(
  overrides: Partial<{
    actual_drug_name: string;
    actual_drug_code: string | null;
    actual_quantity: number;
    actual_unit: string | null;
    discrepancy_reason: string | null;
    carry_type: string;
    prescribed_drug_name: string;
    prescribed_drug_code: string | null;
    prescribed_quantity: number | null;
    prescribed_unit: string | null;
  }> = {},
) {
  return {
    id: 'result_1',
    org_id: 'org_1',
    task_id: 'task_1',
    line_id: 'line_1',
    actual_drug_name: overrides.actual_drug_name ?? 'Drug B',
    actual_drug_code: overrides.actual_drug_code ?? 'drug-b',
    actual_quantity: overrides.actual_quantity ?? 14,
    actual_unit: overrides.actual_unit ?? '錠',
    discrepancy_reason: overrides.discrepancy_reason ?? null,
    carry_type: overrides.carry_type ?? 'carry',
    version: 1,
    line: {
      id: 'line_1',
      drug_name: overrides.prescribed_drug_name ?? 'Drug B',
      drug_code: overrides.prescribed_drug_code ?? 'drug-b',
      quantity: overrides.prescribed_quantity ?? 14,
      unit: overrides.prescribed_unit ?? '錠',
    },
  };
}

export const defaultDispenseResultList = [
  {
    line_id: 'line_1',
    actual_drug_name: 'Drug B',
    actual_drug_code: 'drug-b',
    actual_quantity: 14,
    actual_unit: '錠',
    carry_type: 'carry',
    special_notes: '再調剤',
    line: {
      drug_name: 'Drug B',
      drug_code: 'drug-b',
    },
  },
];

export const defaultMedicationCycle = {
  id: 'cycle_1',
  overall_status: 'dispensing',
  version: 1,
};

// Pharmacists have organization-wide access, so no assignment predicate is added.
export const expectedResultAssignmentWhere = {};

export function createDispenseTransactionClient(mocks: Record<string, unknown>) {
  return {
    dispenseResult: {
      findFirst: mocks.dispenseResultFindFirst,
      findMany: mocks.dispenseResultFindMany,
      update: mocks.dispenseResultUpdate,
      updateMany: mocks.dispenseResultUpdateMany,
    },
    dispenseAudit: { findFirst: mocks.dispenseAuditFindFirst },
    dispenseTask: { update: mocks.dispenseTaskUpdate },
    visitSchedule: {
      findMany: mocks.visitScheduleFindMany,
      update: mocks.visitScheduleUpdate,
    },
    visitPreparation: { updateMany: mocks.visitPreparationUpdateMany },
    medicationCycle: {
      findFirst: mocks.medicationCycleFindFirst,
      findFirstOrThrow: mocks.medicationCycleFindFirstOrThrow,
      updateMany: mocks.medicationCycleUpdateMany,
    },
    cycleTransitionLog: { create: mocks.cycleTransitionLogCreate },
  };
}
