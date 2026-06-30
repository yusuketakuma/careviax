import { describe, expect, it } from 'vitest';
import {
  ADMIN_FACILITIES_API_PATH,
  buildAdminFacilitiesApiPath,
  buildAdminFacilityApiPath,
  buildAdminFacilityContactsApiPath,
  buildAdminFacilityUnitApiPath,
  buildAdminFacilityUnitsApiPath,
} from './api-paths';

describe('facility admin API path helpers', () => {
  it('builds the collection API path', () => {
    expect(ADMIN_FACILITIES_API_PATH).toBe('/api/admin/facilities');
  });

  it('preserves the empty-list query path shape', () => {
    expect(buildAdminFacilitiesApiPath(new URLSearchParams())).toBe('/api/admin/facilities?');
  });

  it('builds list query paths with encoded search params', () => {
    const params = new URLSearchParams({ q: 'グリーン/ヒル?x=y#z' });

    expect(buildAdminFacilitiesApiPath(params)).toBe(`/api/admin/facilities?${params.toString()}`);
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildAdminFacilityApiPath('facility_1')).toBe('/api/admin/facilities/facility_1');
  });

  it('encodes only the facility id path segment', () => {
    const facilityId = 'facility/1?mode=x#frag';

    expect(buildAdminFacilityApiPath(facilityId)).toBe(
      `/api/admin/facilities/${encodeURIComponent(facilityId)}`,
    );
  });

  it('builds contacts API paths from the encoded detail path', () => {
    expect(buildAdminFacilityContactsApiPath('facility/1')).toBe(
      '/api/admin/facilities/facility%2F1/contacts',
    );
  });

  it('builds unit collection paths from the encoded facility path', () => {
    expect(buildAdminFacilityUnitsApiPath('facility/1')).toBe(
      '/api/admin/facilities/facility%2F1/units',
    );
  });

  it('builds unit detail paths with separately encoded facility and unit ids', () => {
    expect(buildAdminFacilityUnitApiPath('facility/1', 'unit 2/東')).toBe(
      '/api/admin/facilities/facility%2F1/units/unit%202%2F%E6%9D%B1',
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment facility id %s', (facilityId) => {
    expect(() => buildAdminFacilityApiPath(facilityId)).toThrow(RangeError);
  });

  it.each(['.', '..'])('rejects exact dot-segment facility unit id %s', (unitId) => {
    expect(() => buildAdminFacilityUnitApiPath('facility_1', unitId)).toThrow(RangeError);
  });
});
