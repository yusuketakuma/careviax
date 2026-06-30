export const ORG_MEMBERS_API_PATH = '/api/org/members';

export function buildOrgMembersApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${ORG_MEMBERS_API_PATH}?${query}` : ORG_MEMBERS_API_PATH;
}
