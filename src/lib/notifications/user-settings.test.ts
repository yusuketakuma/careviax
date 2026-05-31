import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_NOTIFICATION_SETTINGS,
  normalizeUserNotificationSettings,
  parseUserNotificationSettingsStorage,
} from './user-settings';

describe('user notification settings helpers', () => {
  it('returns defaults for malformed storage payloads', () => {
    expect(parseUserNotificationSettingsStorage(null)).toEqual(DEFAULT_USER_NOTIFICATION_SETTINGS);
    expect(parseUserNotificationSettingsStorage('{bad-json')).toEqual(
      DEFAULT_USER_NOTIFICATION_SETTINGS,
    );
    expect(parseUserNotificationSettingsStorage(JSON.stringify({ id: 'visit-reminder' }))).toEqual(
      DEFAULT_USER_NOTIFICATION_SETTINGS,
    );
  });

  it('restores only known setting enabled values from persisted rows', () => {
    const settings = normalizeUserNotificationSettings([
      { id: 'visit-reminder', label: 'tampered', description: 'tampered', enabled: false },
      { id: 'unknown-setting', label: 'Unknown', description: 'ignored', enabled: true },
      { id: 'report-deadline', enabled: 'no' },
      ['invalid'],
    ]);

    expect(settings).toEqual([
      {
        ...DEFAULT_USER_NOTIFICATION_SETTINGS[0],
        enabled: false,
      },
      ...DEFAULT_USER_NOTIFICATION_SETTINGS.slice(1),
    ]);
  });

  it('keeps new default settings when old storage is missing some ids', () => {
    const settings = normalizeUserNotificationSettings([{ id: 'audit-result', enabled: true }]);

    expect(settings).toHaveLength(DEFAULT_USER_NOTIFICATION_SETTINGS.length);
    expect(settings.find((setting) => setting.id === 'audit-result')?.enabled).toBe(true);
    expect(settings.find((setting) => setting.id === 'system-maintenance')).toEqual(
      DEFAULT_USER_NOTIFICATION_SETTINGS.find((setting) => setting.id === 'system-maintenance'),
    );
  });
});
