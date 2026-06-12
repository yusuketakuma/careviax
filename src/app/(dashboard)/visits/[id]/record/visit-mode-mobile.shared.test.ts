import { describe, expect, it } from 'vitest';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  FINAL_SECTION_STEP_IDS,
  applyMedicationAdherenceChoice,
  applyMedicationAdherenceMemo,
  countUnsyncedEvidenceDrafts,
  deriveMedicationAdherenceChoice,
  mobileVisitStepSectionClassName,
  resolveMobilePendingSyncCount,
  resolveMobileVisitStepHeading,
} from './visit-mode-mobile.shared';
import { resolveAdjacentVisitStep } from './visit-step-nav';

function buildSoap(): StructuredSoap {
  return {
    subjective: { symptom_checks: ['pain'], free_text: '訴えあり' },
    objective: {
      medication_status: 'free_text_only',
      adherence_score: 3,
      side_effect_checks: [],
    },
    assessment: { problem_checks: [] },
    plan: { intervention_checks: ['medication_guidance'] },
  };
}

describe('applyMedicationAdherenceChoice', () => {
  it('projects the three choices onto the existing medication_status / adherence_score pair', () => {
    const soap = buildSoap();

    expect(applyMedicationAdherenceChoice(soap, 'well').objective).toMatchObject({
      medication_status: 'full_compliance',
      adherence_score: 5,
    });
    expect(applyMedicationAdherenceChoice(soap, 'sometimes_missed').objective).toMatchObject({
      medication_status: 'missed_doses',
      adherence_score: 3,
    });
    expect(applyMedicationAdherenceChoice(soap, 'poor').objective).toMatchObject({
      medication_status: 'missed_doses',
      adherence_score: 2,
    });
  });

  it('keeps the other SOAP slots untouched', () => {
    const soap = buildSoap();
    const next = applyMedicationAdherenceChoice(soap, 'well');

    expect(next.subjective).toEqual(soap.subjective);
    expect(next.plan).toEqual(soap.plan);
    expect(next.objective.side_effect_checks).toEqual([]);
    // 元オブジェクトは破壊しない
    expect(soap.objective.medication_status).toBe('free_text_only');
  });
});

describe('deriveMedicationAdherenceChoice', () => {
  it('derives the selected card from the projected pair', () => {
    expect(
      deriveMedicationAdherenceChoice({ medication_status: 'full_compliance', adherence_score: 5 }),
    ).toBe('well');
    expect(
      deriveMedicationAdherenceChoice({ medication_status: 'missed_doses', adherence_score: 3 }),
    ).toBe('sometimes_missed');
    expect(
      deriveMedicationAdherenceChoice({ medication_status: 'missed_doses', adherence_score: 2 }),
    ).toBe('poor');
  });

  it('leaves non-projected statuses unselected to avoid misrepresenting existing input', () => {
    expect(
      deriveMedicationAdherenceChoice({ medication_status: 'free_text_only', adherence_score: 3 }),
    ).toBeNull();
    expect(
      deriveMedicationAdherenceChoice({ medication_status: 'refusal', adherence_score: 1 }),
    ).toBeNull();
    expect(
      deriveMedicationAdherenceChoice({
        medication_status: 'partial_remaining',
        adherence_score: 4,
      }),
    ).toBeNull();
    expect(deriveMedicationAdherenceChoice(undefined)).toBeNull();
  });
});

describe('applyMedicationAdherenceMemo', () => {
  it('writes the memo into objective.free_text and clears it when emptied', () => {
    const soap = buildSoap();
    const withMemo = applyMedicationAdherenceMemo(soap, '昼食後分を飲み忘れがち');
    expect(withMemo.objective.free_text).toBe('昼食後分を飲み忘れがち');

    const cleared = applyMedicationAdherenceMemo(withMemo, '');
    expect(cleared.objective.free_text).toBeUndefined();
  });
});

describe('countUnsyncedEvidenceDrafts / resolveMobilePendingSyncCount', () => {
  it('counts only the drafts that belong to the visit being recorded', () => {
    const summaries = [
      { scheduleId: 'sched_1' },
      { scheduleId: 'sched_1' },
      { scheduleId: 'sched_other' },
    ];
    expect(countUnsyncedEvidenceDrafts(summaries, 'sched_1')).toBe(2);
    expect(countUnsyncedEvidenceDrafts(undefined, 'sched_1')).toBe(0);
  });

  it('merges the offline sync queue and photo drafts for the mobile badge', () => {
    expect(resolveMobilePendingSyncCount(1, 2)).toBe(3);
    expect(resolveMobilePendingSyncCount(0, 0)).toBe(0);
    expect(resolveMobilePendingSyncCount(-1, 2)).toBe(2);
  });
});

describe('mobileVisitStepSectionClassName', () => {
  it('hides sections that do not own the active step on mobile only', () => {
    expect(mobileVisitStepSectionClassName('visit-step-soap', ['visit-step-soap'])).toBeUndefined();
    expect(mobileVisitStepSectionClassName('visit-step-soap', ['visit-step-readiness'])).toBe(
      'max-md:hidden',
    );
  });

  it('keeps the final group visible for every step it contains', () => {
    for (const stepId of FINAL_SECTION_STEP_IDS) {
      expect(mobileVisitStepSectionClassName(stepId, FINAL_SECTION_STEP_IDS)).toBeUndefined();
    }
    expect(mobileVisitStepSectionClassName('visit-step-soap', FINAL_SECTION_STEP_IDS)).toBe(
      'max-md:hidden',
    );
  });
});

describe('resolveMobileVisitStepHeading', () => {
  it('uses the p0_23 heading for the medication step and step labels elsewhere', () => {
    expect(resolveMobileVisitStepHeading('visit-step-soap')).toBe('服薬・副作用確認');
    expect(resolveMobileVisitStepHeading('visit-step-readiness')).toBe('訪問前確認');
    expect(resolveMobileVisitStepHeading('visit-step-final-check')).toBe('完了チェック');
  });

  it('switches the mobile bar to 訪問完了 only on the last step (next step is null)', () => {
    expect(resolveAdjacentVisitStep('visit-step-final-check', 'next')).toBeNull();
    expect(resolveAdjacentVisitStep('visit-step-evidence', 'next')).toBe('visit-step-final-check');
  });
});
