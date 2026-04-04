import { describe, expect, it } from 'vitest';
import {
  buildFacilityVisibility,
  buildRemediationGuidance,
  buildUnifiedWorkbench,
} from './workflow-dashboard-sections';

describe('workflow-dashboard-sections', () => {
  it('groups multi-patient facility visits into visibility clusters', () => {
    const result = buildFacilityVisibility(
      [
        {
          id: 'schedule_1',
          scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
          site: { id: 'site_1', name: '本店' },
          pharmacist_id: 'user_1',
          route_order: 1,
          case_: {
            patient: {
              name: '患者A',
              residences: [{ building_id: 'facility_alpha', address: '施設A' }],
            },
          },
        },
        {
          id: 'schedule_2',
          scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
          site: { id: 'site_1', name: '本店' },
          pharmacist_id: 'user_1',
          route_order: 3,
          case_: {
            patient: {
              name: '患者B',
              residences: [{ building_id: 'facility_alpha', address: '施設A' }],
            },
          },
        },
      ] as never,
      new Map([['user_1', '佐藤 薬剤師']])
    );

    expect(result.clusters).toMatchObject([
      {
        label: 'facility_alpha',
        pharmacist_name: '佐藤 薬剤師',
        patient_count: 2,
        route_window: '1-3',
      },
    ]);
  });

  it('builds remediation cards for missing workflow gates and self reports', () => {
    expect(
      buildRemediationGuidance(
        2,
        1,
        5,
        6,
        {
          management_plan_review: 3,
          visit_intake_linkage: 1,
        },
        4
      )
    ).toMatchObject([
      expect.objectContaining({ id: 'missing_visit_consent', count: 2 }),
      expect.objectContaining({ id: 'missing_management_plan', count: 1 }),
      expect.objectContaining({ id: 'management_plan_review_overdue', count: 3 }),
      expect.objectContaining({ id: 'missing_first_visit_doc', count: 5 }),
      expect.objectContaining({ id: 'missing_emergency_contact', count: 6 }),
      expect.objectContaining({ id: 'visit_intake_linkage', count: 1 }),
      expect.objectContaining({ id: 'self_report_triage', count: 4 }),
    ]);
  });

  it('includes cadence summary in visit workbench items when preview is available', () => {
    const result = buildUnifiedWorkbench(
      [],
      [],
      [
        {
          id: 'schedule_1',
          case_id: 'case_1',
          scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          confirmed_at: null,
          schedule_status: 'planned',
          priority: 'normal',
          pharmacist_id: 'user_1',
          assignment_mode: 'primary',
          carry_items_status: null,
          route_order: null,
          escalation_reason: null,
          preparation: {
            medication_changes_reviewed: false,
            carry_items_confirmed: false,
            previous_issues_reviewed: false,
            route_confirmed: false,
            offline_synced: false,
            prepared_at: null,
          },
          override_request: null,
          applied_override: null,
          case_: {
            patient: {
              id: 'patient_1',
              name: '患者A',
              residences: [{ address: '東京都港区1-1-1', building_id: null }],
            },
          },
          site: null,
          cadence_preview: {
            next_billable_date: '2026-04-17',
            remaining_month_count: 1,
            warning_messages: ['月上限に近いです'],
          },
        },
      ] as never,
      [],
      0,
      [],
      { summary: { unconfirmed_count: 0 }, items: [] } as never,
      new Map([['user_1', '薬剤師A']]),
      new Map([['patient_1', '患者A']]),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'visit:schedule_1',
          summary: expect.stringContaining('次回算定可 2026-04-17'),
        }),
      ]),
    );
  });
});
