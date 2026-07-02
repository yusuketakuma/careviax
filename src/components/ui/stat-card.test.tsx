// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { StatCard } from '@/components/ui/stat-card';

setupDomTestEnv();

describe('StatCard', () => {
  it('renders label, value (tabular-nums) and unit', () => {
    const { container } = render(<StatCard label="調剤待ち" value={42} unit="件" />);
    expect(screen.getByText('調剤待ち')).toBeTruthy();
    const value = screen.getByText('42');
    expect(value.className).toContain('tabular-nums');
    expect(screen.getByText('件')).toBeTruthy();
    // presentational by default (not a button)
    expect(container.querySelector('button')).toBeNull();
  });

  it('points state with a left border + dot, never a full fill', () => {
    const { container } = render(<StatCard label="期限超過" value={3} role="blocked" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('border-l-state-blocked');
    // no full-area state fill
    expect(root.className).not.toContain('bg-state-blocked');
    expect(container.querySelector('.bg-state-blocked')).toBeTruthy(); // the small dot
  });

  it('maps a tag-family role (info) to its static SSOT accent + dot', () => {
    const { container } = render(<StatCard label="返信待ち" value={2} role="info" />);
    const root = container.firstElementChild as HTMLElement;
    // complete static class strings from STATUS_TOKENS — no dynamic `border-l-tag-${role}`
    expect(root.className).toContain('border-l-tag-info');
    expect(root.className).not.toContain('bg-tag-info'); // no full fill
    expect(container.querySelector('.bg-tag-info')).toBeTruthy(); // dot only
  });

  it('uses a transparent accent when no role is given', () => {
    const { container } = render(<StatCard label="総数" value={120} />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      'border-l-transparent',
    );
  });

  it('can apply value classes without changing the card state role', () => {
    render(<StatCard label="疑義" value={3} valueClassName="text-state-confirm" />);
    expect(screen.getByText('3').className).toContain('text-state-confirm');
  });

  it('can preserve caller-owned heading semantics for labels', () => {
    render(<StatCard label="訪問枠" labelElement="h2" labelClassName="text-sm" value="6 / 10件" />);
    expect(screen.getByRole('heading', { name: '訪問枠', level: 2 }).className).toContain(
      'text-sm',
    );
  });

  it('can show an explicit visible role label while preserving status data-role', () => {
    render(
      <StatCard
        label="スタッフ稼働"
        value="100%"
        role="blocked"
        roleLabel="過負荷"
        showRoleLabel
      />,
    );
    const dot = screen.getByText('過負荷').closest('[data-role]');
    expect(dot?.getAttribute('data-role')).toBe('blocked');
  });

  it('renders a clamped progress bar with the supplied fill class', () => {
    const { container } = render(
      <StatCard
        label="訪問枠"
        value="6 / 10件"
        progress={{ percent: 125, className: 'bg-muted-foreground/45' }}
      />,
    );
    const fill = Array.from(container.querySelectorAll('div')).find((element) =>
      element.className.includes('bg-muted-foreground/45'),
    ) as HTMLElement | undefined;
    expect(fill).toBeTruthy();
    expect(fill?.style.width).toBe('100%');
  });

  it('clamps negative and non-finite progress values to zero', () => {
    const { container, rerender } = render(
      <StatCard label="訪問枠" value="0件" progress={{ percent: -10 }} />,
    );
    const findDefaultFill = () =>
      Array.from(container.querySelectorAll('div')).find((element) =>
        element.className.includes('bg-muted-foreground/45'),
      ) as HTMLElement | undefined;

    expect(findDefaultFill()?.style.width).toBe('0%');

    rerender(<StatCard label="訪問枠" value="0件" progress={{ percent: Number.NaN }} />);
    expect(findDefaultFill()?.style.width).toBe('0%');
  });

  it('can apply responsive classes to icon and hint wrappers', () => {
    const { container } = render(
      <StatCard
        label="外部連携"
        value={3}
        icon={<span data-testid="summary-icon" />}
        iconClassName="hidden sm:inline-flex"
        hint="取得に失敗しました"
        hintClassName="hidden sm:block"
      />,
    );

    const iconWrapper = screen.getByTestId('summary-icon').parentElement;
    const hintWrapper = screen.getByText('取得に失敗しました');
    expect(iconWrapper?.className).toContain('hidden');
    expect(iconWrapper?.className).toContain('sm:inline-flex');
    expect(hintWrapper.className).toContain('hidden');
    expect(hintWrapper.className).toContain('sm:block');
    expect(container.firstElementChild?.textContent).toContain('外部連携');
  });

  it('renders as a filter chip with aria-pressed when onSelect is provided', () => {
    const onSelect = vi.fn();
    render(<StatCard label="疑義" value={5} onSelect={onSelect} active />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('guarantees a 44px touch target for the selectable button', () => {
    render(<StatCard label="疑義" value={5} onSelect={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('min-h-11');
    expect(btn.className).toContain('min-w-11');
  });
});
