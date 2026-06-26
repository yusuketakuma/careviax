import * as React from 'react';
import { cn } from '@/lib/utils';

export type StickyFooterActionProps = {
  /** 操作（保存・確定・キャンセル等）。右寄せで並べる。 */
  children: React.ReactNode;
  /** 操作の左側に置く状態表示（未保存・件数・エラー要約など）。 */
  status?: React.ReactNode;
  /** スクリーンリーダー用の領域名。既定「操作」。 */
  'aria-label'?: string;
  className?: string;
};

/**
 * 画面下部に貼り付く操作バー。モバイルの thumb zone（親指の届く範囲）に主操作を固定し、
 * 長いフォームでも送信・確定・キャンセルへ常時到達できるようにする。
 * - sticky bottom + 半透明背景 + 上罫線で本文と分離。safe-area（ホームバー）を考慮。
 * - 操作は右、状態（未保存・件数）は左に置ける。Primary が複数並ばない運用は呼び出し側の責務。
 */
export function StickyFooterAction({
  children,
  status,
  'aria-label': ariaLabel = '操作',
  className,
}: StickyFooterActionProps) {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={cn(
        'sticky bottom-0 z-20 flex items-center gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {status ? <div className="min-w-0 flex-1 text-xs text-muted-foreground">{status}</div> : null}
      <div className={cn('flex items-center gap-2', status ? 'shrink-0' : 'ml-auto')}>
        {children}
      </div>
    </div>
  );
}
