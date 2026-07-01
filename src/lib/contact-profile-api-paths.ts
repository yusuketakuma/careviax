export const CONTACT_PROFILES_API_PATH = '/api/contact-profiles';

export function buildContactProfilesApiPath(params?: URLSearchParams) {
  if (!params) return CONTACT_PROFILES_API_PATH;
  return `${CONTACT_PROFILES_API_PATH}?${params.toString()}`;
}
