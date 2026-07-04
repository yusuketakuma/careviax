import type { ReactNode } from 'react';
import { AlertTriangle, Ban, CloudOff, FileQuestion, LockKeyhole } from 'lucide-react';
import {
  StateActionButton,
  StateHeading,
  type StateAction,
  type StateHeadingLevel,
} from '@/components/ui/state-elements';
import { cn } from '@/lib/utils';

type ErrorStateVariant = 'not-found' | 'server' | 'network' | 'forbidden' | 'unauthorized';
type ErrorStateLive = 'off' | 'polite' | 'assertive';

type ErrorStateProps = {
  variant?: ErrorStateVariant;
  title?: string;
  /**
   * 自由文の本文。SSOT 6.3 の文言契約「原因 + 次の行動」を満たすこと。
   * 新規実装では description ではなく cause / nextAction の構造化 props を推奨する。
   */
  description?: string;
  /** 原因（何が起きたか）。例: 「保険情報を取得できませんでした。」 */
  cause?: string;
  /** 次の行動（利用者が取れる手）。例: 「通信状態を確認して再試行してください。」 */
  nextAction?: string;
  detail?: ReactNode;
  action?: StateAction;
  secondaryAction?: StateAction;
  /**
   * 再試行ハンドラのショートハンド。指定すると「再試行」ボタンを主アクションとして描画する
   * （`action` 指定時はそちらが優先され、onRetry は無視される）。
   * SSOT 6.3: 再試行可能な失敗には再試行導線を必ず付ける。
   */
  onRetry?: () => void;
  size?: 'inline' | 'page';
  headingLevel?: StateHeadingLevel;
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
    iconClassName: 'bg-state-confirm/10 text-state-confirm',
  },
  forbidden: {
    icon: Ban,
    title: 'この画面へのアクセス権限がありません',
    description:
      '組織またはロールの権限設定を確認してください。RLS 制約により表示できない場合があります。',
    iconClassName: 'bg-state-confirm/10 text-state-confirm',
  },
  unauthorized: {
    icon: LockKeyhole,
    title: 'ログインが必要です',
    description: 'セッションが切れているか、認証が完了していません。再度ログインしてください。',
    iconClassName: 'bg-tag-info/10 text-tag-info',
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

export function ErrorState({
  variant = 'server',
  title,
  description,
  cause,
  nextAction,
  detail,
  action,
  secondaryAction,
  onRetry,
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
  // 文言契約(SSOT 6.3): cause / nextAction が与えられたら「原因 + 次の行動」で本文を構成する。
  // description(自由文) > cause+nextAction > variant 既定文言 の優先順。
  const structuredBody =
    cause || nextAction ? [cause, nextAction].filter(Boolean).join(' ') : undefined;
  const bodyText = description ?? structuredBody ?? meta.description;
  // 再試行導線(SSOT 6.3): action 未指定時のみ onRetry を主アクションに昇格する。
  const resolvedAction = action ?? (onRetry ? { label: '再試行', onClick: onRetry } : undefined);
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
          ? 'min-h-dvh px-8 py-12'
          : 'rounded-md border border-dashed border-border bg-card px-6 py-10',
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
          <StateHeading level={resolvedHeadingLevel} className={headingClassName}>
            {headingText}
          </StateHeading>
        </div>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground">{bodyText}</p>
        {detail ? <div className="text-xs leading-5 text-muted-foreground">{detail}</div> : null}
      </div>

      {(resolvedAction || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {resolvedAction ? <StateActionButton action={resolvedAction} /> : null}
          {secondaryAction ? <StateActionButton action={secondaryAction} /> : null}
        </div>
      )}
    </div>
  );
}
