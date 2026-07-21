type MockConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onOpenChange?: (open: boolean) => void;
};

export function MockConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmDisabled,
  onConfirm,
  onOpenChange,
}: MockConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      aria-describedby="confirm-dialog-description"
      data-testid="confirm-dialog"
    >
      <p data-testid="confirm-dialog-title">{title}</p>
      {description !== undefined ? (
        <p id="confirm-dialog-description" data-testid="confirm-dialog-description">
          {description}
        </p>
      ) : null}
      <button type="button" onClick={() => onOpenChange?.(false)}>
        {cancelLabel ?? 'キャンセル'}
      </button>
      <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel ?? '確認'}
      </button>
    </div>
  );
}
