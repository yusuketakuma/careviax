import { describe, expect, it } from 'vitest';
import {
  VISIT_VEHICLE_RESOURCES_API_PATH,
  buildVisitVehicleResourceApiPath,
  buildVisitVehicleResourcesApiPath,
} from './api-paths';

describe('visit vehicle resources API path helpers', () => {
  it('builds the collection API path', () => {
    expect(VISIT_VEHICLE_RESOURCES_API_PATH).toBe('/api/visit-vehicle-resources');
  });

  it('preserves the empty-list query path shape', () => {
    expect(buildVisitVehicleResourcesApiPath(new URLSearchParams())).toBe(
      '/api/visit-vehicle-resources?',
    );
  });

  it('builds list query paths with encoded search params', () => {
    const params = new URLSearchParams({ site_id: 'site/1?x=y#z', available: 'true' });

    expect(buildVisitVehicleResourcesApiPath(params)).toBe(
      `/api/visit-vehicle-resources?${params.toString()}`,
    );
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildVisitVehicleResourceApiPath('vehicle_1')).toBe(
      '/api/visit-vehicle-resources/vehicle_1',
    );
  });

  it('encodes only the vehicle id path segment', () => {
    const id = 'vehicle/1?mode=x#frag';

    expect(buildVisitVehicleResourceApiPath(id)).toBe(
      `/api/visit-vehicle-resources/${encodeURIComponent(id)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment vehicle id %s', (id) => {
    expect(() => buildVisitVehicleResourceApiPath(id)).toThrow(RangeError);
  });
});
