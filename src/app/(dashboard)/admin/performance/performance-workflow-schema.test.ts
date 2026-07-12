import { describe, expect, it } from 'vitest';
import { performanceWorkflowResponseSchema } from './performance-workflow-schema';

const WORKFLOW = {
  data: {
    route_control: {
      locked_schedules: 2,
      pending_override_requests: 1,
      emergency_impact_items: 1,
      provider_only: 'strip-me',
    },
    outcome_metrics: {
      completed_last_7_days: 3,
      disrupted_last_7_days: 1,
      urgent_completed_last_7_days: 1,
      awaiting_reports: 2,
      open_exceptions: 0,
    },
    workload_metrics: {
      pharmacists: [
        {
          pharmacist_id: 'user_1',
          pharmacist_name: '薬剤師A',
          confirmed_visits: 2,
          pending_tasks: 3,
          urgent_items: 1,
          callback_followups: 1,
          facility_clusters: 1,
          email: 'provider-only@example.invalid',
        },
      ],
    },
    patient_risk_queue: { high_risk_count: 1, items: [{ patient_id: 'provider-only' }] },
  },
};

describe('performanceWorkflowResponseSchema', () => {
  it('projects only performance workflow fields used by the page', () => {
    const parsed = performanceWorkflowResponseSchema.parse(WORKFLOW);

    expect(parsed.data).not.toHaveProperty('patient_risk_queue');
    expect(parsed.data.route_control).not.toHaveProperty('provider_only');
    expect(parsed.data.workload_metrics.pharmacists[0]).not.toHaveProperty('email');
  });

  it.each([
    ['legacy root', WORKFLOW.data],
    [
      'negative count',
      {
        data: {
          ...WORKFLOW.data,
          route_control: { ...WORKFLOW.data.route_control, locked_schedules: -1 },
        },
      },
    ],
    [
      'urgent completed count above completed count',
      {
        data: {
          ...WORKFLOW.data,
          outcome_metrics: {
            ...WORKFLOW.data.outcome_metrics,
            urgent_completed_last_7_days: 4,
          },
        },
      },
    ],
    [
      'callback count above pending task count',
      {
        data: {
          ...WORKFLOW.data,
          workload_metrics: {
            pharmacists: [
              {
                ...WORKFLOW.data.workload_metrics.pharmacists[0],
                callback_followups: 4,
              },
            ],
          },
        },
      },
    ],
    [
      'duplicate pharmacist identity',
      {
        data: {
          ...WORKFLOW.data,
          workload_metrics: {
            pharmacists: [
              WORKFLOW.data.workload_metrics.pharmacists[0],
              WORKFLOW.data.workload_metrics.pharmacists[0],
            ],
          },
        },
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(performanceWorkflowResponseSchema.safeParse(payload).success).toBe(false);
  });
});
