import { describe, expect, it } from 'vitest';
import {
  buildVisitBillingCandidatesResponseSchema,
  buildVisitPreparationDetailResponseSchema,
  buildVisitRecordDetailResponseSchema,
  buildVisitResidualMedicationsResponseSchema,
  visitScheduleCreateResponseSchema,
} from './visit-record-detail-response-schemas';

function buildResponse(recordId = 'record_1') {
  return {
    data: {
      id: recordId,
      org_id: 'org_1',
      display_id: 'vr0000000001',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_1',
      visit_date: '2026-07-13T00:00:00.000Z',
      visit_started_at: null,
      visit_ended_at: null,
      outcome_status: 'completed',
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      structured_soap: {},
      receipt_person_name: null,
      receipt_person_relation: null,
      receipt_at: null,
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      attachments: [],
      version: 1,
      created_at: '2026-07-13T00:00:00.000Z',
      updated_at: '2026-07-13T00:00:00.000Z',
      schedule: {
        id: 'schedule_1',
        case_id: 'case_1',
        site_id: null,
        pharmacist_id: 'user_1',
        visit_type: 'home_visit',
        scheduled_date: '2026-07-13T00:00:00.000Z',
        recurrence_rule: null,
        time_window_start: null,
        time_window_end: null,
        case_: { primary_pharmacist_id: 'user_1', backup_pharmacist_id: null },
      },
      pharmacist_name: '薬剤師A',
      last_modified_by_id: 'user_1',
      last_modified_by_name: '薬剤師A',
      baseline_context: null,
    },
  };
}

describe('visit record detail response schema', () => {
  it('validates the provider row and strips server-only fields', () => {
    const parsed = buildVisitRecordDetailResponseSchema('record_1').safeParse(buildResponse());
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('visit record response should parse');
    expect(parsed.data.data).not.toHaveProperty('org_id');
    expect(parsed.data.data).not.toHaveProperty('display_id');
    expect(parsed.data.data).not.toHaveProperty('baseline_context');
    expect(parsed.data.data.schedule).not.toHaveProperty('case_');
  });

  it('rejects cross-record and cross-schedule responses', () => {
    expect(
      buildVisitRecordDetailResponseSchema('record_1').safeParse(buildResponse('record_2')).success,
    ).toBe(false);
    const response = buildResponse();
    response.data.schedule.id = 'schedule_2';
    expect(buildVisitRecordDetailResponseSchema('record_1').safeParse(response).success).toBe(
      false,
    );
  });

  it('validates schedule creation and strips assignment metadata', () => {
    const parsed = visitScheduleCreateResponseSchema.safeParse({
      data: { id: 'schedule_2', assignment_mode: 'primary' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('schedule response should parse');
    expect(parsed.data).toEqual({ data: { id: 'schedule_2' } });
  });

  it('validates patient-scoped billing candidates and cursor metadata', () => {
    const response = {
      data: [
        {
          id: 'candidate_1',
          patient_id: 'patient_1',
          status: 'candidate',
          billing_name: '在宅患者訪問薬剤管理指導料',
        },
      ],
      meta: {
        limit: 20,
        has_more: false,
        next_cursor: null,
        summary: {
          total: 1,
          pending_review: 1,
          confirmed: 0,
          excluded: 0,
          exported: 0,
          unresolved: 1,
          ready_to_close: 0,
          blocked_from_close: 1,
          blocker_reasons: [],
        },
      },
    };
    const parsed = buildVisitBillingCandidatesResponseSchema('patient_1').safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('billing response should parse');
    expect(parsed.data.data).toEqual([
      { id: 'candidate_1', patient_id: 'patient_1', status: 'candidate' },
    ]);
    response.data[0]!.patient_id = 'patient_2';
    expect(buildVisitBillingCandidatesResponseSchema('patient_1').safeParse(response).success).toBe(
      false,
    );
  });

  it('validates visit-scoped residuals and strips unused provider fields', () => {
    const response = {
      data: [
        {
          id: 'residual_1',
          visit_record_id: 'record_1',
          drug_name: '薬剤A',
          drug_code: null,
          prescribed_quantity: 28,
          remaining_quantity: 4,
          remaining_days: 4,
          excess_days: 4,
          is_prohibited_reduction: false,
          is_reduction_target: true,
          created_at: '2026-07-13T00:00:00.000Z',
        },
      ],
    };
    const parsed = buildVisitResidualMedicationsResponseSchema('record_1').safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('residual response should parse');
    expect(parsed.data.data[0]).not.toHaveProperty('visit_record_id');
    response.data[0]!.visit_record_id = 'record_2';
    expect(
      buildVisitResidualMedicationsResponseSchema('record_1').safeParse(response).success,
    ).toBe(false);
  });

  it('projects the visit preparation fields consumed by detail readiness', () => {
    const parsed = buildVisitPreparationDetailResponseSchema('schedule_1').safeParse({
      data: {
        pack: {
          care_team: [],
          billing_blockers: [],
          conference_context: [],
          intake_context: { initial_transition_management_expected: null, provider_only: true },
          facility_parallel_context: {
            current_schedule_id: 'schedule_1',
            provider_only: 'removed',
          },
          medication_period: { provider_only: true },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('visit preparation response should parse');
    expect(parsed.data.data.pack).not.toHaveProperty('medication_period');
    expect(parsed.data.data.pack).not.toHaveProperty('facility_parallel_context');
  });
});
