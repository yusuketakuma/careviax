import { describe, expect, it } from 'vitest';
import { buildVisitStepStates, VISIT_RECORD_STEPS } from './visit-step-nav';

describe('buildVisitStepStates', () => {
  it('marks steps before the active one as done and later steps as todo', () => {
    expect(buildVisitStepStates('visit-step-result')).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
  });

  it('falls back to the first step before any section is observed', () => {
    expect(buildVisitStepStates(null)).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
  });

  it('marks everything before the final step done when it is active', () => {
    const states = buildVisitStepStates('visit-step-final');
    expect(states.slice(0, -1).every((state) => state === 'done')).toBe(true);
    expect(states.at(-1)).toBe('current');
    expect(VISIT_RECORD_STEPS).toHaveLength(5);
  });
});
