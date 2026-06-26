// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AlertTier } from '@/components/ui/alert-tier';

setupDomTestEnv();

describe('AlertTier', () => {
  it('renders critical as an assertive alert with red accent (only tier that interrupts)', () => {
    const { container } = render(<AlertTier level="critical">相互作用: 重大</AlertTier>);
    const root = container.querySelector('[data-level="critical"]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('alert');
    expect(root.className).toContain('border-l-state-blocked');
    expect(screen.getByText('緊急')).toBeTruthy();
  });

  it('renders warning as a polite status (not assertive) with amber accent — avoids over-announcing', () => {
    const { container } = render(<AlertTier level="warning" title="残薬要確認" />);
    const root = container.querySelector('[data-level="warning"]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.className).toContain('border-l-state-confirm');
    expect(screen.getByText('残薬要確認')).toBeTruthy();
  });

  it('renders status without a live region (no announcement)', () => {
    const { container } = render(<AlertTier level="status" title="下書き保存済み" />);
    const root = container.querySelector('[data-level="status"]') as HTMLElement;
    expect(root.getAttribute('role')).toBeNull();
    expect(root.className).toContain('border-l-foreground/20');
  });

  it('renders reminder as a polite status with blue accent', () => {
    const { container } = render(<AlertTier level="reminder" title="次回訪問 7/3" />);
    const root = container.querySelector('[data-level="reminder"]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.className).toContain('border-l-tag-info');
  });

  it('never uses a full-area state background fill (minimal paint)', () => {
    const { container } = render(<AlertTier level="critical" title="x" />);
    const root = container.querySelector('[data-level="critical"]') as HTMLElement;
    expect(root.className).not.toContain('bg-state-blocked');
    expect(root.className).toContain('bg-card');
  });

  it('renders an action slot', () => {
    render(<AlertTier level="warning" title="x" action={<button type="button">解消</button>} />);
    expect(screen.getByRole('button', { name: '解消' })).toBeTruthy();
  });
});
