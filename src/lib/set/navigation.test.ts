import { describe, expect, it } from 'vitest';
import { buildSetPlanHref } from './navigation';

describe('buildSetPlanHref', () => {
  it('builds the set page focused on a normal plan id', () => {
    expect(buildSetPlanHref('plan_1')).toBe('/set?planId=plan_1');
  });

  it('encodes plan ids as query values without changing spaces to plus signs', () => {
    const planId = '../plan with space?x=1#frag';

    expect(buildSetPlanHref(planId)).toBe(`/set?planId=${encodeURIComponent(planId)}`);
    expect(buildSetPlanHref(planId)).toContain('%20');
    expect(buildSetPlanHref(planId)).not.toContain('+');
  });
});
