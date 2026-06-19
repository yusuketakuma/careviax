import { describe, expect, it } from 'vitest';
import {
  canEditOwnedResource,
  canRequestCorrection,
  getPatientShareCorrectionTargetOwner,
  oppositePharmacyOwner,
  resolvePatientShareCorrectionRequestPolicy,
} from '@/server/services/patient-share-policy';

describe('patient share policy', () => {
  it('maps correction targets to the owner that must change the source data', () => {
    expect(getPatientShareCorrectionTargetOwner('patient_profile')).toBe('base_pharmacy');
    expect(getPatientShareCorrectionTargetOwner('management_plan')).toBe('base_pharmacy');
    expect(getPatientShareCorrectionTargetOwner('partner_visit_record')).toBe('partner_pharmacy');
    expect(getPatientShareCorrectionTargetOwner('billing_candidate')).toBe('base_pharmacy');
  });

  it('treats only same-owner resources as directly editable', () => {
    expect(
      canEditOwnedResource({ actorOwner: 'base_pharmacy', resourceOwner: 'base_pharmacy' }),
    ).toBe(true);
    expect(
      canEditOwnedResource({ actorOwner: 'base_pharmacy', resourceOwner: 'partner_pharmacy' }),
    ).toBe(false);
  });

  it('allows correction requests only across owners on active share cases', () => {
    expect(
      canRequestCorrection({
        shareCaseStatus: 'active',
        requesterOwner: 'base_pharmacy',
        targetOwner: 'partner_pharmacy',
      }),
    ).toBe(true);
    expect(
      canRequestCorrection({
        shareCaseStatus: 'active',
        requesterOwner: 'partner_pharmacy',
        targetOwner: 'partner_pharmacy',
      }),
    ).toBe(false);
    expect(
      canRequestCorrection({
        shareCaseStatus: 'revoked',
        requesterOwner: 'base_pharmacy',
        targetOwner: 'partner_pharmacy',
      }),
    ).toBe(false);
  });

  it('resolves route-facing correction request owner policy', () => {
    expect(
      resolvePatientShareCorrectionRequestPolicy({
        shareCaseStatus: 'active',
        targetType: 'partner_visit_record',
      }),
    ).toEqual({
      allowed: true,
      requesterOwner: 'base_pharmacy',
      targetOwner: 'partner_pharmacy',
    });
    expect(oppositePharmacyOwner('base_pharmacy')).toBe('partner_pharmacy');
  });
});
