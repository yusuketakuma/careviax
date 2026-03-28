import { Metadata } from 'next';
import { NotificationSettingsContent } from './notification-settings-content';

export const metadata: Metadata = {
  title: '通知設定 — CareViaX',
};

export default function NotificationSettingsPage() {
  return <NotificationSettingsContent />;
}
