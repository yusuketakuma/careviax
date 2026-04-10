import type {
  HomeLinkContext,
  NotificationTab,
  NotificationTypeFilter,
} from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type NotificationsInitialState = {
  initialTab?: NotificationTab;
  initialTypeFilter?: NotificationTypeFilter;
  initialContext?: HomeLinkContext | null;
};

export function readNotificationsState(params: SearchParamRecord): NotificationsInitialState {
  const tab = typeof params?.tab === 'string' ? params.tab : null;
  const type = typeof params?.type === 'string' ? params.type : null;
  const context = typeof params?.context === 'string' ? params.context : null;

  return {
    initialTab: tab === 'all' || tab === 'unread' ? tab : undefined,
    initialTypeFilter:
      type === 'all' ||
      type === 'urgent' ||
      type === 'business' ||
      type === 'reminder' ||
      type === 'system'
        ? type
        : undefined,
    initialContext: context === 'dashboard_home' ? context : null,
  };
}
