import { describe, expect, it } from 'vitest';
import {
  CONTACT_PROFILES_API_PATH,
  buildContactProfilesApiPath,
} from './contact-profile-api-paths';

describe('contact profile API paths', () => {
  it('exposes the contact profile collection path', () => {
    expect(CONTACT_PROFILES_API_PATH).toBe('/api/contact-profiles');
  });

  it('builds the collection search path with encoded query parameters', () => {
    const params = new URLSearchParams({
      kind: 'external_professional',
      q: '東中央 クリニック',
    });

    expect(buildContactProfilesApiPath(params)).toBe(
      '/api/contact-profiles?kind=external_professional&q=%E6%9D%B1%E4%B8%AD%E5%A4%AE+%E3%82%AF%E3%83%AA%E3%83%8B%E3%83%83%E3%82%AF',
    );
  });

  it('preserves the existing explicit empty-search query shape', () => {
    expect(buildContactProfilesApiPath(new URLSearchParams())).toBe('/api/contact-profiles?');
  });

  it('returns the collection path when query params are omitted', () => {
    expect(buildContactProfilesApiPath()).toBe(CONTACT_PROFILES_API_PATH);
  });
});
