// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DeadlineCountdownLabel } from './dashboard-clock';

setupDomTestEnv();

describe('DeadlineCountdownLabel', () => {
  // 6軸状態色(SSOT 3.1/7.3): 未超過=confirm(橙)・超過=blocked(赤)。raw destructive を
  // 使わないこと、未超過が常時赤にならないこと(SSOT 2.7 alert fatigue)を DOM で固定する。
  it('renders future deadlines with the confirm token (not always-red)', () => {
    const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    render(<DeadlineCountdownLabel dueAt={dueAt} />);

    const label = screen.getByText(/期限/);
    expect(label.className).toContain('text-state-confirm');
    expect(label.className).not.toContain('text-state-blocked');
    expect(label.className).not.toContain('text-destructive');
  });

  it('renders overdue deadlines with the blocked token', () => {
    const dueAt = new Date(Date.now() - 60 * 1000).toISOString();
    render(<DeadlineCountdownLabel dueAt={dueAt} />);

    const label = screen.getByText(/期限超過/);
    expect(label.className).toContain('text-state-blocked');
    expect(label.className).not.toContain('text-state-confirm');
    expect(label.className).not.toContain('text-destructive');
  });
});
