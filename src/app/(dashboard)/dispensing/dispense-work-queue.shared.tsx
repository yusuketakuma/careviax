'use client';

import Link from 'next/link';
import { useCallback, useState, type ElementType } from 'react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const priorityConfig: Record<
  string,
  {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
    icon?: ElementType;
  }
> = {
  emergency: { label: '緊急', variant: 'destructive', icon: AlertTriangle },
  urgent: { label: '至急', variant: 'secondary' },
  normal: { label: '通常', variant: 'outline' },
};

export function QueuePriorityBadge({ priority }: { priority: string }) {
  const config = priorityConfig[priority] ?? priorityConfig.normal;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1 whitespace-nowrap">
      {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
      {config.label}
    </Badge>
  );
}

export function QueueFacilityLabel({ facilityLabel }: { facilityLabel: string | null }) {
  return <span className="text-sm text-muted-foreground">{facilityLabel ?? '自宅訪問'}</span>;
}

export function QueuePatientLink({
  href,
  name,
  nameKana,
}: {
  href: string;
  name: string;
  nameKana: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
    >
      {name}
      {nameKana ? <span className="ml-1 text-xs text-muted-foreground">({nameKana})</span> : null}
    </Link>
  );
}

export function QueueDueDate({
  dueDate,
  isOverdue,
  showIcon = true,
}: {
  dueDate: string | null;
  isOverdue: boolean;
  showIcon?: boolean;
}) {
  if (!dueDate) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const content = (
    <>
      {showIcon ? (
        <Clock
          className={`size-3.5 ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
      ) : null}
      {format(parseISO(dueDate), 'MM/dd HH:mm', { locale: ja })}
      {isOverdue ? (
        <span className="text-[11px]">{showIcon ? '期限超過' : ' / 期限超過'}</span>
      ) : null}
    </>
  );

  if (showIcon) {
    return (
      <div
        className={`flex items-center gap-1 text-sm ${isOverdue ? 'font-medium text-destructive' : ''}`}
      >
        {content}
      </div>
    );
  }

  return (
    <span
      className={
        isOverdue ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'
      }
    >
      {content}
    </span>
  );
}

export function clampSelectedRowIndex(index: number, totalCount: number) {
  if (totalCount <= 0) return 0;
  return Math.min(Math.max(index, 0), totalCount - 1);
}

export function useSelectableQueueState<T>(items: T[]) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedRowIndex = clampSelectedRowIndex(selectedIndex, items.length);
  const selectedItem = items[selectedRowIndex] ?? null;

  const handleMoveUp = useCallback(() => {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleMoveDown = useCallback(() => {
    setSelectedIndex((prev) => Math.min(Math.max(0, items.length - 1), prev + 1));
  }, [items.length]);

  const handleRowClick = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, []);

  return {
    selectedItem,
    selectedRowIndex,
    handleMoveUp,
    handleMoveDown,
    handleRowClick,
    resetSelection,
  };
}
