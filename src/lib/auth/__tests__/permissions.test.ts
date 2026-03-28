import { describe, expect, it } from 'vitest';

import {
  forbiddenIfMissingPermission,
  hasPermission,
} from '../permissions';

describe('permissions', () => {
  it('matches the full workflow permission matrix for all seven roles', () => {
    expect({
      owner: {
        canDispense: hasPermission('owner', 'canDispense'),
        canAuditDispense: hasPermission('owner', 'canAuditDispense'),
        canSet: hasPermission('owner', 'canSet'),
        canAuditSet: hasPermission('owner', 'canAuditSet'),
      },
      admin: {
        canDispense: hasPermission('admin', 'canDispense'),
        canAuditDispense: hasPermission('admin', 'canAuditDispense'),
        canSet: hasPermission('admin', 'canSet'),
        canAuditSet: hasPermission('admin', 'canAuditSet'),
      },
      pharmacist: {
        canDispense: hasPermission('pharmacist', 'canDispense'),
        canAuditDispense: hasPermission('pharmacist', 'canAuditDispense'),
        canSet: hasPermission('pharmacist', 'canSet'),
        canAuditSet: hasPermission('pharmacist', 'canAuditSet'),
      },
      pharmacist_trainee: {
        canDispense: hasPermission('pharmacist_trainee', 'canDispense'),
        canAuditDispense: hasPermission('pharmacist_trainee', 'canAuditDispense'),
        canSet: hasPermission('pharmacist_trainee', 'canSet'),
        canAuditSet: hasPermission('pharmacist_trainee', 'canAuditSet'),
      },
      clerk: {
        canDispense: hasPermission('clerk', 'canDispense'),
        canAuditDispense: hasPermission('clerk', 'canAuditDispense'),
        canSet: hasPermission('clerk', 'canSet'),
        canAuditSet: hasPermission('clerk', 'canAuditSet'),
      },
      driver: {
        canDispense: hasPermission('driver', 'canDispense'),
        canAuditDispense: hasPermission('driver', 'canAuditDispense'),
        canSet: hasPermission('driver', 'canSet'),
        canAuditSet: hasPermission('driver', 'canAuditSet'),
      },
      external_viewer: {
        canDispense: hasPermission('external_viewer', 'canDispense'),
        canAuditDispense: hasPermission('external_viewer', 'canAuditDispense'),
        canSet: hasPermission('external_viewer', 'canSet'),
        canAuditSet: hasPermission('external_viewer', 'canAuditSet'),
      },
    }).toEqual({
      owner: { canDispense: true, canAuditDispense: true, canSet: true, canAuditSet: true },
      admin: { canDispense: true, canAuditDispense: true, canSet: true, canAuditSet: true },
      pharmacist: { canDispense: true, canAuditDispense: true, canSet: true, canAuditSet: true },
      pharmacist_trainee: {
        canDispense: true,
        canAuditDispense: false,
        canSet: true,
        canAuditSet: false,
      },
      clerk: {
        canDispense: false,
        canAuditDispense: false,
        canSet: false,
        canAuditSet: false,
      },
      driver: {
        canDispense: false,
        canAuditDispense: false,
        canSet: false,
        canAuditSet: false,
      },
      external_viewer: {
        canDispense: false,
        canAuditDispense: false,
        canSet: false,
        canAuditSet: false,
      },
    });
  });

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
