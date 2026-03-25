'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  /** If set, user must type this exact text before confirming */
  requiredConfirmText?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '確認',
  cancelLabel = 'キャンセル',
  variant = 'default',
  requiredConfirmText,
  onConfirm,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  const isConfirmDisabled =
    requiredConfirmText !== undefined && inputValue !== requiredConfirmText;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setInputValue('');
    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    if (isConfirmDisabled) return;
    onConfirm();
    onOpenChange(false);
    setInputValue('');
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requiredConfirmText && (
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-input" className="text-sm text-muted-foreground">
              確認のため{' '}
              <span className="font-semibold text-foreground">
                &ldquo;{requiredConfirmText}&rdquo;
              </span>{' '}
              と入力してください
            </Label>
            <Input
              id="confirm-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={requiredConfirmText}
              autoComplete="off"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className={
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
