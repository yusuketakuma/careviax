import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeCareFeatureKey, HomeCareFeatureState } from '@/types/home-care';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const listBillingEvidenceBlockersMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

import {
  HOME_CARE_FEATURE_DEFINITIONS,
  countHomeCareFacilityClusters,
  countHomeCareHolidayCoverageGaps,
  finalizeHomeCareFeatureSummary,
  getPatientHomeCareFeatureSummary,
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

function makePatientSummaryDb(patientId: string) {
  return {
    careCase: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'case_1',
          patient_id: patientId,
          management_plans: [{ id: 'plan_1', next_review_date: null }],
          patient: {
            contacts: [{ relation: 'facility_staff', is_emergency_contact: false }],
            medication_profiles: [],
          },
        },
      ]),
    },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
    medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
    inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
    visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
    communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
    externalAccessGrant: { findMany: vi.fn().mockResolvedValue([{ id: 'grant_1' }]) },
    consentRecord: { findMany: vi.fn().mockResolvedValue([{ id: 'consent_1' }]) },
    firstVisitDocument: { findMany: vi.fn().mockResolvedValue([{ id: 'first_visit_doc_1' }]) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listBillingEvidenceBlockersMock.mockResolvedValue([]);
});

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

  it('surfaces patient billing evidence blockers in the home-care billing alert', async () => {
    listBillingEvidenceBlockersMock.mockResolvedValue([
      {
        id: 'billing_evidence_1',
        visit_record_id: 'visit_record_1',
        validation_notes: null,
        blockers: [
          {
            key: 'missing_management_plan',
            reason: '管理計画書が未確認です',
            action_label: '計画書を確認',
            severity: 'high',
          },
        ],
      },
    ]);
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case_1',
            patient_id: 'patient_1',
            management_plans: [{ id: 'plan_1', next_review_date: null }],
            patient: {
              contacts: [{ relation: 'facility_staff', is_emergency_contact: false }],
              medication_profiles: [],
            },
          },
        ]),
      },
      task: {
        findMany: vi.fn().mockResolvedValue([{ task_type: 'billing_evidence_review' }]),
      },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([{ id: 'grant_1' }]) },
      consentRecord: { findMany: vi.fn().mockResolvedValue([{ id: 'consent_1' }]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([{ id: 'first_visit_doc_1' }]) },
    };

    const summary = await getPatientHomeCareFeatureSummary(
      db as unknown as Parameters<typeof getPatientHomeCareFeatureSummary>[0],
      { orgId: 'org_1', patientId: 'patient_1' },
    );

    const billingAlert = summary.features.find(
      (feature) => feature.key === 'billing_blocker_alert',
    );
    expect(billingAlert).toMatchObject({
      count: 2,
      status: 'attention',
      summary: '算定前レビューが必要です。',
    });
    expect(billingAlert?.evidence).toEqual([
      '算定根拠不足 1件',
      '管理計画書が未確認です',
      'レビュー 1件',
    ]);
    expect(listBillingEvidenceBlockersMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      limit: 4,
    });
  });

  it('focuses patient multidisciplinary share actions on patient communication requests', async () => {
    const patientId = 'patient 1/../x?y=#frag';
    const db = makePatientSummaryDb(patientId);
    db.communicationRequest.findMany.mockResolvedValue([{ id: 'request_1' }]);

    const summary = await getPatientHomeCareFeatureSummary(
      db as unknown as Parameters<typeof getPatientHomeCareFeatureSummary>[0],
      { orgId: 'org_1', patientId },
    );

    const feature = summary.features.find((item) => item.key === 'multidisciplinary_share_summary');
    expect(feature).toMatchObject({
      count: 1,
      action_href: '/communications/requests?patient_id=patient+1%2F..%2Fx%3Fy%3D%23frag',
      action_label: '連携依頼を確認',
    });
  });

  it('focuses patient multidisciplinary share actions on a single stalled report', async () => {
    const patientId = 'patient_1';
    const reportId = 'report/1?x=y#frag';
    const db = makePatientSummaryDb(patientId);
    db.careReport.findMany.mockResolvedValue([{ id: reportId }]);

    const summary = await getPatientHomeCareFeatureSummary(
      db as unknown as Parameters<typeof getPatientHomeCareFeatureSummary>[0],
      { orgId: 'org_1', patientId },
    );

    const feature = summary.features.find((item) => item.key === 'multidisciplinary_share_summary');
    expect(feature).toMatchObject({
      count: 1,
      action_href: `/reports/${encodeURIComponent(reportId)}`,
      action_label: '報告書を確認',
    });
  });
});
