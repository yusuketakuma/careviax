import { describe, expect, it } from 'vitest';
import { canFinalizeClinicalState } from '@/lib/auth/clinical-finalization';

describe('canFinalizeClinicalState', () => {
  it('allows pharmacist-level final clinical outcome roles only', () => {
    expect(canFinalizeClinicalState('owner')).toBe(true);
    expect(canFinalizeClinicalState('admin')).toBe(true);
    expect(canFinalizeClinicalState('pharmacist')).toBe(true);
    expect(canFinalizeClinicalState('pharmacist_trainee')).toBe(false);
    expect(canFinalizeClinicalState('clerk')).toBe(false);
    expect(canFinalizeClinicalState('driver')).toBe(false);
    expect(canFinalizeClinicalState('external_viewer')).toBe(false);
  });
});
