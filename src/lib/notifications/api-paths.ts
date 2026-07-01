export const NOTIFICATIONS_API_PATH = '/api/notifications';

export function buildNotificationsApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${NOTIFICATIONS_API_PATH}?${query}` : NOTIFICATIONS_API_PATH;
}
