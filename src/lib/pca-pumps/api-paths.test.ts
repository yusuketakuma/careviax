import { describe, expect, it } from 'vitest';
import {
  PCA_PUMPS_API_PATH,
  PCA_PUMP_RENTALS_API_PATH,
  buildPcaPumpApiPath,
  buildPcaPumpRentalApiPath,
  buildPcaPumpRentalsApiPath,
  buildPcaPumpsApiPath,
} from './api-paths';

describe('PCA pump API path helpers', () => {
  it('builds static collection API paths without trailing query strings when omitted', () => {
    expect(PCA_PUMPS_API_PATH).toBe('/api/pca-pumps');
    expect(PCA_PUMP_RENTALS_API_PATH).toBe('/api/pca-pump-rentals');
    expect(buildPcaPumpsApiPath()).toBe('/api/pca-pumps');
    expect(buildPcaPumpRentalsApiPath()).toBe('/api/pca-pump-rentals');
  });

  it('preserves existing query-string shape when URLSearchParams are provided', () => {
    expect(buildPcaPumpsApiPath(new URLSearchParams())).toBe('/api/pca-pumps?');
    expect(buildPcaPumpRentalsApiPath(new URLSearchParams())).toBe('/api/pca-pump-rentals?');

    const params = new URLSearchParams({ q: 'PCA/001?x=y#z' });

    expect(buildPcaPumpsApiPath(params)).toBe(`/api/pca-pumps?${params.toString()}`);
  });

  it('builds query-string paths from record params', () => {
    expect(buildPcaPumpRentalsApiPath({ status: 'returned', inspection_status: 'pending' })).toBe(
      '/api/pca-pump-rentals?status=returned&inspection_status=pending',
    );
  });

  it('encodes pump and rental ids as single path segments', () => {
    const hostileId = 'id/1?mode=x#frag';

    expect(buildPcaPumpApiPath(hostileId)).toBe(`/api/pca-pumps/${encodeURIComponent(hostileId)}`);
    expect(buildPcaPumpRentalApiPath(hostileId)).toBe(
      `/api/pca-pump-rentals/${encodeURIComponent(hostileId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment pump id %s', (pumpId) => {
    expect(() => buildPcaPumpApiPath(pumpId)).toThrow(RangeError);
  });

  it.each(['.', '..'])('rejects exact dot-segment rental id %s', (rentalId) => {
    expect(() => buildPcaPumpRentalApiPath(rentalId)).toThrow(RangeError);
  });
});
