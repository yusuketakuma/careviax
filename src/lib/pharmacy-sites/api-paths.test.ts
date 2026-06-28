import { describe, expect, it } from 'vitest';
import {
  PHARMACY_SITES_API_PATH,
  buildPharmacySiteApiPath,
  buildPharmacySiteInsuranceConfigApiPath,
  buildPharmacySiteInsuranceConfigsApiPath,
} from './api-paths';

describe('pharmacy site API path helpers', () => {
  it('builds the collection API path', () => {
    expect(PHARMACY_SITES_API_PATH).toBe('/api/pharmacy-sites');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildPharmacySiteApiPath('site_1')).toBe('/api/pharmacy-sites/site_1');
    expect(buildPharmacySiteInsuranceConfigsApiPath('site_1')).toBe(
      '/api/pharmacy-sites/site_1/insurance-configs',
    );
    expect(buildPharmacySiteInsuranceConfigApiPath('site_1', 'config_1')).toBe(
      '/api/pharmacy-sites/site_1/insurance-configs/config_1',
    );
  });

  it('encodes each dynamic path segment independently', () => {
    const siteId = 'site/1?mode=x#frag';
    const configId = 'config/1?mode=y#frag';

    expect(buildPharmacySiteApiPath(siteId)).toBe(
      `/api/pharmacy-sites/${encodeURIComponent(siteId)}`,
    );
    expect(buildPharmacySiteInsuranceConfigsApiPath(siteId)).toBe(
      `/api/pharmacy-sites/${encodeURIComponent(siteId)}/insurance-configs`,
    );
    expect(buildPharmacySiteInsuranceConfigApiPath(siteId, configId)).toBe(
      `/api/pharmacy-sites/${encodeURIComponent(siteId)}/insurance-configs/${encodeURIComponent(
        configId,
      )}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment site id %s', (siteId) => {
    expect(() => buildPharmacySiteApiPath(siteId)).toThrow(RangeError);
    expect(() => buildPharmacySiteInsuranceConfigsApiPath(siteId)).toThrow(RangeError);
    expect(() => buildPharmacySiteInsuranceConfigApiPath(siteId, 'config_1')).toThrow(RangeError);
  });

  it.each(['.', '..'])('rejects exact dot-segment config id %s', (configId) => {
    expect(() => buildPharmacySiteInsuranceConfigApiPath('site_1', configId)).toThrow(RangeError);
  });
});
