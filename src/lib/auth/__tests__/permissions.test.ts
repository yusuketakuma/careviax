import { describe, expect, it } from 'vitest';

import { canConfirmCareReportClinicalJudgement } from '../care-report-confirmation';
import { forbiddenIfMissingPermission, hasPermission } from '../permissions';

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

  it('splits report creation, external report sending, and billing permissions', () => {
    expect(hasPermission('clerk', 'canReport')).toBe(true);
    expect(hasPermission('clerk', 'canManageBilling')).toBe(false);
    expect(hasPermission('clerk', 'canSendCareReport')).toBe(false);
    expect(hasPermission('pharmacist_trainee', 'canReport')).toBe(true);
    expect(hasPermission('pharmacist_trainee', 'canManageBilling')).toBe(false);
    expect(hasPermission('pharmacist_trainee', 'canSendCareReport')).toBe(false);
    expect(hasPermission('pharmacist', 'canManageBilling')).toBe(true);
    expect(hasPermission('pharmacist', 'canSendCareReport')).toBe(true);
    expect(hasPermission('driver', 'canManageBilling')).toBe(false);
  });

  it('grants dashboard permission to clerks and denies it to drivers', () => {
    expect(hasPermission('clerk', 'canViewDashboard')).toBe(true);
    expect(hasPermission('driver', 'canViewDashboard')).toBe(false);
  });

  it('limits patient-sharing lifecycle decisions to full pharmacists and admins', () => {
    expect(hasPermission('owner', 'canManagePatientSharing')).toBe(true);
    expect(hasPermission('admin', 'canManagePatientSharing')).toBe(true);
    expect(hasPermission('pharmacist', 'canManagePatientSharing')).toBe(true);
    expect(hasPermission('pharmacist_trainee', 'canManagePatientSharing')).toBe(false);
    expect(hasPermission('clerk', 'canManagePatientSharing')).toBe(false);
    expect(hasPermission('driver', 'canManagePatientSharing')).toBe(false);
    expect(hasPermission('external_viewer', 'canManagePatientSharing')).toBe(false);
  });

  it('limits care report clinical confirmation to qualified roles', () => {
    expect(canConfirmCareReportClinicalJudgement('owner')).toBe(true);
    expect(canConfirmCareReportClinicalJudgement('admin')).toBe(true);
    expect(canConfirmCareReportClinicalJudgement('pharmacist')).toBe(true);
    expect(canConfirmCareReportClinicalJudgement('pharmacist_trainee')).toBe(false);
    expect(canConfirmCareReportClinicalJudgement('clerk')).toBe(false);
    expect(canConfirmCareReportClinicalJudgement('driver')).toBe(false);
    expect(canConfirmCareReportClinicalJudgement('external_viewer')).toBe(false);
  });

  it('denies admin permission to pharmacists', () => {
    expect(hasPermission('pharmacist', 'canAdmin')).toBe(false);
  });

  it('returns null when the role has the requested permission', () => {
    const result = forbiddenIfMissingPermission('owner', 'canAdmin', '管理者権限が必要です');

    expect(result).toBeNull();
  });

  it('returns a forbidden response when the role lacks the permission', async () => {
    const result = forbiddenIfMissingPermission('driver', 'canVisit', '訪問権限が必要です');

    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toEqual({
      code: 'AUTH_FORBIDDEN',
      message: '訪問権限が必要です',
      details: undefined,
    });
  });
});
