'use client';

import { useEffect, useCallback } from 'react';

export type ShortcutDefinition = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  handler: () => void;
  description: string;
  scope: 'global' | 'navigation' | 'dispensing' | 'auditing' | 'qr-drafts' | 'prescriptions';
};

/**
 * Returns true if the active element is a text input or contenteditable,
 * meaning single-key shortcuts should be suppressed.
 */
function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Registers keyboard shortcuts via a keydown event listener.
 * - Shortcuts with metaKey/ctrlKey always fire (global modifiers).
 * - Shortcuts without modifiers are suppressed when focus is in an editable field.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const keyMatch =
          e.key === shortcut.key || e.key.toLowerCase() === shortcut.key.toLowerCase();
        if (!keyMatch) continue;

        // Check modifier keys
        const wantsMeta = !!shortcut.metaKey;
        const wantsCtrl = !!shortcut.ctrlKey;
        // Accept Cmd on Mac or Ctrl on Windows/Linux
        const metaPressed = e.metaKey || e.ctrlKey;

        if (wantsMeta && !metaPressed) continue;
        if (!wantsMeta && !wantsCtrl && (e.metaKey || e.ctrlKey || e.altKey)) continue;

        // Suppress single-key shortcuts when typing in an input
        const hasModifier = wantsMeta || wantsCtrl;
        if (!hasModifier && isEditableElement(document.activeElement)) continue;

        e.preventDefault();
        e.stopPropagation();
        shortcut.handler();
        return;
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
