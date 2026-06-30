import { encodePathSegment } from '@/lib/http/path-segment';

export const DRUG_MASTERS_API_PATH = '/api/drug-masters';

function appendQuery(path: string, params?: URLSearchParams | string): string {
  if (params == null) return path;
  const query = typeof params === 'string' ? params : params.toString();
  return `${path}?${query}`;
}

export function buildDrugMastersApiPath(params?: URLSearchParams | string): string {
  return appendQuery(DRUG_MASTERS_API_PATH, params);
}

export function buildDrugMasterApiPath(drugMasterId: string, suffix = ''): string {
  return `${DRUG_MASTERS_API_PATH}/${encodePathSegment(drugMasterId)}${suffix}`;
}

export function buildDrugMasterGenericRecommendationsApiPath(
  drugMasterId: string,
  params?: URLSearchParams | string,
): string {
  return appendQuery(buildDrugMasterApiPath(drugMasterId, '/generic-recommendations'), params);
}

export function buildDrugMasterIngredientGroupApiPath(
  drugMasterId: string,
  params?: URLSearchParams | string,
): string {
  return appendQuery(buildDrugMasterApiPath(drugMasterId, '/ingredient-group'), params);
}
