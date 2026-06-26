// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ExpiryBadge, classifyExpiry } from '@/components/ui/expiry-badge';

setupDomTestEnv();

const NOW = new Date('2026-06-26T00:00:00Z');

describe('classifyExpiry', () => {
  it('classifies a past date as expired', () => {
    expect(classifyExpiry('2026-06-20', 30, NOW)).toEqual({ status: 'expired', days: -6 });
  });

  it('classifies a near-future date within the window as due-soon', () => {
    expect(classifyExpiry('2026-07-10', 30, NOW).status).toBe('due-soon');
  });

  it('classifies today as due-soon (0 days)', () => {
    expect(classifyExpiry('2026-06-26', 30, NOW)).toEqual({ status: 'due-soon', days: 0 });
  });

  it('classifies a far-future date as ok', () => {
    expect(classifyExpiry('2026-12-31', 30, NOW).status).toBe('ok');
  });

  it('classifies null / empty as unset (truly absent)', () => {
    expect(classifyExpiry(null, 30, NOW).status).toBe('unset');
    expect(classifyExpiry(undefined, 30, NOW).status).toBe('unset');
    expect(classifyExpiry('', 30, NOW).status).toBe('unset');
  });

  it('classifies an unparseable date as invalid, separate from unset (no false-empty)', () => {
    expect(classifyExpiry('not-a-date', 30, NOW).status).toBe('invalid');
    expect(classifyExpiry(new Date('garbage'), 30, NOW).status).toBe('invalid');
  });

  it('respects a custom warn window', () => {
    expect(classifyExpiry('2026-07-10', 7, NOW).status).toBe('ok');
    expect(classifyExpiry('2026-07-10', 60, NOW).status).toBe('due-soon');
  });
});

describe('ExpiryBadge', () => {
  it('shows an expired label with red (blocked) role', () => {
    const { container } = render(<ExpiryBadge date="2026-06-20" now={NOW} />);
    expect(screen.getByText(/期限切れ/)).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });

  it('shows a due-soon countdown with amber (confirm) role', () => {
    const { container } = render(<ExpiryBadge date="2026-07-10" now={NOW} />);
    expect(screen.getByText(/あと\d+日/)).toBeTruthy();
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
  });

  it('shows "期限未設定" with neutral (readonly) role when no date', () => {
    const { container } = render(<ExpiryBadge date={null} now={NOW} />);
    expect(screen.getByText('期限未設定')).toBeTruthy();
    expect(container.querySelector('[data-role="readonly"]')).toBeTruthy();
  });

  it('shows "期限日を確認" with amber (confirm) role for an invalid date — not as 未設定', () => {
    const { container } = render(<ExpiryBadge date="not-a-date" now={NOW} />);
    expect(screen.getByText('期限日を確認')).toBeTruthy();
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
    expect(screen.queryByText('期限未設定')).toBeNull();
  });

  it('returns null for ok status when hideWhenOk is set', () => {
    const { container } = render(<ExpiryBadge date="2026-12-31" now={NOW} hideWhenOk />);
    expect(container.querySelector('[data-role]')).toBeNull();
  });
});
