// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PhiMaskField } from '@/components/ui/phi-mask-field';

setupDomTestEnv();

describe('PhiMaskField', () => {
  it('masks the value by default and exposes no real value', () => {
    const { container } = render(<PhiMaskField label="電話番号" value="090-1234-5678" />);
    expect(container.querySelector('[data-slot="phi-masked"]')).toBeTruthy();
    expect(screen.queryByText('090-1234-5678')).toBeNull();
    expect(screen.getByText('保護済み')).toBeTruthy();
  });

  it('shows no reveal toggle when canReveal is false', () => {
    render(<PhiMaskField label="住所" value="東京都..." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reveals the real value via the toggle when canReveal is true', () => {
    render(<PhiMaskField label="保険者番号" value="01130012" canReveal />);
    expect(screen.queryByText('01130012')).toBeNull();
    const toggle = screen.getByRole('button', { name: '保険者番号を表示' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText('01130012')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '保険者番号を隠す' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('distinguishes "記録なし" from a masked value (no false-empty)', () => {
    render(<PhiMaskField label="FAX" value={null} canReveal />);
    expect(screen.getByText('記録なし')).toBeTruthy();
    // nothing to reveal when there is no value
    expect(screen.queryByRole('button')).toBeNull();
  });
});
