import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { FormErrorSummaryItem } from '@/lib/forms/errors';

type FormErrorSummaryProps = React.ComponentPropsWithoutRef<typeof Alert> & {
  items: FormErrorSummaryItem[];
  title?: string;
  showMessage?: boolean;
  compact?: boolean;
};

export const FormErrorSummary = React.forwardRef<HTMLDivElement, FormErrorSummaryProps>(
  (
    {
      items,
      title = '入力内容を確認してください',
      showMessage = true,
      compact = false,
      className,
      ...props
    },
    ref
  ) => {
    if (items.length === 0) return null;

    return (
      <div ref={ref} tabIndex={-1} className="scroll-mt-20">
        <Alert variant="destructive" className={cn(className)} {...props}>
          <AlertTriangle className="size-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            {compact && !showMessage ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {items.map((item) => (
                  <span
                    key={item.path}
                    className="inline-flex rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.path}>
                    <span className="font-medium">{item.label}</span>
                    {showMessage ? <span>：{item.message}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  },
);

FormErrorSummary.displayName = 'FormErrorSummary';
