import { describe, expect, it } from 'vitest';
import {
  allowedPatientShareDataOutputActions,
  canEditOwnedResource,
  canExportSharedData,
  canRequestCorrection,
  getPatientShareCorrectionTargetOwner,
  oppositePharmacyOwner,
  requiredPatientShareScopeKeysForDataOutput,
  resolvePatientShareDataOutputPolicy,
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

  it('maps shared data output actions to the required share scope keys', () => {
    expect(requiredPatientShareScopeKeysForDataOutput('view_attachment')).toEqual(['attachments']);
    expect(requiredPatientShareScopeKeysForDataOutput('download_attachment')).toEqual([
      'attachments',
      'download',
    ]);
    expect(requiredPatientShareScopeKeysForDataOutput('print')).toEqual(['print']);
    expect(requiredPatientShareScopeKeysForDataOutput('pdf_output')).toEqual(['pdf_output']);
    expect(requiredPatientShareScopeKeysForDataOutput('download_pdf')).toEqual([
      'pdf_output',
      'download',
    ]);
    expect(requiredPatientShareScopeKeysForDataOutput('download_data')).toEqual(['download']);
  });

  it('allows shared data output only when the share case is active and the scope covers the action', () => {
    const shareScope = {
      attachments: true,
      print: true,
      pdf_output: true,
      download: true,
    };

    expect(
      resolvePatientShareDataOutputPolicy({
        shareCaseStatus: 'active',
        shareScope,
        action: 'download_attachment',
      }),
    ).toMatchObject({
      allowed: true,
      requiredScopeKeys: ['attachments', 'download'],
      missingScopeKeys: [],
      blocker: undefined,
    });
    expect(
      canExportSharedData({
        shareCaseStatus: 'active',
        shareScope,
        action: 'download_pdf',
      }),
    ).toBe(true);
  });

  it('fails closed for inactive share cases even when output scope is enabled', () => {
    expect(
      resolvePatientShareDataOutputPolicy({
        shareCaseStatus: 'revoked',
        shareScope: {
          attachments: true,
          print: true,
          pdf_output: true,
          download: true,
        },
        action: 'download_pdf',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'inactive_share_case',
      requiredScopeKeys: ['pdf_output', 'download'],
      missingScopeKeys: [],
    });
  });

  it('reports missing scope keys and does not treat non-boolean scope values as enabled', () => {
    expect(
      resolvePatientShareDataOutputPolicy({
        shareCaseStatus: 'active',
        shareScope: {
          attachments: true,
          pdf_output: true,
          download: 'yes',
        },
        action: 'download_attachment',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'missing_share_scope',
      requiredScopeKeys: ['attachments', 'download'],
      enabledScopeKeys: ['attachments', 'pdf_output'],
      missingScopeKeys: ['download'],
    });
    expect(
      canExportSharedData({
        shareCaseStatus: 'active',
        shareScope: { pdf_output: true },
        action: 'download_pdf',
      }),
    ).toBe(false);
  });

  it('derives allowed output actions from active share status and scope', () => {
    expect(
      allowedPatientShareDataOutputActions({
        shareCaseStatus: 'active',
        shareScope: {
          attachments: true,
          print: true,
          pdf_output: true,
          download: true,
        },
      }),
    ).toEqual([
      'view_attachment',
      'download_attachment',
      'print',
      'pdf_output',
      'download_pdf',
      'download_data',
    ]);
    expect(
      allowedPatientShareDataOutputActions({
        shareCaseStatus: 'draft',
        shareScope: {
          attachments: true,
          print: true,
          pdf_output: true,
          download: true,
        },
      }),
    ).toEqual([]);
  });
});
