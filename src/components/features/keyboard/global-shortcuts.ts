import { type ShortcutDefinition } from './use-keyboard-shortcuts';

/**
 * All shortcut definitions (for display in help modal).
 * Actual handlers are bound in respective components;
 * these are used only for the help modal display.
 */
export const GLOBAL_SHORTCUTS: ShortcutDefinition[] = [
  // Global
  { key: 'k', metaKey: true, handler: () => {}, description: '全体検索を開く', scope: 'global' },
  { key: '/', handler: () => {}, description: '全体検索を開く', scope: 'global' },
  { key: 'n', metaKey: true, handler: () => {}, description: '新規作成', scope: 'global' },
  { key: '?', handler: () => {}, description: 'ショートカット一覧', scope: 'global' },
  { key: 'Escape', handler: () => {}, description: 'モーダルを閉じる', scope: 'global' },

  // Shared roving-focus groups
  { key: 'Tab', handler: () => {}, description: '次の操作グループへ移動', scope: 'navigation' },
  {
    key: 'ArrowRight',
    handler: () => {},
    description: '同じ操作グループ内で次へ移動',
    scope: 'navigation',
  },
  {
    key: 'ArrowLeft',
    handler: () => {},
    description: '同じ操作グループ内で前へ移動',
    scope: 'navigation',
  },
  { key: 'Home', handler: () => {}, description: '操作グループの先頭へ移動', scope: 'navigation' },
  { key: 'End', handler: () => {}, description: '操作グループの末尾へ移動', scope: 'navigation' },

  // Dispensing queue
  { key: 'ArrowUp', handler: () => {}, description: '前の行へ移動', scope: 'dispensing' },
  { key: 'ArrowDown', handler: () => {}, description: '次の行へ移動', scope: 'dispensing' },
  { key: 'Enter', handler: () => {}, description: '選択した行を開く', scope: 'dispensing' },
  {
    key: 'Enter',
    metaKey: true,
    handler: () => {},
    description: '選択行を完了',
    scope: 'dispensing',
  },

  // Auditing
  { key: 'ArrowUp', handler: () => {}, description: '前の行へ移動', scope: 'auditing' },
  { key: 'ArrowDown', handler: () => {}, description: '次の行へ移動', scope: 'auditing' },
  { key: 'Enter', handler: () => {}, description: '選択した行を開く', scope: 'auditing' },
  { key: 'Tab', handler: () => {}, description: 'ペイン切替', scope: 'auditing' },
  { key: 'a', handler: () => {}, description: '承認', scope: 'auditing' },
  { key: 'r', handler: () => {}, description: '差戻し', scope: 'auditing' },
  { key: ' ', handler: () => {}, description: 'チェック項目トグル', scope: 'auditing' },
];
