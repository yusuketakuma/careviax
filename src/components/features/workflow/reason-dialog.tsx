'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * p0_36(差し戻し理由)/ p0_37(取消・再開の理由)共通の理由入力モーダル。
 * 理由はチップの単一選択(必須)、メモは任意。保存で {code, label, note} を返す。
 * 差戻し・取消・再開など「あとで見返す」操作の理由記録に使い回す。
 */

export type ReasonOption = {
  code: string;
  label: string;
};

export type ReasonSubmission = {
  code: string;
  label: string;
  note: string;
};

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  options: readonly ReasonOption[];
  onSubmit: (selection: ReasonSubmission) => void;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  /** 操作の影響(差戻し後は再計画が必要 等)を知らせる注記。 */
  warning?: React.ReactNode;
};

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description = '理由を選ぶと、あとで見返しやすくなります。',
  options,
  onSubmit,
  submitLabel = '保存する',
  cancelLabel = '戻る',
  pending = false,
  warning,
}: ReasonDialogProps) {
  const [selectedCode, setSelectedCode] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');

  // 開き直すたびに前回の選択・メモを持ち越さない
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSelectedCode(null);
      setNote('');
    }
  }

  const selectedOption = options.find((option) => option.code === selectedCode) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="reason-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          {/* p0_36/37 は補足文を常時表示する(DialogDescription は ? ポップオーバー化されるため不使用) */}
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>
        <div className="space-y-4">
          {warning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              {warning}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="理由">
            {options.map((option) => {
              const selected = option.code === selectedCode;
              return (
                <button
                  key={option.code}
                  type="button"
                  data-testid="reason-option"
                  aria-pressed={selected}
                  onClick={() => setSelectedCode(option.code)}
                  className={cn(
                    'min-h-11 rounded-lg border px-4 py-2.5 text-left text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary/50 bg-primary/5 text-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted/40',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="メモ(必要な時だけ)"
            aria-label="メモ(必要な時だけ)"
            className="min-h-[96px]"
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-w-36"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className="min-h-11 sm:min-w-36"
            disabled={!selectedOption || pending}
            onClick={() => {
              if (!selectedOption) return;
              onSubmit({
                code: selectedOption.code,
                label: selectedOption.label,
                note: note.trim(),
              });
            }}
          >
            {pending ? '保存中...' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
