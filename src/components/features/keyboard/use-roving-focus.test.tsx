// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRovingFocus, getRovingFocusTargetIndex } from './use-roving-focus';

function RovingHarness() {
  const roving = useRovingFocus<HTMLButtonElement>({ itemCount: 3, orientation: 'both' });

  return (
    <div role="toolbar" aria-label="操作">
      {[0, 1, 2].map((index) => (
        <button key={index} type="button" {...roving.getItemProps(index)}>
          item {index + 1}
        </button>
      ))}
    </div>
  );
}

describe('getRovingFocusTargetIndex', () => {
  it('wraps arrow-key movement by default', () => {
    expect(
      getRovingFocusTargetIndex({
        currentIndex: 2,
        itemCount: 3,
        key: 'ArrowRight',
      }),
    ).toBe(0);
    expect(
      getRovingFocusTargetIndex({
        currentIndex: 0,
        itemCount: 3,
        key: 'ArrowLeft',
      }),
    ).toBe(2);
  });

  it('keeps Home and End deterministic', () => {
    expect(getRovingFocusTargetIndex({ currentIndex: 1, itemCount: 3, key: 'Home' })).toBe(0);
    expect(getRovingFocusTargetIndex({ currentIndex: 1, itemCount: 3, key: 'End' })).toBe(2);
  });

  it('ignores keys outside the configured orientation', () => {
    expect(
      getRovingFocusTargetIndex({
        currentIndex: 1,
        itemCount: 3,
        key: 'ArrowDown',
        orientation: 'horizontal',
      }),
    ).toBe(1);
  });
});

describe('useRovingFocus', () => {
  it('keeps one tab stop and moves focus with arrow keys', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    render(<RovingHarness />);

    const first = screen.getByRole('button', { name: 'item 1' });
    const second = screen.getByRole('button', { name: 'item 2' });
    const third = screen.getByRole('button', { name: 'item 3' });

    expect(first).toHaveProperty('tabIndex', 0);
    expect(second).toHaveProperty('tabIndex', -1);
    expect(third).toHaveProperty('tabIndex', -1);

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(second);
    expect(first).toHaveProperty('tabIndex', -1);
    expect(second).toHaveProperty('tabIndex', 0);

    fireEvent.keyDown(second, { key: 'End' });
    expect(document.activeElement).toBe(third);
  });
});
