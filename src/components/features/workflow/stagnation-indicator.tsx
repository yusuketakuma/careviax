'use client';

import { differenceInMinutes, formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface StagnationIndicatorProps {
  updatedAt: string | Date;
  thresholdMinutes?: number;
}

export function StagnationIndicator({
  updatedAt,
  thresholdMinutes = 30,
}: StagnationIndicatorProps) {
  const date = typeof updatedAt === 'string' ? parseISO(updatedAt) : updatedAt;
  const elapsed = differenceInMinutes(new Date(), date);

  if (elapsed < thresholdMinutes) return null;

  const label = formatDistanceToNow(date, { locale: ja, addSuffix: true });

  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
    >
      <Clock className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
