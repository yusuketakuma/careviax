import { encodePathSegment } from '@/lib/http/path-segment';

export const ADMIN_EXTERNAL_PROFESSIONALS_API_PATH = '/api/admin/external-professionals';

export function buildAdminExternalProfessionalsApiPath(params: URLSearchParams) {
  return `${ADMIN_EXTERNAL_PROFESSIONALS_API_PATH}?${params.toString()}`;
}

export function buildAdminExternalProfessionalApiPath(externalProfessionalId: string) {
  return `${ADMIN_EXTERNAL_PROFESSIONALS_API_PATH}/${encodePathSegment(externalProfessionalId)}`;
}
