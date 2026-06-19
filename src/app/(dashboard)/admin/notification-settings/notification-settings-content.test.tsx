// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { NotificationSettingsContent } from './notification-settings-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/browser-notifications', () => ({
  getBrowserNotificationPreference: () => false,
  isBrowserNotificationSupported: () => false,
  setBrowserNotificationPreference: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('NotificationSettingsContent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/notification-rules' && !init?.method) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }

        if (url === '/api/admin/escalation-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_1',
                  trigger_type: 'communication_response_overdue',
                  condition: { threshold_hours: 24, severity: 'high' },
                  action: 'in_app_notification',
                  notify_role: 'admin',
                  is_active: true,
                  created_at: '2026-06-19T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/admin/escalation-rules/rule_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '削除しました' }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires confirmation before deleting an escalation rule', async () => {
    render(<NotificationSettingsContent />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: '連携返信期限超過 / アプリ内通知 / 管理者 / 24時間 を削除',
      }),
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/escalation-rules/rule_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(
      screen.getByRole('alertdialog', { name: 'エスカレーションルールを削除しますか' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '連携返信期限超過 / アプリ内通知 / 管理者 / 24時間 を削除します。この操作は取り消せません。停滞・失敗時の通知やタスク起票にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/escalation-rules/rule_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });
});
