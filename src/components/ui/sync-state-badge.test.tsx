// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { SyncStateBadge } from '@/components/ui/sync-state-badge';
import { OFFLINE_SYNC_STATUS_ROLE } from '@/lib/constants/status-labels';
import { getOfflineSyncStatusEntry } from '@/lib/constants/visual-status-registry';

setupDomTestEnv();

describe('SyncStateBadge', () => {
  // SSOT 6.6 / 確定表「オフライン同期状態」の写像を DOM で固定する。
  it('pins the ratified 6.6 role map', () => {
    expect(OFFLINE_SYNC_STATUS_ROLE).toEqual({
      saved_locally: 'info',
      queued: 'info',
      failed: 'blocked',
      synced: 'done',
      conflict: 'confirm',
    });
  });

  it('renders the default action-based labels with their roles', () => {
    const { container } = render(
      <>
        <SyncStateBadge status="saved_locally" />
        <SyncStateBadge status="failed" />
        <SyncStateBadge status="synced" />
      </>,
    );

    expect(screen.getByText('端末保存済')).toBeTruthy();
    expect(screen.getByText('送信失敗')).toBeTruthy();
    expect(screen.getByText('同期済み')).toBeTruthy();
    // 送信失敗=blocked が最も目立つ役割で描かれる(6.6: 常時表示・false-success 防止)。
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
    expect(container.querySelector('[data-role="done"]')).toBeTruthy();
  });

  it('allows payload-provided labels while owning the role mapping', () => {
    const { container } = render(<SyncStateBadge status="conflict">サーバー競合</SyncStateBadge>);

    expect(screen.getByText('サーバー競合')).toBeTruthy();
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
  });

  it('derives its role and default label from the central registry', () => {
    expect(getOfflineSyncStatusEntry('failed')).toMatchObject({
      label: '送信失敗',
      role: 'blocked',
      component: 'SyncStateBadge',
    });
  });
});
