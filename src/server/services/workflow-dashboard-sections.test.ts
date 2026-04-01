import { describe, expect, it } from 'vitest';
import {
  buildFacilityVisibility,
  buildRemediationGuidance,
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
});
