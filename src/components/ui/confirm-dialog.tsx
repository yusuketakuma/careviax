'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
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
  confirmDisabled?: boolean;
  closeOnConfirm?: boolean;
  /**
   * 開封時に確定操作へフォーカスを寄せ、Enter で確定できるようにする（不可逆 sign-off 用）。
   * `requiredConfirmText` 無し: 確定ボタンへ自動フォーカスし Enter で確定。
   * `requiredConfirmText` 有り: 確認入力欄へ自動フォーカスし、一致時のみ Enter で確定（IME 変換確定中は除外）。
   * 既定 false では従来挙動（Base UI 既定のフォーカス）を完全保持する。
   */
  autoFocusConfirm?: boolean;
  children?: ReactNode;
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
  confirmDisabled = false,
  closeOnConfirm = true,
  autoFocusConfirm = false,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const confirmInputId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  const isConfirmDisabled =
    confirmDisabled || (requiredConfirmText !== undefined && inputValue !== requiredConfirmText);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setInputValue('');
    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    if (isConfirmDisabled) return;
    onConfirm();
    if (closeOnConfirm) {
      onOpenChange(false);
      setInputValue('');
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        {...(autoFocusConfirm
          ? { initialFocus: requiredConfirmText !== undefined ? confirmInputRef : confirmButtonRef }
          : {})}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {children ? <div className="py-2">{children}</div> : null}

        {requiredConfirmText && (
          <div className="space-y-2 py-2">
            <Label htmlFor={confirmInputId} className="text-sm text-muted-foreground">
              確認のため{' '}
              <span className="font-semibold text-foreground">
                &ldquo;{requiredConfirmText}&rdquo;
              </span>{' '}
              と入力してください
            </Label>
            <Input
              ref={confirmInputRef}
              id={confirmInputId}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              {...(autoFocusConfirm
                ? {
                    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !isConfirmDisabled) {
                        e.preventDefault();
                        handleConfirm();
                      }
                    },
                  }
                : {})}
              placeholder={requiredConfirmText}
              autoComplete="off"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmButtonRef}
            onClick={handleConfirm}
            {...(autoFocusConfirm
              ? {
                  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
                    if (e.key === 'Enter' && !isConfirmDisabled) {
                      e.preventDefault();
                      handleConfirm();
                    }
                  },
                }
              : {})}
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
