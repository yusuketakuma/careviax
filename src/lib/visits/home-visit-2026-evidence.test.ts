import { describe, expect, it } from 'vitest';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  buildHomeVisit2026ReadinessItems,
  getHomeVisit2026BillingEligibility,
  summarizeHomeVisit2026Evidence,
} from './home-visit-2026-evidence';

function makeStructuredSoap(overrides: Partial<StructuredSoap> = {}): StructuredSoap {
  return {
    subjective: {
      symptom_checks: [],
      ...overrides.subjective,
    },
    objective: {
      medication_status: 'managed_by_family',
      adherence_score: 3,
      side_effect_checks: [],
      ...overrides.objective,
    },
    assessment: {
      problem_checks: [],
      ...overrides.assessment,
    },
    plan: {
      intervention_checks: [],
      ...overrides.plan,
    },
    ...(overrides.residual_medications
      ? { residual_medications: overrides.residual_medications }
      : {}),
    ...(overrides.home_visit_2026 ? { home_visit_2026: overrides.home_visit_2026 } : {}),
  };
}

describe('home visit 2026 evidence helpers', () => {
  it('marks the new 2026 billing add-ons eligible only when required evidence is complete', () => {
    const soap = makeStructuredSoap({
      home_visit_2026: {
        physician_simultaneous: {
          performed: true,
          patient_consent: true,
          physician_name: '山田医師',
          medication_adjustment_discussed: true,
          discussion_summary: '残薬と眠気の評価を踏まえて用量調整を相談',
          same_day_exclusion_checked: true,
        },
        multi_staff_visit: {
          performed: true,
          patient_consent: true,
          physician_need_confirmed: true,
          safety_reason: 'severe_anxiety',
          companion_name: '佐藤薬剤師',
          necessity_summary: '強い不安で単独訪問では服薬確認が中断しやすい',
        },
        initial_transition_management: {
          target: true,
          pre_visit_environment_assessed: true,
          medication_risk_assessed: true,
          transition_support_summary: '退院直後の服薬支援者と残薬保管場所を確認',
        },
      },
    });

    expect(getHomeVisit2026BillingEligibility(soap)).toEqual({
      physicianSimultaneousEligible: true,
      multiStaffVisitEligible: true,
      initialTransitionEligible: true,
    });

    expect(
      getHomeVisit2026BillingEligibility(
        makeStructuredSoap({
          home_visit_2026: {
            physician_simultaneous: {
              performed: true,
              patient_consent: true,
              physician_name: '山田医師',
              medication_adjustment_discussed: true,
              discussion_summary: '',
              same_day_exclusion_checked: true,
            },
          },
        }),
      ).physicianSimultaneousEligible,
    ).toBe(false);
  });

  it('builds visit-time readiness items from SOAP evidence, visit type, and billing blockers', () => {
    const items = buildHomeVisit2026ReadinessItems({
      structuredSoap: makeStructuredSoap({
        objective: {
          medication_status: 'managed_by_family',
          adherence_score: 4,
          side_effect_checks: ['drowsiness'],
        },
        assessment: {
          problem_checks: ['interaction_risk'],
        },
        plan: {
          intervention_checks: ['physician_report'],
        },
        home_visit_2026: {
          medication_review_completed: true,
          residual_medication_checked: true,
          adverse_event_checked: true,
          after_hours_contact_confirmed: true,
        },
      }),
      visitType: 'initial',
      billingBlockers: [
        {
          key: 'missing_management_plan',
          reason: '承認済み管理計画書がありません',
          severity: 'urgent',
        },
      ],
    });

    expect(items.find((item) => item.key === 'medication_review')?.done).toBe(true);
    expect(items.find((item) => item.key === 'initial_transition_environment')).toMatchObject({
      required: true,
      done: false,
    });
    expect(
      items.find((item) => item.key === 'billing_blocker:missing_management_plan'),
    ).toMatchObject({
      required: true,
      done: false,
      severity: 'urgent',
    });
  });

  it('honors an explicit initial transition opt-out even when the visit type suggests it', () => {
    const items = buildHomeVisit2026ReadinessItems({
      structuredSoap: makeStructuredSoap({
        home_visit_2026: {
          initial_transition_management: {
            target: false,
          },
        },
      }),
      visitType: 'initial',
      intakeInitialTransitionExpected: true,
    });

    expect(items.some((item) => item.key.startsWith('initial_transition_'))).toBe(false);
  });

  it('summarizes completed 2026 evidence for reports and SOAP plan text', () => {
    const summary = summarizeHomeVisit2026Evidence(
      makeStructuredSoap({
        home_visit_2026: {
          medication_review_completed: true,
          residual_medication_checked: true,
          physician_simultaneous: {
            performed: true,
            physician_name: '山田医師',
            discussion_summary: '残薬調整を協議',
          },
        },
      }),
    );

    expect(summary).toEqual([
      '服薬状況確認済み',
      '残薬確認済み',
      '医師同時訪問: 山田医師 / 残薬調整を協議',
    ]);
  });
});
