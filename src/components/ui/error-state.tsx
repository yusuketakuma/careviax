import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, Ban, CloudOff, FileQuestion, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ErrorStateVariant = 'not-found' | 'server' | 'network' | 'forbidden' | 'unauthorized';
type ErrorStateLive = 'off' | 'polite' | 'assertive';

type ErrorStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg';
};

type ErrorStateProps = {
  variant?: ErrorStateVariant;
  title?: string;
  description?: string;
  detail?: ReactNode;
  action?: ErrorStateAction;
  secondaryAction?: ErrorStateAction;
  size?: 'inline' | 'page';
  headingLevel?: 1 | 2 | 3 | 4;
  live?: ErrorStateLive;
  className?: string;
};

const VARIANT_META = {
  'not-found': {
    icon: FileQuestion,
    title: 'ページが見つかりません',
    description: 'お探しのページは存在しないか、移動された可能性があります。',
    iconClassName: 'bg-muted text-muted-foreground',
  },
  server: {
    icon: AlertTriangle,
    title: 'サーバーエラーが発生しました',
    description: '予期しないエラーが発生しました。しばらく経ってからもう一度お試しください。',
    iconClassName: 'bg-destructive/10 text-destructive',
  },
  network: {
    icon: CloudOff,
    title: 'ネットワークに接続できません',
    description:
      '接続を確認してから再読み込みしてください。オフライン中は一部の画面のみ利用できます。',
    iconClassName: 'bg-amber-100 text-amber-700',
  },
  forbidden: {
    icon: Ban,
    title: 'この画面へのアクセス権限がありません',
    description:
      '組織またはロールの権限設定を確認してください。RLS 制約により表示できない場合があります。',
    iconClassName: 'bg-amber-100 text-amber-700',
  },
  unauthorized: {
    icon: LockKeyhole,
    title: 'ログインが必要です',
    description: 'セッションが切れているか、認証が完了していません。再度ログインしてください。',
    iconClassName: 'bg-blue-100 text-blue-700',
  },
} satisfies Record<
  ErrorStateVariant,
  {
    icon: typeof FileQuestion;
    title: string;
    description: string;
    iconClassName: string;
  }
>;

function renderAction(action: ErrorStateAction) {
  if (action.href) {
    return (
      <Button
        asChild
        type="button"
        variant={action.variant ?? 'default'}
        size={action.size ?? 'default'}
      >
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={action.variant ?? 'default'}
      size={action.size ?? 'default'}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

function ErrorStateHeading({
  level,
  className,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  className: string;
  children: ReactNode;
}) {
  switch (level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
  }
}

export function ErrorState({
  variant = 'server',
  title,
  description,
  detail,
  action,
  secondaryAction,
  size = 'inline',
  headingLevel,
  live = 'polite',
  className,
}: ErrorStateProps) {
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  const resolvedHeadingLevel = headingLevel ?? (size === 'page' ? 1 : 2);
  const headingClassName = cn(
    'font-semibold text-foreground',
    size === 'page' ? 'text-2xl' : 'text-lg',
  );
  const headingText = title ?? meta.title;
  const bodyText = description ?? meta.description;
  const liveRegionProps =
    live === 'off'
      ? {}
      : {
          role: live === 'assertive' ? 'alert' : 'status',
          'aria-live': live,
          'aria-atomic': true,
        };

  return (
    <div
      {...liveRegionProps}
      className={cn(
        'flex flex-col items-center justify-center gap-5 text-center',
        size === 'page'
          ? 'min-h-screen px-8 py-12'
          : 'rounded-xl border border-dashed border-border bg-card px-6 py-10',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          size === 'page' ? 'h-20 w-20' : 'h-14 w-14',
          meta.iconClassName,
        )}
      >
        <Icon className={size === 'page' ? 'h-10 w-10' : 'h-7 w-7'} aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-center">
          <ErrorStateHeading level={resolvedHeadingLevel} className={headingClassName}>
            {headingText}
          </ErrorStateHeading>
        </div>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground">{bodyText}</p>
        {detail ? <div className="text-xs leading-5 text-muted-foreground">{detail}</div> : null}
      </div>

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action ? renderAction(action) : null}
          {secondaryAction ? renderAction(secondaryAction) : null}
        </div>
      )}
    </div>
  );
}
