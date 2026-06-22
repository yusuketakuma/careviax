// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { StateBadge } from '@/components/ui/state-badge';
import { StatusDot } from '@/components/ui/status-dot';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';

setupDomTestEnv();

const ROLES = Object.keys(STATUS_TOKENS) as StatusRole[];
const tokenPrefix = (role: StatusRole) =>
  role === 'hazard' || role === 'info' ? `tag-${role}` : `state-${role}`;

describe('StateBadge', () => {
  it.each(ROLES)('renders visible label + icon for "%s"', (role) => {
    const { container } = render(<StateBadge role={role}>ラベル</StateBadge>);
    // text present (state is never communicated by colour alone)
    expect(screen.getByText('ラベル')).toBeTruthy();
    // icon present (colour + icon redundancy)
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it.each(ROLES)('falls back to the semantic label for "%s"', (role) => {
    render(<StateBadge role={role} />);
    expect(screen.getByText(STATUS_TOKENS[role].label)).toBeTruthy();
  });

  it.each(ROLES)('applies the readable role badge contract for "%s"', (role) => {
    const { container } = render(<StateBadge role={role} />);
    const el = container.querySelector('[data-role]') as HTMLElement;
    // State is carried by icon, role data, tinted surface, and ring; text uses foreground for AA contrast.
    expect(el.dataset.role).toBe(role);
    expect(el.className).toContain(`bg-${tokenPrefix(role)}/15`);
    expect(el.className).toContain('text-foreground');
    expect(el.className).toContain('ring-1');
    expect(el.className).toContain(`ring-${tokenPrefix(role)}/25`);
  });

  it('omits the icon when showIcon=false', () => {
    const { container } = render(
      <StateBadge role="blocked" showIcon={false}>
        x
      </StateBadge>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('StatusDot', () => {
  it.each(ROLES)('carries an sr-only label for "%s"', (role) => {
    render(<StatusDot role={role} />);
    expect(screen.getByText(STATUS_TOKENS[role].label).className).toContain('sr-only');
  });

  it('marks the dot decorative and colours it with the role token', () => {
    const { container } = render(<StatusDot role="done" />);
    const dot = container.querySelector('[aria-hidden]');
    expect(dot).toBeTruthy();
    expect(dot?.className).toContain('bg-state-done');
  });

  it('accepts a custom label', () => {
    render(<StatusDot role="waiting" label="薬剤師待ち" />);
    expect(screen.getByText('薬剤師待ち')).toBeTruthy();
  });
});
