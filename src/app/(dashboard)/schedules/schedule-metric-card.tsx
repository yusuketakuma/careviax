import type { ComponentType } from 'react';
import { Card, CardContent } from '@/components/ui/card';

export function ScheduleMetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: number;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card size="sm" className="bg-gradient-to-br from-card via-card to-muted/30">
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
