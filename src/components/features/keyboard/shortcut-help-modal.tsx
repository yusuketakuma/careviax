'use client';

import { type ShortcutDefinition } from './use-keyboard-shortcuts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ShortcutHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutDefinition[];
}

const SCOPE_LABELS: Record<string, string> = {
  global: 'グローバル',
  dispensing: '調剤キュー',
  auditing: '調剤鑑査',
  'qr-drafts': 'QR下書き',
  prescriptions: '処方受付',
};

function formatKey(shortcut: ShortcutDefinition): string {
  const parts: string[] = [];
  if (shortcut.metaKey)
    parts.push(
      typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '\u2318' : 'Ctrl',
    );
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.shiftKey) parts.push('Shift');

  const keyLabels: Record<string, string> = {
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    Enter: 'Enter',
    ' ': 'Space',
    Escape: 'Esc',
    Tab: 'Tab',
    '?': '?',
  };
  parts.push(keyLabels[shortcut.key] ?? shortcut.key.toUpperCase());

  return parts.join(' + ');
}

export function ShortcutHelpModal({ open, onOpenChange, shortcuts }: ShortcutHelpModalProps) {
  // Group shortcuts by scope
  const grouped = shortcuts.reduce<Record<string, ShortcutDefinition[]>>((acc, s) => {
    const scope = s.scope;
    if (!acc[scope]) acc[scope] = [];
    acc[scope].push(s);
    return acc;
  }, {});

  const scopeOrder = ['global', 'dispensing', 'auditing', 'qr-drafts', 'prescriptions'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>キーボードショートカット</DialogTitle>
          <DialogDescription>利用可能なキーボードショートカットの一覧です</DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-4 overflow-y-auto">
          {scopeOrder.map((scope) => {
            const items = grouped[scope];
            if (!items || items.length === 0) return null;
            return (
              <div key={scope}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SCOPE_LABELS[scope] ?? scope}
                </h3>
                <div className="space-y-1">
                  {items.map((s, i) => (
                    <div
                      key={`${scope}-${i}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
                    >
                      <span className="text-foreground">{s.description}</span>
                      <kbd className="ml-4 shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {formatKey(s)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
