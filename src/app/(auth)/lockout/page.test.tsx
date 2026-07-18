// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import LockoutPage from './page';

setupDomTestEnv();

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

describe('LockoutPage', () => {
  // SSOT 6.3: lockout の連絡先・解除時間にプレースホルダ固定値を出さない。
  it('does not fabricate placeholder contact details or a fixed unlock time', () => {
    const { container } = render(<LockoutPage />);

    expect(container.innerHTML).not.toContain('XXXX');
    expect(container.innerHTML).not.toContain('example-pharmacy');
    expect(container.innerHTML).not.toContain('30分');
    // 実在しないロック解除機能を約束しない(SSOT 2.11)。解除UIは存在しないため文言禁止。
    expect(container.innerHTML).not.toContain('ロックを解除できます');
  });

  it('falls back to honest facility-admin guidance when no support contact is configured', () => {
    const { container } = render(<LockoutPage />);

    expect(
      screen.getByText(
        /ご利用の施設のシステム管理者にお問い合わせください。本人確認後の対応を依頼してください/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /ログイン画面に戻る/ })).toBeTruthy();
    expect(container.querySelector('a button')).toBeNull();
  });
});
