import { describe, expect, it } from 'vitest';
import {
  PHOS_DISABLE_LEGACY_FILE_API_ENV,
  PHOS_ENABLE_LEGACY_FILE_API_ENV,
  isLegacyFileApiDisabled,
} from './legacy-file-api-boundary';

describe('legacy file API boundary', () => {
  it('fails closed in production when no compatibility override is set', () => {
    expect(isLegacyFileApiDisabled({ NODE_ENV: 'production' })).toBe(true);
  });

  it('allows non-production compatibility unless the PH-OS kill switch is set', () => {
    expect(isLegacyFileApiDisabled({ NODE_ENV: 'development' })).toBe(false);
    expect(
      isLegacyFileApiDisabled({
        NODE_ENV: 'development',
        [PHOS_DISABLE_LEGACY_FILE_API_ENV]: 'true',
      }),
    ).toBe(true);
  });

  it('requires an explicit compatibility override to keep legacy file APIs in production', () => {
    expect(
      isLegacyFileApiDisabled({
        NODE_ENV: 'production',
        [PHOS_ENABLE_LEGACY_FILE_API_ENV]: '1',
      }),
    ).toBe(false);
  });

  it('keeps the PH-OS kill switch authoritative over the compatibility override', () => {
    expect(
      isLegacyFileApiDisabled({
        NODE_ENV: 'production',
        [PHOS_DISABLE_LEGACY_FILE_API_ENV]: '1',
        [PHOS_ENABLE_LEGACY_FILE_API_ENV]: '1',
      }),
    ).toBe(true);
  });
});
