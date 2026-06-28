import { encodePathSegment } from '@/lib/http/path-segment';

export const PCA_PUMPS_API_PATH = '/api/pca-pumps';
export const PCA_PUMP_RENTALS_API_PATH = '/api/pca-pump-rentals';

function appendSearchParams(path: string, params?: URLSearchParams | Record<string, string>) {
  if (!params) return path;
  return `${path}?${new URLSearchParams(params).toString()}`;
}

export function buildPcaPumpsApiPath(params?: URLSearchParams | Record<string, string>) {
  return appendSearchParams(PCA_PUMPS_API_PATH, params);
}

export function buildPcaPumpApiPath(pumpId: string) {
  return `${PCA_PUMPS_API_PATH}/${encodePathSegment(pumpId)}`;
}

export function buildPcaPumpRentalsApiPath(params?: URLSearchParams | Record<string, string>) {
  return appendSearchParams(PCA_PUMP_RENTALS_API_PATH, params);
}

export function buildPcaPumpRentalApiPath(rentalId: string) {
  return `${PCA_PUMP_RENTALS_API_PATH}/${encodePathSegment(rentalId)}`;
}
