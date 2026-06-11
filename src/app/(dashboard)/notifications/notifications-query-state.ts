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

/** 旧リンク互換: /notifications?type=urgent 等を 5 分類へ写像する */
const LEGACY_TYPE_TO_CATEGORY: Record<string, NotificationCategoryFilter> = {
  all: 'all',
  urgent: 'urgent',
  business: 'clerk',
  reminder: 'reply',
  system: 'all',
};

export function readNotificationsState(params: SearchParamRecord): NotificationsInitialState {
  const category = typeof params?.category === 'string' ? params.category : null;
  if (category && CATEGORY_VALUES.includes(category as NotificationCategoryFilter)) {
    return { initialCategory: category as NotificationCategoryFilter };
  }

  const legacyType = typeof params?.type === 'string' ? params.type : null;
  if (legacyType && LEGACY_TYPE_TO_CATEGORY[legacyType]) {
    return { initialCategory: LEGACY_TYPE_TO_CATEGORY[legacyType] };
  }

  return {};
}
