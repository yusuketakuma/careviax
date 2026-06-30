// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
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
    vi.clearAllMocks();
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
              total_count: 1,
              visible_count: 1,
              hidden_count: 0,
              truncated: false,
              count_basis: 'escalation_rules',
              filters_applied: {},
              limit: 100,
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

  it('prioritizes event delivery rules before browser permission settings', async () => {
    render(<NotificationSettingsContent />);

    await screen.findByText('イベント通知ルール');

    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    const eventRulesTitle = screen.getByText('イベント通知ルール');
    const browserNotificationsTitle = screen.getByText('ブラウザ通知');
    expect(
      eventRulesTitle.compareDocumentPosition(browserNotificationsTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      screen.getAllByRole('checkbox').some((checkbox) => checkbox.className.includes('size-11')),
    ).toBe(true);
  });

  it('shows hidden escalation rule counts when the API result is truncated', async () => {
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
              total_count: 3,
              visible_count: 1,
              hidden_count: 2,
              truncated: true,
              count_basis: 'escalation_rules',
              filters_applied: {},
              limit: 1,
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    render(<NotificationSettingsContent />);

    expect(await screen.findByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(screen.getByText('表示中のみ確認中')).toBeTruthy();
    expect(
      screen.getByText(
        '追加のエスカレーションルールが 2件あります。表示中の状態だけで全体の通知設計を判断しないでください。',
      ),
    ).toBeTruthy();
  });

  it('shows inline validation before creating an escalation rule with an invalid threshold', async () => {
    render(<NotificationSettingsContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'ルール追加' }));
    const thresholdInput = screen.getByLabelText('しきい時間');

    fireEvent.change(thresholdInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(screen.getByRole('alert').textContent).toBe(
      'しきい時間は 1〜720 の整数で入力してください',
    );
    expect(thresholdInput.getAttribute('aria-invalid')).toBe('true');
    expect(thresholdInput.getAttribute('aria-describedby')).toContain('escalation-threshold-error');
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/admin/escalation-rules' && init?.method === 'POST',
        ),
    ).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(screen.getByRole('button', { name: 'ルール追加' }));

    const reopenedThresholdInput = screen.getByLabelText('しきい時間');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(reopenedThresholdInput.getAttribute('aria-invalid')).toBeNull();
  });

  it('shows escalation option labels, not raw enum values, in the add-rule dialog selects', async () => {
    // bare <SelectValue /> は非空 enum default(trigger/action/role)の生値を漏らす。
    // 明示 children で日本語ラベルを表示することを固定する(SSR enum 漏れ封止)。
    render(<NotificationSettingsContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'ルール追加' }));

    const trigger = screen.getByLabelText('トリガー');
    expect(trigger.textContent).toContain('連携返信期限超過');
    expect(trigger.textContent).not.toContain('communication_response_overdue');

    const action = screen.getByLabelText('アクション');
    expect(action.textContent).toContain('アプリ内通知');
    expect(action.textContent).not.toContain('in_app_notification');

    const role = screen.getByLabelText('通知先');
    expect(role.textContent).toContain('管理者');
    expect(role.textContent).not.toContain('admin');
  });
});
