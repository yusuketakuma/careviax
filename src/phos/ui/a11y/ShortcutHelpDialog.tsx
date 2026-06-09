'use client';

import { Keyboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhosShortcutHelpCopy, PhosShortcutHelpRows } from '@/phos/contracts/phos_copy.ja';

export type ShortcutHelpDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function ShortcutHelpDialog({ open, onOpenChange }: ShortcutHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(520px,calc(100vw-1.5rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" aria-hidden="true" />
            {PhosShortcutHelpCopy.TITLE}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{PhosShortcutHelpCopy.DESCRIPTION}</p>
        <dl className="divide-y divide-border/70 rounded-md border border-border/70 bg-card">
          {PhosShortcutHelpRows.map((row) => (
            <div key={row.keys} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-3 py-3">
              <dt className="font-mono text-sm font-semibold text-foreground">{row.keys}</dt>
              <dd className="text-sm text-muted-foreground">{row.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
