import { describe, expect, it } from 'vitest';
import { formatDisplayEntityLabel } from './display-labels';

describe('formatDisplayEntityLabel', () => {
  it('prefers a non-blank display_id over the cuid fallback', () => {
    expect(
      formatDisplayEntityLabel({
        id: 'intake_cuid_12345678',
        display_id: 'r0000000042',
      }),
    ).toBe('r0000000042');
  });

  it('falls back to the existing trailing cuid slice when display_id is missing', () => {
    expect(
      formatDisplayEntityLabel({
        id: 'intake_cuid_12345678',
        display_id: null,
      }),
    ).toBe('12345678');
    expect(
      formatDisplayEntityLabel({
        id: 'case_cuid_87654321',
        display_id: '   ',
      }),
    ).toBe('87654321');
  });

  it('supports the existing leading cuid slice variant used by QR draft case labels', () => {
    expect(
      formatDisplayEntityLabel(
        {
          id: 'case_cuid_87654321',
          display_id: null,
        },
        { fallbackFrom: 'start', fallbackSuffix: '...' },
      ),
    ).toBe('case_cui...');
  });
});
