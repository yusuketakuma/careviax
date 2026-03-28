'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  HomeCareFeatureGroup,
  HomeCareFeatureState,
  HomeCareFeatureStatus,
  HomeCareFeatureSummary,
} from '@/types/home-care';

const GROUP_LABELS: Record<HomeCareFeatureGroup, string> = {
  emergency: '緊急対応',
  continuity: '継続管理',
  preparation: '訪問準備',
  communication: '連携',
  safety: '薬学安全',
};

const STATUS_LABELS: Record<HomeCareFeatureStatus, string> = {
  blocked: 'ブロック',
  attention: '要対応',
  monitoring: '監視',
  ready: '安定',
};

const STATUS_TONE: Record<HomeCareFeatureStatus, string> = {
  blocked: 'border-rose-200 bg-rose-50 text-rose-700',
  attention: 'border-amber-200 bg-amber-50 text-amber-700',
  monitoring: 'border-sky-200 bg-sky-50 text-sky-700',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

type HomeCareFeatureBoardProps = {
  summary: HomeCareFeatureSummary;
  title: string;
  description?: string;
  className?: string;
  compact?: boolean;
};

type HomeCareFeatureHighlightsProps = {
  features: HomeCareFeatureState[];
  title: string;
  description?: string;
  emptyText?: string;
  className?: string;
};

function StatusBadge({
  status,
  count,
  showCount = true,
}: {
  status: HomeCareFeatureStatus;
  count: number;
  showCount?: boolean;
}) {
  return (
    <Badge variant="outline" className={STATUS_TONE[status]}>
      {STATUS_LABELS[status]}
      {showCount ? ` ${count}` : ''}
    </Badge>
  );
}

function FeatureTile({
  feature,
  compact = false,
}: {
  feature: HomeCareFeatureState;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-background px-4 py-3',
        feature.status === 'blocked' && 'border-rose-200/80',
        feature.status === 'attention' && 'border-amber-200/80'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{GROUP_LABELS[feature.group]}</Badge>
            <StatusBadge status={feature.status} count={feature.count} />
          </div>
          <p className="text-sm font-semibold text-foreground">{feature.title}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-foreground">{feature.count}</p>
          <p className="text-[11px] text-muted-foreground">件</p>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.summary}</p>
      {feature.evidence.length > 0 && (
        <div className="mt-3 space-y-1">
          {feature.evidence.slice(0, compact ? 2 : 3).map((item) => (
            <p key={item} className="text-xs text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-end">
        <Link
          href={feature.action_href}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {feature.action_label}
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

export function HomeCareFeatureBoard({
  summary,
  title,
  description,
  className,
  compact = false,
}: HomeCareFeatureBoardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusBadge status="blocked" count={summary.totals.blocked} />
          <StatusBadge status="attention" count={summary.totals.attention} />
          <StatusBadge status="monitoring" count={summary.totals.monitoring} />
          <StatusBadge status="ready" count={summary.totals.ready} />
        </div>
        <div className={cn('grid gap-3', compact ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3')}>
          {summary.features.map((feature) => (
            <FeatureTile key={feature.key} feature={feature} compact={compact} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function HomeCareFeatureHighlights({
  features,
  title,
  description,
  emptyText = '優先ハイライトはありません。',
  className,
}: HomeCareFeatureHighlightsProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {features.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {features.map((feature) => (
            <FeatureTile key={feature.key} feature={feature} compact />
          ))}
        </div>
      )}
    </div>
  );
}
