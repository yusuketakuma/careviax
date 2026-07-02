// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFocusRectObscured,
  isKeyboardNavigationKey,
  useFocusNotObscured,
} from './use-focus-not-obscured';

function FocusHarness() {
  useFocusNotObscured('main-content', {
    blockStart: 10,
    blockEnd: 10,
    inlineStart: 10,
    inlineEnd: 10,
  });

  return (
    <main id="main-content">
      <button type="button">target</button>
    </main>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('focus visibility helpers', () => {
  it('detects keyboard navigation keys', () => {
    expect(isKeyboardNavigationKey('Tab')).toBe(true);
    expect(isKeyboardNavigationKey('ArrowDown')).toBe(true);
    expect(isKeyboardNavigationKey('a')).toBe(false);
  });

  it('treats focus near fixed chrome as obscured', () => {
    expect(
      isFocusRectObscured(
        { top: 2, right: 120, bottom: 42, left: 20 },
        { top: 0, right: 320, bottom: 480, left: 0 },
        { blockStart: 56, blockEnd: 72, inlineStart: 0, inlineEnd: 0 },
      ),
    ).toBe(true);
  });

  it('accepts focus fully inside the padded viewport', () => {
    expect(
      isFocusRectObscured(
        { top: 80, right: 120, bottom: 124, left: 20 },
        { top: 0, right: 320, bottom: 480, left: 0 },
        { blockStart: 56, blockEnd: 72, inlineStart: 0, inlineEnd: 0 },
      ),
    ).toBe(false);
  });
});

describe('useFocusNotObscured', () => {
  it('scrolls newly focused keyboard targets into view when sticky chrome would hide them', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });

    render(<FocusHarness />);

    const target = screen.getByRole('button', { name: 'target' });
    target.getBoundingClientRect = vi.fn(() => ({
      top: 236,
      right: 120,
      bottom: 280,
      left: 20,
      width: 100,
      height: 44,
      x: 20,
      y: 236,
      toJSON: () => ({}),
    }));
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    fireEvent.keyDown(document, { key: 'Tab' });
    target.focus();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
