import { describe, expect, it } from 'vitest';
import {
  buildInterventionListResponseSchema,
  buildInterventionResponseSchema,
} from './response-schema';

function buildIntervention(id = 'intervention_2') {
  return {
    id,
    org_id: 'org_1',
    patient_id: 'patient_1',
    issue_id: 'issue_1',
    type: 'dose_adjustment',
    description: '用量を調整',
    outcome: null,
    performed_by: 'user_1',
    performed_at: '2026-07-12T01:00:00.000Z',
    created_at: '2026-07-12T01:05:00.000Z',
    updated_at: '2026-07-12T01:05:00.000Z',
  };
}

describe('intervention response schemas', () => {
  it('strips provider-only fields from a scoped intervention', () => {
    const result = buildInterventionResponseSchema({
      patientId: 'patient_1',
      issueId: 'issue_1',
    }).parse({ data: buildIntervention() });

    expect(result.data).not.toHaveProperty('org_id');
    expect(result.data).not.toHaveProperty('updated_at');
  });

  it.each([
    ['another patient', { patient_id: 'patient_2' }],
    ['another issue', { issue_id: 'issue_2' }],
    ['creation before performance', { created_at: '2026-07-11T23:00:00.000Z' }],
  ])('rejects %s in a created intervention', (_label, override) => {
    expect(
      buildInterventionResponseSchema({ patientId: 'patient_1', issueId: 'issue_1' }).safeParse({
        data: { ...buildIntervention(), ...override },
      }).success,
    ).toBe(false);
  });

  it('accepts a complete, newest-first list', () => {
    const older = {
      ...buildIntervention('intervention_1'),
      performed_at: '2026-07-11T01:00:00.000Z',
      created_at: '2026-07-11T01:05:00.000Z',
    };
    expect(
      buildInterventionListResponseSchema({ patientId: 'patient_1', issueId: 'issue_1' }).parse({
        data: [buildIntervention(), older],
        meta: { limit: 50, has_more: false, next_cursor: null },
      }).data,
    ).toHaveLength(2);
  });

  it.each([
    ['cross-patient item', [{ ...buildIntervention(), patient_id: 'patient_2' }]],
    ['duplicate identity', [buildIntervention(), buildIntervention()]],
    [
      'reverse ordering',
      [
        { ...buildIntervention('intervention_1'), performed_at: '2026-07-11T01:00:00.000Z' },
        buildIntervention('intervention_2'),
      ],
    ],
  ])('rejects a list with %s', (_label, data) => {
    expect(
      buildInterventionListResponseSchema({ patientId: 'patient_1', issueId: 'issue_1' }).safeParse(
        {
          data,
          meta: { limit: 50, has_more: false, next_cursor: null },
        },
      ).success,
    ).toBe(false);
  });

  it('rejects a silently truncated list', () => {
    expect(
      buildInterventionListResponseSchema({ patientId: 'patient_1' }).safeParse({
        data: [],
        meta: { limit: 50, has_more: true, next_cursor: 'intervention_50' },
      }).success,
    ).toBe(false);
  });
});
