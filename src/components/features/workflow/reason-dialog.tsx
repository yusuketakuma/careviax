'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Textarea } from '@/components/ui/textarea';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
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

const reasonDialogFormSchema = z.object({
  selectedCode: z.string().min(1, '理由を選択してください'),
  note: z.string(),
});

type ReasonDialogFormValues = z.infer<typeof reasonDialogFormSchema>;

const EMPTY_REASON_DIALOG_FORM: ReasonDialogFormValues = {
  selectedCode: '',
  note: '',
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
  const errorSummaryId = 'reason-dialog-error-summary';
  const form = useForm<ReasonDialogFormValues>({
    resolver: zodResolver(reasonDialogFormSchema),
    defaultValues: EMPTY_REASON_DIALOG_FORM,
  });
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = form;
  const selectedCode = useWatch({ control, name: 'selectedCode' }) ?? '';

  React.useEffect(() => {
    if (open) {
      reset(EMPTY_REASON_DIALOG_FORM);
    }
  }, [open, reset]);

  const selectedOption = options.find((option) => option.code === selectedCode) ?? null;
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    selectedCode: '理由',
    note: 'メモ',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  function onValidSubmit(values: ReasonDialogFormValues) {
    const selected = options.find((option) => option.code === values.selectedCode) ?? null;
    if (!selected) return;
    onSubmit({
      code: selected.code,
      label: selected.label,
      note: values.note.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="reason-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          {/* p0_36/37 は補足文を常時表示する(DialogDescription は ? ポップオーバー化されるため不使用) */}
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onValidSubmit, focusErrorSummary)}
          noValidate
          className="space-y-4"
        >
          <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
          {warning ? (
            <p className="rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-xs leading-5 text-state-confirm">
              {warning}
            </p>
          ) : null}
          <Controller
            control={control}
            name="selectedCode"
            render={({ field }) => (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="理由">
                {options.map((option) => {
                  const selected = option.code === field.value;
                  return (
                    <button
                      key={option.code}
                      type="button"
                      data-testid="reason-option"
                      aria-pressed={selected}
                      onClick={() => field.onChange(option.code)}
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
            )}
          />
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              selectedOption
                ? 'border-primary/30 bg-primary/5 text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground',
            )}
            data-testid="reason-selection-summary"
            aria-live="polite"
          >
            <p className="font-medium">
              {selectedOption ? `選択中: ${selectedOption.label}` : '理由を選択してください'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {selectedOption
                ? 'この理由とメモが履歴に残り、後続担当者が見返せます。'
                : '理由を選ぶまで実行ボタンは押せません。'}
            </p>
          </div>
          <Textarea
            {...register('note')}
            placeholder="メモ(必要な時だけ)"
            aria-label="メモ(必要な時だけ)"
            className="min-h-[96px]"
          />
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
              type="submit"
              className="min-h-11 sm:min-w-36"
              disabled={!selectedOption || pending}
            >
              {pending ? '保存中...' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
