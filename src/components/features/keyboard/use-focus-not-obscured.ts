'use client';

import { useEffect } from 'react';

export type FocusRect = Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left'>;

export type FocusViewport = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type FocusPadding = {
  blockStart: number;
  blockEnd: number;
  inlineStart: number;
  inlineEnd: number;
};

const DEFAULT_PADDING: FocusPadding = {
  blockStart: 72,
  blockEnd: 88,
  inlineStart: 16,
  inlineEnd: 16,
};

const KEYBOARD_NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowRight',
  'ArrowDown',
  'ArrowLeft',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function isKeyboardNavigationKey(key: string) {
  return KEYBOARD_NAVIGATION_KEYS.has(key);
}

export function isFocusRectObscured(
  rect: FocusRect,
  viewport: FocusViewport,
  padding = DEFAULT_PADDING,
) {
  return (
    rect.top < viewport.top + padding.blockStart ||
    rect.bottom > viewport.bottom - padding.blockEnd ||
    rect.left < viewport.left + padding.inlineStart ||
    rect.right > viewport.right - padding.inlineEnd
  );
}

export function useFocusNotObscured(rootId = 'main-content', padding = DEFAULT_PADDING) {
  useEffect(() => {
    let keyboardNavigation = false;
    let frame = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardNavigationKey(event.key)) keyboardNavigation = true;
    };

    const handlePointerInput = () => {
      keyboardNavigation = false;
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!keyboardNavigation) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const root = document.getElementById(rootId);
      if (root && !root.contains(target)) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const viewport = {
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          left: 0,
        };

        if (isFocusRectObscured(target.getBoundingClientRect(), viewport, padding)) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerInput, true);
    document.addEventListener('mousedown', handlePointerInput, true);
    document.addEventListener('touchstart', handlePointerInput, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerInput, true);
      document.removeEventListener('mousedown', handlePointerInput, true);
      document.removeEventListener('touchstart', handlePointerInput, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, [padding, rootId]);
}
