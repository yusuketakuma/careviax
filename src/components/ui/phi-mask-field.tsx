'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PhiMaskFieldProps = {
  /** 項目名（例: 電話番号 / 住所 / 保険者番号）。 */
  label: string;
  /** 実値。要配慮個人情報。既定ではマスクして表示する。 */
  value: string | null | undefined;
  /**
   * 表示トグルを出すか（権限がある場合のみ true）。
   * false のときは表示できず「記録あり/なし」だけを示す（一覧・ダンプでの生値露出を防ぐ）。
   */
  canReveal?: boolean;
  /** 値が無いときの表現。既定「記録なし」。 */
  emptyText?: string;
  className?: string;
};

/**
 * PHI（要配慮個人情報）のマスク表示。電話/住所/保険者番号などを既定で伏せ、
 * 権限がある場合のみ表示トグルで実値を確認できる。一覧・生成ビュー・ダンプでの生値露出を防ぐ。
 * - 値があるときは事実（記録あり）だけを示し、生値は canReveal かつ明示操作時のみ。
 * - 取得が無い場合は「記録なし」を別表現にし、マスク（記録あり）と混同しない。
 */
export function PhiMaskField({
  label,
  value,
  canReveal = false,
  emptyText = '記録なし',
  className,
}: PhiMaskFieldProps) {
  const [revealed, setRevealed] = React.useState(false);
  const hasValue = value != null && value !== '';
  const showReal = hasValue && canReveal && revealed;

  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {!hasValue ? (
        <span className="text-muted-foreground">{emptyText}</span>
      ) : showReal ? (
        <span data-slot="phi-value" className="tabular-nums">
          {value}
        </span>
      ) : (
        <span data-slot="phi-masked">
          <span aria-hidden>••••••</span>
          <span className="sr-only">{canReveal ? '保護済み（表示可）' : '保護済み'}</span>
        </span>
      )}
      {hasValue && canReveal ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={revealed}
          aria-label={revealed ? `${label}を隠す` : `${label}を表示`}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      ) : null}
    </div>
  );
}
