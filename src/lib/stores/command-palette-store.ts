import { create } from 'zustand';

/**
 * F-009 グローバル検索コマンドパレットの開閉状態。
 *
 * - query は持たない(入力状態はコンポーネントローカル)。再オープン時に query を
 *   保持したまま input を再フォーカスするため、focusNonce のインクリメントで
 *   「再フォーカス要求」を表現する。
 */
interface CommandPaletteState {
  open: boolean;
  /** openPalette のたびに増える。input 再フォーカスのトリガとして購読する。 */
  focusNonce: number;
  /** open 直前にフォーカスしていた要素(close 時にここへ復帰)。イベントハンドラ内で捕捉。 */
  restoreEl: HTMLElement | null;
  openPalette: () => void;
  closePalette: () => void;
}

/** open を要求した瞬間(イベントハンドラ内)のフォーカス要素を捕捉する。 */
function captureActiveElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  focusNonce: 0,
  restoreEl: null,
  openPalette: () =>
    set((state) => ({
      open: true,
      focusNonce: state.focusNonce + 1,
      // 既に開いている場合は元の復帰先(restoreEl)を保持する。
      // 開状態で ⌘K を押すとパレット input が activeElement になっており、
      // それで上書きすると close 時に元の起点へ戻れなくなるため。
      restoreEl: state.open ? state.restoreEl : captureActiveElement(),
    })),
  closePalette: () => set({ open: false }),
}));
