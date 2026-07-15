// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { OfflineDraftIndicator } from './offline-draft-indicator';

setupDomTestEnv();

describe('OfflineDraftIndicator', () => {
  it.each([
    ['checking', '同期状況を確認中'],
    ['offline', 'オフライン'],
    ['conflict', '競合あり'],
    ['failed', '同期失敗'],
    ['syncing', '同期中'],
    ['pending', '同期待ち'],
  ] as const)('renders the exclusive %s recovery state', (status, label) => {
    render(<OfflineDraftIndicator status={status} pendingCount={2} />);

    const link = screen.getByRole('link', { name: /同期状況を開く/ });
    expect(link.textContent).toContain(label);
    expect(link.textContent).not.toContain('同期済み');
    expect(link.getAttribute('href')).toBe('/offline-sync');
    expect(link.getAttribute('aria-label')).toContain('同期状況を開く');
    expect(link.className).toContain(status === 'checking' ? 'hidden' : 'flex');
    expect(link.className).toContain('min-h-[44px]');
    expect(link.className).toContain('min-w-[44px]');
    if (status !== 'checking') {
      expect(screen.getByText(label).className).not.toContain('hidden');
    }
  });

  it('labels an old timestamp as the previous successful sync', () => {
    render(<OfflineDraftIndicator status="synced" pendingCount={0} lastSyncedLabel="09:42" />);

    const link = screen.getByRole('link', { name: /同期状況を開く/ });
    expect(link.textContent).toBe('同期済み最終成功 09:42');
    expect(link.getAttribute('aria-label')).toContain('最終成功09:42');
    expect(link.className).toContain('hidden');
  });
});
