import { describe, expect, it } from 'vitest';
import { NAV_BADGES_API_PATH, buildNavBadgesApiPath } from './api-paths';

describe('nav badge API path helpers', () => {
  it('builds the aggregated nav badge API path', () => {
    expect(NAV_BADGES_API_PATH).toBe('/api/nav-badges');
    expect(buildNavBadgesApiPath()).toBe('/api/nav-badges');
  });
});
