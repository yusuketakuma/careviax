import { describe, expect, it } from 'vitest';
import { selectCanonicalHomeVisitIntakeCase } from './home-visit-intake-target';

describe('selectCanonicalHomeVisitIntakeCase', () => {
  it('selects the newest open case from the canonical ordered projection', () => {
    const selected = selectCanonicalHomeVisitIntakeCase([
      { id: 'closed-newest', status: 'completed', version: 4 },
      { id: 'open-newest', status: 'active', version: 3 },
      { id: 'open-older', status: 'assessment', version: 2 },
    ]);

    expect(selected).toEqual({ id: 'open-newest', status: 'active', version: 3 });
  });

  it('falls back to the newest case when no open case exists', () => {
    expect(
      selectCanonicalHomeVisitIntakeCase([
        { id: 'closed-newest', status: 'completed' },
        { id: 'closed-older', status: 'cancelled' },
      ]),
    ).toEqual({ id: 'closed-newest', status: 'completed' });
    expect(selectCanonicalHomeVisitIntakeCase([])).toBeNull();
  });
});
