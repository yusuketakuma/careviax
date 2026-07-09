'use client';

import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export type ConflictDiffField = {
  /** 項目名(例: 記録内容 / 実施結果 / 訪問日)。 */
  label: string;
  /** 確定すると残る側の値。 */
  keepValue: ReactNode;
  /** 確定すると破棄される側の値。 */
  discardValue: ReactNode;
};

export type ConflictDiffDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 不可逆性の説明(例: 「自分の入力は破棄され、元に戻せません。」)。必須。 */
  irreversibleNote: string;
  /** 残す側/破棄側のカラム見出し(例: 残す=サーバーの最新 / 破棄=自分の入力)。 */
  keepLabel: string;
  discardLabel: string;
  /** 確定直前に再掲する差分(何が残り何が失われるか)。非空を型で強制(空配列は渡せない)。 */
  fields: readonly [ConflictDiffField, ...ConflictDiffField[]];
  /** 動詞句の確定ラベル(例: 「最新の内容を残す」)。汎用「確認」禁止(SSOT 5.3)。 */
  confirmLabel: string;
  confirmDisabled?: boolean;
  pending?: boolean;
  /** Provider detailsを含めない、安全な永続エラー文言。 */
  errorMessage?: string;
  onConfirm: () => void;
};

/**
 * 二択の不可逆操作(最新を使う/自分で上書き 等)の共通確認部品(SSOT 5.7)。
 * ConfirmDialog の thin wrapper として focus 既定(Cancel 先頭)・destructive 表現を継承し、
 * 確定直前に「残す/破棄」の差分を構造化再掲する。非同期確定は成功まで閉じない。
 * 画面ローカルの bespoke 確認ボックス再実装は禁止(SSOT 7.1/7.9)。
 */
export function ConflictDiffDialog({
  open,
  onOpenChange,
  title,
  irreversibleNote,
  keepLabel,
  discardLabel,
  fields,
  confirmLabel,
  confirmDisabled = false,
  pending = false,
  errorMessage,
  onConfirm,
}: ConflictDiffDialogProps) {
  function handleOpenChange(nextOpen: boolean) {
    if (pending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={irreversibleNote}
      confirmLabel={pending ? '処理中...' : confirmLabel}
      variant="destructive"
      confirmDisabled={confirmDisabled || pending}
      cancelDisabled={pending}
      closeOnConfirm={false}
      actionClassName="min-h-11 sm:min-h-11"
      onConfirm={onConfirm}
    >
      <div className="space-y-3" aria-busy={pending || undefined}>
        {fields.map((field) => (
          <section
            key={field.label}
            className="rounded-lg border border-border/70 bg-card p-3"
            aria-label={`${field.label}の差分`}
          >
            <h3 className="text-xs font-semibold text-foreground">{field.label}</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-state-done/30 bg-state-done/5 p-2.5">
                <dt className="text-xs font-semibold text-state-done">{keepLabel}（残す）</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap text-sm leading-5 text-foreground">
                  {field.keepValue}
                </dd>
              </div>
              <div className="rounded-md border border-state-blocked/30 bg-state-blocked/5 p-2.5">
                <dt className="text-xs font-semibold text-state-blocked">{discardLabel}（破棄）</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap text-sm leading-5 text-foreground">
                  {field.discardValue}
                </dd>
              </div>
            </dl>
          </section>
        ))}
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md border border-state-blocked/30 bg-state-blocked/10 px-3 py-2 text-sm leading-5 text-state-blocked"
          >
            {errorMessage}
          </p>
        ) : null}
        {pending ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            競合の解決内容を保存しています...
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
