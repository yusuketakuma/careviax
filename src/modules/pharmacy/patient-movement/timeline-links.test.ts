import { describe, expect, it } from 'vitest';

import {
  buildPharmacyPrescriptionTimelineHref,
  getPharmacyCycleStatusLabel,
} from './timeline-links';

describe('pharmacy patient movement timeline links', () => {
  it('delegates prescription movement links through the canonical prescription route builder', () => {
    expect(buildPharmacyPrescriptionTimelineHref('intake_1')).toBe('/prescriptions/intake_1');
    expect(buildPharmacyPrescriptionTimelineHref('rx 1/2')).toBe('/prescriptions/rx%201%2F2');
  });

  it('rejects prescription ids that would become dot path segments', () => {
    expect(() => buildPharmacyPrescriptionTimelineHref('.')).toThrow(RangeError);
    expect(() => buildPharmacyPrescriptionTimelineHref('..')).toThrow(RangeError);
  });

  it('keeps pharmacy cycle status labels behind the pharmacy module seam', () => {
    expect(getPharmacyCycleStatusLabel('audit_pending')).toBe('監査待ち');
    expect(getPharmacyCycleStatusLabel('custom_status')).toBe('custom_status');
  });
});
