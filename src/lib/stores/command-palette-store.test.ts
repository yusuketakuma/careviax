// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { useCommandPaletteStore } from './command-palette-store';

function resetStore() {
  useCommandPaletteStore.setState({ open: false, focusNonce: 0, restoreEl: null });
}

describe('command palette store', () => {
  afterEach(() => {
    resetStore();
    document.body.innerHTML = '';
  });

  it('captures the pre-open focused element as the restore target on first open', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    useCommandPaletteStore.getState().openPalette();

    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useCommandPaletteStore.getState().restoreEl).toBe(opener);
    expect(useCommandPaletteStore.getState().focusNonce).toBe(1);
  });

  it('preserves the original restore target when openPalette runs while already open', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    useCommandPaletteStore.getState().openPalette(); // restoreEl = opener

    // simulate the palette input being focused, then Cmd/Ctrl+K firing again.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const nonceBefore = useCommandPaletteStore.getState().focusNonce;

    useCommandPaletteStore.getState().openPalette(); // already open

    // restoreEl must remain the ORIGINAL opener (not overwritten by the palette input),
    // and focusNonce still increments so the input can be re-focused.
    expect(useCommandPaletteStore.getState().restoreEl).toBe(opener);
    expect(useCommandPaletteStore.getState().focusNonce).toBe(nonceBefore + 1);
  });

  it('closePalette closes the palette', () => {
    useCommandPaletteStore.getState().openPalette();
    useCommandPaletteStore.getState().closePalette();
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });
});
