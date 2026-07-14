import { describe, expect, it } from 'vitest';

import { getPatientPrivacyFlags } from './privacy';

describe('getPatientPrivacyFlags', () => {
  it.each(['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk', 'driver'] as const)(
    'returns unmasked access for internal staff role %s',
    (role) => {
      expect(getPatientPrivacyFlags(role)).toEqual({
        sensitiveFieldsMasked: false,
        addressFieldsMasked: false,
        canViewDetail: true,
      });
    },
  );

  it('keeps external viewers masked without detail access', () => {
    expect(getPatientPrivacyFlags('external_viewer')).toEqual({
      sensitiveFieldsMasked: true,
      addressFieldsMasked: true,
      canViewDetail: false,
    });
  });

  it('fails closed for unknown roles', () => {
    expect(getPatientPrivacyFlags('future_external_role')).toEqual({
      sensitiveFieldsMasked: true,
      addressFieldsMasked: true,
      canViewDetail: false,
    });
  });
});
