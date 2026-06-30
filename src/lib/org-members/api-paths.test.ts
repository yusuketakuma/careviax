import { describe, expect, it } from 'vitest';
import { ORG_MEMBERS_API_PATH, buildOrgMembersApiPath } from './api-paths';

describe('org members API paths', () => {
  it('builds the collection path', () => {
    expect(ORG_MEMBERS_API_PATH).toBe('/api/org/members');
    expect(buildOrgMembersApiPath()).toBe('/api/org/members');
  });

  it('appends query parameters without changing their encoding', () => {
    const params = new URLSearchParams({ eligible: 'staff', role: 'care team' });

    expect(buildOrgMembersApiPath(params)).toBe('/api/org/members?eligible=staff&role=care+team');
  });
});
