// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { SignalTile } from '@/components/ui/signal-tile';

setupDomTestEnv();

describe('SignalTile', () => {
  it('does not point any color when severity is normal', () => {
    const { container } = render(<SignalTile label="API P95" value="320" unit="ms" />);
    const root = container.querySelector('[data-severity]') as HTMLElement;
    expect(root.dataset.severity).toBe('normal');
    expect(root.className).toContain('border-l-foreground/15');
    expect(root.className).not.toContain('border-l-state-confirm');
    expect(root.className).not.toContain('border-l-state-blocked');
    // no badge in normal state
    expect(container.querySelector('[data-role]')).toBeNull();
  });

  it('points amber + 要確認 badge for warning', () => {
    const { container } = render(
      <SignalTile label="API P95" value="620" unit="ms" severity="warning" />,
    );
    const root = container.querySelector('[data-severity]') as HTMLElement;
    expect(root.className).toContain('border-l-state-confirm');
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
    expect(screen.getByText('要確認')).toBeTruthy();
  });

  it('points red + 緊急 badge for critical', () => {
    const { container } = render(<SignalTile label="至急通知" value={4} severity="critical" />);
    expect((container.querySelector('[data-severity]') as HTMLElement).className).toContain(
      'border-l-state-blocked',
    );
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
    expect(screen.getByText('緊急')).toBeTruthy();
  });

  it('renders a skeleton (not a 0) while loading to avoid false-zero', () => {
    const { container } = render(<SignalTile label="至急通知" value={0} loading />);
    expect(container.querySelector('[data-slot="signal-skeleton"]')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('announces loading to assistive tech (aria-busy + sr-only status)', () => {
    const { container } = render(<SignalTile label="至急通知" value={0} loading />);
    const root = container.querySelector('[data-severity]') as HTMLElement;
    expect(root.getAttribute('aria-busy')).toBe('true');
    const status = screen.getByRole('status');
    expect(status.className).toContain('sr-only');
    expect(status.textContent).toBe('読み込み中');
  });

  it('shows an explicit unavailable placeholder (—) when not loading and value is missing', () => {
    const { container } = render(<SignalTile label="至急通知" loading={false} />);
    expect(container.querySelector('[data-slot="signal-unavailable"]')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('データなし')).toBeTruthy();
    // not busy when resolved-but-empty
    expect(
      (container.querySelector('[data-severity]') as HTMLElement).getAttribute('aria-busy'),
    ).toBeNull();
  });

  it('never uses a full-area state background fill', () => {
    const { container } = render(<SignalTile label="x" value={1} severity="critical" />);
    const root = container.querySelector('[data-severity]') as HTMLElement;
    expect(root.className).not.toContain('bg-state-blocked');
    expect(root.className).toContain('bg-card');
  });
});
