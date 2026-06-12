import { describe, expect, it } from 'vitest';
import {
  buildVisitStepStates,
  resolveAdjacentVisitStep,
  VISIT_RECORD_STEPS,
} from './visit-step-nav';

describe('buildVisitStepStates', () => {
  it('marks steps before the active one as done and later steps as todo', () => {
    expect(buildVisitStepStates('visit-step-result')).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
  });

  it('falls back to the first step before any section is observed', () => {
    const states = buildVisitStepStates(null);
    expect(states[0]).toBe('current');
    expect(states.slice(1).every((state) => state === 'todo')).toBe(true);
  });

  it('marks everything before the final step done when it is active', () => {
    const states = buildVisitStepStates('visit-step-final-check');
    expect(states.slice(0, -1).every((state) => state === 'done')).toBe(true);
    expect(states.at(-1)).toBe('current');
    expect(VISIT_RECORD_STEPS).toHaveLength(9);
  });
});

describe('resolveAdjacentVisitStep', () => {
  it('moves between neighbouring steps', () => {
    expect(resolveAdjacentVisitStep('visit-step-result', 'prev')).toBe('visit-step-status');
    expect(resolveAdjacentVisitStep('visit-step-result', 'next')).toBe('visit-step-soap');
  });

  it('returns null at the edges', () => {
    expect(resolveAdjacentVisitStep('visit-step-readiness', 'prev')).toBeNull();
    expect(resolveAdjacentVisitStep('visit-step-final-check', 'next')).toBeNull();
  });

  it('treats no active step as the first step', () => {
    expect(resolveAdjacentVisitStep(null, 'next')).toBe('visit-step-status');
    expect(resolveAdjacentVisitStep(null, 'prev')).toBeNull();
  });
});
