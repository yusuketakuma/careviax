import { describe, expect, it, vi } from 'vitest';
import type { HomeCareFeatureKey, HomeCareFeatureState } from '@/types/home-care';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import {
  HOME_CARE_FEATURE_DEFINITIONS,
  countHomeCareFacilityClusters,
  countHomeCareHolidayCoverageGaps,
  finalizeHomeCareFeatureSummary,
  selectScheduleHomeCareFeatureHighlights,
} from './home-care-ops';

function makeFeature(
  key: HomeCareFeatureKey,
  overrides: Partial<HomeCareFeatureState> = {},
): HomeCareFeatureState {
  const definition = HOME_CARE_FEATURE_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`definition not found: ${key}`);
  }

  return {
    ...definition,
    status: 'ready',
    severity: 'low',
    count: 0,
    summary: `${definition.title} summary`,
    evidence: [],
    ...overrides,
  };
}

describe('home-care-ops', () => {
  it('defines 20 unique visit support features', () => {
    const keys = HOME_CARE_FEATURE_DEFINITIONS.map((item) => item.key);
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
  });

  it('finalizes totals and sorts by severity then count', () => {
    const summary = finalizeHomeCareFeatureSummary([
      makeFeature('mobile_visit_mode', {
        status: 'attention',
        severity: 'high',
        count: 2,
      }),
      makeFeature('consent_plan_huddle', {
        status: 'blocked',
        severity: 'urgent',
        count: 1,
      }),
      makeFeature('regional_resource_map', {
        status: 'monitoring',
        severity: 'normal',
        count: 4,
      }),
      makeFeature('carry_item_fallback', {
        status: 'ready',
        severity: 'low',
        count: 0,
      }),
    ]);

    expect(summary.totals).toEqual({
      blocked: 1,
      attention: 1,
      monitoring: 1,
      ready: 1,
    });
    expect(summary.features.map((item) => item.key)).toEqual([
      'consent_plan_huddle',
      'mobile_visit_mode',
      'regional_resource_map',
      'carry_item_fallback',
    ]);
  });

  it('extracts schedule-facing highlights only', () => {
    const summary = finalizeHomeCareFeatureSummary(
      HOME_CARE_FEATURE_DEFINITIONS.map((definition) =>
        makeFeature(definition.key, {
          count: 1,
          status: 'attention',
          severity: 'high',
        }),
      ),
    );

    const keys = selectScheduleHomeCareFeatureHighlights(summary).map((item) => item.key);

    expect(keys).toHaveLength(8);
    expect(keys).toEqual(
      expect.arrayContaining([
        'billing_blocker_alert',
        'callback_sla_monitor',
        'carry_item_fallback',
        'change_delta_view',
        'consent_plan_huddle',
        'emergency_medication_playbook',
        'mobile_visit_mode',
        'previsit_preparation_pack',
      ]),
    );
  });

  it('counts facility clusters by local calendar date', () => {
    expect(
      countHomeCareFacilityClusters([
        {
          scheduled_date: new Date(2026, 2, 31, 0, 0, 0),
          case_: {
            patient: {
              residences: [{ building_id: 'facility_alpha', address: '施設A' }],
            },
          },
        },
        {
          scheduled_date: new Date(2026, 2, 31, 14, 0, 0),
          case_: {
            patient: {
              residences: [{ building_id: 'facility_alpha', address: '施設A' }],
            },
          },
        },
      ]),
    ).toBe(1);
  });

  it('counts holiday coverage gaps by local calendar date and site', () => {
    expect(
      countHomeCareHolidayCoverageGaps(
        [
          {
            date: new Date(2026, 4, 6, 0, 0, 0),
            site_id: 'site_1',
          },
        ],
        [
          {
            date: new Date(2026, 4, 6, 13, 0, 0),
            site_id: 'site_1',
          },
          {
            date: new Date(2026, 4, 6, 13, 0, 0),
            site_id: 'site_2',
          },
        ],
      ),
    ).toBe(1);
  });
});
