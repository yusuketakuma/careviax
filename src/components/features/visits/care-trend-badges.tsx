'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CareTrend } from '@/types/visit-brief';

const TREND_CONFIG = {
  increasing: {
    icon: TrendingUp,
    label: '残薬 増加傾向',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  stable: {
    icon: Minus,
    label: '残薬 安定',
    className: 'border-green-200 bg-green-50 text-green-700',
  },
  decreasing: {
    icon: TrendingDown,
    label: '残薬 減少傾向',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
} as const;

export function CareTrendBadges({ trend }: { trend: CareTrend }) {
  const config = TREND_CONFIG[trend.residual_direction];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn('inline-flex items-center gap-1 py-0.5 text-xs font-medium', config.className)}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
