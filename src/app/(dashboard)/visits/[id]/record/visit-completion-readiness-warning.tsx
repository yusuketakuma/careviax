import { AlertTriangle } from 'lucide-react';

type CompletionReadinessItem = {
  label: string;
};

export function VisitCompletionReadinessWarning({ items }: { items: CompletionReadinessItem[] }) {
  const visibleLabels = items
    .slice(0, 5)
    .map((item) => item.label)
    .join(' / ');

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-xl border border-state-confirm/30 bg-state-confirm/10 px-4 py-3 text-sm text-state-confirm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-state-confirm" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">訪問完了前に必須確認が残っています</p>
          <p>{visibleLabels}</p>
          <p className="text-xs">
            完了・課題あり完了・再訪問必要で保存する場合は、訪問薬剤管理セクションで確認を完了してください。
          </p>
        </div>
      </div>
    </div>
  );
}
