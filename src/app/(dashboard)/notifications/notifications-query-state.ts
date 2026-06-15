import type { NotificationCategory } from '@/lib/notifications/notification-category';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type NotificationCategoryFilter = 'all' | NotificationCategory;

export type NotificationsInitialState = {
  initialCategory?: NotificationCategoryFilter;
};

const CATEGORY_VALUES: NotificationCategoryFilter[] = [
  'all',
  'urgent',
  'pharmacist',
  'clerk',
  'reply',
  'unsynced',
];

export function readNotificationsState(params: SearchParamRecord): NotificationsInitialState {
  const category = typeof params?.category === 'string' ? params.category : null;
  if (category && CATEGORY_VALUES.includes(category as NotificationCategoryFilter)) {
    return { initialCategory: category as NotificationCategoryFilter };
  }

  return {};
}
