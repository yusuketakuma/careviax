import { describe, expect, it } from 'vitest';

import {
  forbiddenIfMissingPermission,
  hasPermission,
} from '../permissions';

describe('permissions', () => {
  it('grants report permission to clerks', () => {
    expect(hasPermission('clerk', 'canReport')).toBe(true);
  });

  it('grants dashboard permission to clerks and denies it to drivers', () => {
    expect(hasPermission('clerk', 'canViewDashboard')).toBe(true);
    expect(hasPermission('driver', 'canViewDashboard')).toBe(false);
  });

  it('denies admin permission to pharmacists', () => {
    expect(hasPermission('pharmacist', 'canAdmin')).toBe(false);
  });

  it('returns null when the role has the requested permission', () => {
    const result = forbiddenIfMissingPermission(
      'owner',
      'canAdmin',
      '管理者権限が必要です'
    );

    expect(result).toBeNull();
  });

  it('returns a forbidden response when the role lacks the permission', async () => {
    const result = forbiddenIfMissingPermission(
      'driver',
      'canVisit',
      '訪問権限が必要です'
    );

    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toEqual({
      code: 'AUTH_FORBIDDEN',
      message: '訪問権限が必要です',
      details: undefined,
    });
  });
});
