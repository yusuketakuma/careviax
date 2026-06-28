import { encodePathSegment } from '@/lib/http/path-segment';

export const PHARMACIST_CREDENTIALS_API_PATH = '/api/admin/pharmacist-credentials';

export function buildPharmacistCredentialApiPath(credentialId: string) {
  return `${PHARMACIST_CREDENTIALS_API_PATH}/${encodePathSegment(credentialId)}`;
}
